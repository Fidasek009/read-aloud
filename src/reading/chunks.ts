export interface ReadingChunk {
	start: number
	end: number
	sentence: number
}
export function readingChunks(text: string, language = "en"): ReadingChunk[] {
	const chunks: ReadingChunk[] = []
	let sentence = 0
	const segmenter = new Intl.Segmenter(language, { granularity: "sentence" })
	// Headings, list items, and Markdown paragraphs often have no final punctuation.
	// DOM block breaks are navigation boundaries even when ICU joins those lines.
	for (const block of text.matchAll(/[^\n]+/gu)) {
		for (const part of segmenter.segment(block[0])) {
			let start = block.index + part.index
			const limit = start + part.segment.length
			while (start < limit) {
				while (start < limit && /\s/u.test(text[start]!)) start++
				if (start === limit) break
				// A shorter first utterance produces audio sooner; read-ahead uses larger chunks.
				let end = Math.min(start + (chunks.length === 0 ? 48 : 240), limit)
				if (end < limit) {
					const boundary = text.lastIndexOf(" ", end)
					if (boundary > start) end = boundary
					else {
						// A short opening must not cut a long word that previously fit.
						const ceiling = Math.min(start + 240, limit)
						const next = text.indexOf(" ", end)
						end = next >= 0 && next < ceiling ? next : ceiling
					}
				}
				if (end < limit && /[\uDC00-\uDFFF]/u.test(text[end]!)) end--
				chunks.push({ start, end, sentence })
				start = end
			}
			sentence++
		}
	}
	return chunks
}

export function sentenceTarget(chunks: readonly ReadingChunk[], cursor: number, direction: -1 | 1): number {
	const current = Math.min(Math.max(0, cursor), chunks.length - 1)
	const sentence = chunks[current]?.sentence ?? 0
	if (direction === 1) return chunks.findIndex((chunk) => chunk.sentence > sentence)
	if (sentence === 0) return 0
	return chunks.findIndex((chunk) => chunk.sentence === sentence - 1)
}
