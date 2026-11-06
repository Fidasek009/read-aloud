import { SpeechTextError } from "./errors.ts"

const wordSegmenters = new Map<string, Intl.Segmenter>()
function wordSegmenter(locale?: string): Intl.Segmenter {
	const key = locale ?? ""
	let segmenter = wordSegmenters.get(key)
	if (!segmenter) {
		segmenter = new Intl.Segmenter(locale, { granularity: "word" })
		wordSegmenters.set(key, segmenter)
	}
	return segmenter
}

/** eSpeak positions count Unicode code points, not JavaScript UTF-16 units. */
export interface SourceWord {
	start: number
	end: number
}

/** Source spans are ordered; phonemizer events may revisit earlier positions. */
function containingWord<T extends SourceWord>(words: readonly T[], offset: number): T | undefined {
	let low = 0
	let high = words.length
	while (low < high) {
		const middle = (low + high) >>> 1
		if (words[middle]!.end <= offset) low = middle + 1
		else high = middle
	}
	const word = words[low]
	return word && word.start <= offset ? word : undefined
}

export interface PhonemeEvent {
	type: string
	textPosition: number
	length: number
	phoneme?: string
}

export interface SpeechTokens {
	ids: number[]
	words: (SourceWord | null)[]
	symbols: string[]
}

/** Shared Piper framing/padding; absent symbols never acquire a padding token. */
function tokenBuilder(idMap: Readonly<Record<string, readonly number[]>>) {
	const tokens: SpeechTokens = { ids: [], words: [], symbols: [] }
	const append = (symbol: string, word: SourceWord | null): boolean => {
		if (!Object.hasOwn(idMap, symbol)) return false
		const ids = idMap[symbol]!
		if (!ids.length || ids.some((id) => !Number.isSafeInteger(id) || id < 0))
			throw new Error("Invalid voice phoneme map")
		tokens.symbols.push(symbol)
		for (const id of ids) {
			tokens.ids.push(id)
			tokens.words.push(word)
		}
		return true
	}
	const required = (symbol: string, word: SourceWord | null) => {
		if (!append(symbol, word)) throw new Error("Invalid voice phoneme map")
	}
	const padded = (symbol: string, word: SourceWord | null): boolean => {
		if (!append(symbol, word)) return false
		required("_", word)
		return true
	}
	required("^", null)
	required("_", null)
	return {
		tokens,
		padded,
		finish() {
			required("$", null)
			return tokens
		},
	}
}

/** Keep the phonemizer's contextual pronunciation and original word spans together. */
export function tokenizeEvents(
	text: string,
	events: readonly PhonemeEvent[],
	idMap: Readonly<Record<string, readonly number[]>>,
	replacements: Readonly<Record<string, readonly string[]>> = {},
): SpeechTokens {
	const offsets = [0]
	for (const character of text) offsets.push(offsets.at(-1)! + character.length)
	// Use ICU word boundaries for scripts without spaces as well as English/Czech.
	// Adjacent hyphenated parts form one written compound; inline dots do not.
	const lexical: (SourceWord & { compound: boolean })[] = []
	for (const part of wordSegmenter().segment(text)) {
		if (!part.isWordLike) continue
		const last = lexical.at(-1)
		if (last && /^[-‐‑]$/u.test(text.slice(last.end, part.index))) {
			last.end = part.index + part.segment.length
			last.compound = true
		} else lexical.push({ start: part.index, end: part.index + part.segment.length, compound: false })
	}
	const sourceWord = (event: PhonemeEvent): SourceWord | null => {
		const start = offsets[event.textPosition - 1]
		if (start === undefined || !Number.isSafeInteger(event.length) || event.length < 0) return null
		const end = offsets[event.textPosition - 1 + event.length]
		const word = containingWord(lexical, start)
		// eSpeak can report only a compound's prefix, or repeat a number's original
		// length at interior positions while expanding it (including Roman numerals).
		if (
			word &&
			(event.length === 0 || word.compound || /^[\p{N}IVXLCDMivxlcdm]+$/u.test(text.slice(word.start, word.end)))
		)
			return { start: word.start, end: word.end }
		if (end !== undefined && end > start) return { start, end }
		return word ? { start: word.start, end: word.end } : null
	}
	const { padded, finish } = tokenBuilder(idMap)
	let current: SourceWord | null = null
	let clauseEnded = false
	let spoken = false
	for (const event of events) {
		if (event.type === "word") {
			if (spoken && !clauseEnded) padded(" ", null)
			// An unmappable annotation does not invalidate the pronunciation. Preserve
			// the phonemes and omit only that highlight, never invent source offsets.
			current = sourceWord(event)
			clauseEnded = false
		} else if (event.type === "phoneme" && event.phoneme) {
			// Piper decomposes IPA and skips symbols absent from the model's map.
			// Retain source spans only for emitted IDs. Do not log reading phonemes.
			// https://github.com/OHF-Voice/piper1-gpl/blob/main/src/piper/phoneme_ids.py
			for (const symbol of event.phoneme.normalize("NFD")) {
				for (const replacement of replacements[symbol] ?? [symbol]) spoken = padded(replacement, current) || spoken
			}
		} else if (event.type === "end" && spoken && !clauseEnded) {
			const end = offsets[Math.min(event.textPosition, offsets.length - 1)] ?? text.length
			const tail = current ? text.slice(current.end, Math.max(current.end, end)) : ""
			const punctuation = tail.match(/[.!?;:,]/u)?.[0] ?? (/[-–—]/u.test(tail) ? "," : ".")
			padded(punctuation, null)
			clauseEnded = true
		}
	}
	if (!spoken) throw new SpeechTextError("There are no pronounceable words in this text")
	return finish()
}

export interface WordTiming extends SourceWord {
	from: number
	to: number
}

/** Timings come from predicted acoustic frames, never text-length estimates. */
export function alignWords(tokens: SpeechTokens, durations: ArrayLike<number>, sampleRate: number, hopLength = 256) {
	if (tokens.ids.length !== durations.length || !(sampleRate > 0) || !(hopLength > 0))
		throw new Error("Invalid alignment dimensions")
	const timings: WordTiming[] = []
	let frames = 0
	for (let index = 0; index < durations.length; index++) {
		const duration = durations[index]!
		if (!Number.isSafeInteger(duration) || duration < 0) throw new Error("Invalid acoustic duration")
		const from = (frames * hopLength) / sampleRate
		frames += duration
		const to = (frames * hopLength) / sampleRate
		const word = tokens.words[index]
		if (!word || duration === 0) continue
		const last = timings.at(-1)
		if (last?.start === word.start && last.end === word.end) last.to = to
		else timings.push({ ...word, from, to })
	}
	return { timings, samples: frames * hopLength }
}

/** Grapheme models use original character spans, with acoustic durations as usual. */
export function tokenizeText(
	text: string,
	idMap: Readonly<Record<string, readonly number[]>>,
	locale: string,
): SpeechTokens {
	const { padded, finish } = tokenBuilder(idMap)
	const spans = [...wordSegmenter(locale).segment(text)]
		.filter((part) => part.isWordLike)
		.map((part) => ({ start: part.index, end: part.index + part.segment.length }))
	let offset = 0
	for (const character of text) {
		const word = containingWord(spans, offset) ?? null
		for (let symbol of character.toLocaleLowerCase(locale).normalize("NFC")) {
			if (/\s/u.test(symbol)) symbol = " "
			if (!padded(symbol, word)) throw new SpeechTextError(`This model cannot read character ${JSON.stringify(symbol)}`)
		}
		offset += character.length
	}
	return finish()
}
