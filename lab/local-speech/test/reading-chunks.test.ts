import { expect, test } from "bun:test"

import { readingChunks, sentenceTarget } from "../../../src/reading/document.ts"

test("bounded chunks preserve sentence navigation and Unicode source offsets", () => {
	const text = `First sentence. ${"A long paragraph with an emoji 😀 and Czech diacritics čřž. ".repeat(8)}Last sentence.`
	const chunks = readingChunks(text, "en")
	expect(chunks.length).toBeGreaterThan(3)
	expect(chunks.every((chunk) => chunk.end - chunk.start <= 240)).toBe(true)
	expect(
		chunks
			.map((chunk) => text.slice(chunk.start, chunk.end))
			.join(" ")
			.replaceAll(/\s+/g, " ")
			.trim(),
	).toBe(text.replaceAll(/\s+/g, " ").trim())
	expect(text.slice(chunks[0]!.start, chunks[0]!.end)).toBe("First sentence. ")
	expect(chunks.at(-1)!.sentence).toBeGreaterThan(chunks[0]!.sentence)
})

test("Markdown headings and unpunctuated blocks are separate navigation stops", () => {
	const text =
		"MD Dash\nA dashboard for Markdown\nInstall the application\nStart listening to your documents\nAnother paragraph. A final sentence."
	const chunks = readingChunks(text)
	const last = chunks.length - 1
	const previous = sentenceTarget(chunks, last, -1)
	expect(text.slice(chunks[previous]!.start, chunks[previous]!.end)).toBe("Another paragraph. ")
	expect(sentenceTarget(chunks, 3, -1)).toBe(2)
	expect(sentenceTarget(chunks, 2, 1)).toBe(3)
	expect(sentenceTarget(chunks, last, 1)).toBe(-1)
})
