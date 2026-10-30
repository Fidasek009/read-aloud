import { expect, test } from "bun:test"

import { readingChunks } from "../../../src/reading/document.ts"

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
