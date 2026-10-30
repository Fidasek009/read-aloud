/** eSpeak positions count Unicode code points, not JavaScript UTF-16 units. */
export interface SourceWord {
	start: number
	end: number
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

/** Keep the phonemizer's contextual pronunciation and original word spans together. */
export function tokenizeEvents(
	text: string,
	events: readonly PhonemeEvent[],
	idMap: Readonly<Record<string, readonly number[]>>,
	replacements: Readonly<Record<string, readonly string[]>> = {},
): SpeechTokens {
	const offsets = [0]
	for (const character of text) offsets.push(offsets.at(-1)! + character.length)
	const tokens: SpeechTokens = { ids: [], words: [], symbols: [] }
	const append = (symbol: string, word: SourceWord | null) => {
		const ids = idMap[symbol]
		if (!ids?.length) throw new Error(`Voice cannot pronounce phoneme ${JSON.stringify(symbol)}`)
		tokens.symbols.push(symbol)
		for (const id of ids) {
			if (!Number.isSafeInteger(id) || id < 0) throw new Error("Invalid voice phoneme map")
			tokens.ids.push(id)
			tokens.words.push(word)
		}
	}
	const padded = (symbol: string, word: SourceWord | null) => {
		append(symbol, word)
		append("_", word)
	}
	append("^", null)
	append("_", null)
	let current: SourceWord | null = null
	let clauseEnded = false
	let spoken = false
	for (const event of events) {
		if (event.type === "word") {
			const start = offsets[event.textPosition - 1]
			const end = offsets[event.textPosition - 1 + event.length]
			if (start === undefined || end === undefined || end <= start)
				throw new Error("Phonemizer returned an invalid source word")
			if (spoken && !clauseEnded) padded(" ", null)
			current = { start, end }
			clauseEnded = false
		} else if (event.type === "phoneme" && event.phoneme) {
			if (!current) throw new Error("Phoneme has no source word")
			for (const symbol of event.phoneme) {
				for (const replacement of replacements[symbol] ?? [symbol]) padded(replacement, current)
			}
			spoken = true
		} else if (event.type === "end" && spoken && current && !clauseEnded) {
			const end = offsets[Math.min(event.textPosition, offsets.length - 1)] ?? text.length
			const tail = text.slice(current.end, Math.max(current.end, end))
			const punctuation = tail.match(/[.!?;:,]/u)?.[0] ?? (/[-–—]/u.test(tail) ? "," : ".")
			padded(punctuation, null)
			clauseEnded = true
		}
	}
	if (!spoken) throw new Error("There are no pronounceable words in this text")
	append("$", null)
	return tokens
}

export interface WordTiming extends SourceWord {
	from: number
	to: number
}

/** Timings come from predicted acoustic frames, never text-length estimates. */
export function alignWords(tokens: SpeechTokens, durations: readonly number[], sampleRate: number, hopLength = 256) {
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
	const tokens: SpeechTokens = { ids: [], words: [], symbols: [] }
	const spans = [...new Intl.Segmenter(locale, { granularity: "word" }).segment(text)]
		.filter((part) => part.isWordLike)
		.map((part) => ({ start: part.index, end: part.index + part.segment.length }))
	const append = (symbol: string, word: SourceWord | null) => {
		const ids = idMap[symbol]
		if (!ids?.length) throw new Error(`This model cannot read character ${JSON.stringify(symbol)}`)
		tokens.symbols.push(symbol)
		for (const id of ids) {
			tokens.ids.push(id)
			tokens.words.push(word)
		}
	}
	append("^", null)
	append("_", null)
	let offset = 0
	for (const character of text) {
		const word = spans.find((word) => offset >= word.start && offset < word.end) ?? null
		for (let symbol of character.toLocaleLowerCase(locale).normalize("NFC")) {
			if (/\s/u.test(symbol)) symbol = " "
			append(symbol, word)
			append("_", word)
		}
		offset += character.length
	}
	append("$", null)
	return tokens
}
