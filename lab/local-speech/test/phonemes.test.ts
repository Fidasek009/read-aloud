import { expect, test } from "bun:test"

import { alignWords, tokenizeEvents } from "../../../src/speech/phonemes.ts"

const map = Object.fromEntries([..."^_$ ab.cˈ"].map((symbol, id) => [symbol, [id]]))

test("word spans use UTF-16 offsets and keep expanded numbers attached to the original word", () => {
	const tokens = tokenizeEvents(
		"😀 12.",
		[
			{ type: "word", textPosition: 3, length: 2 },
			{ type: "phoneme", textPosition: 3, length: 0, phoneme: "a" },
			{ type: "word", textPosition: 3, length: 2 },
			{ type: "phoneme", textPosition: 3, length: 0, phoneme: "b" },
			{ type: "end", textPosition: 5, length: 0 },
		],
		map,
	)
	const alignment = alignWords(
		tokens,
		tokens.ids.map(() => 1),
		256,
	)
	expect(alignment.timings).toEqual([{ start: 3, end: 5, from: 2, to: 8 }])
	expect(alignment.samples).toBe(tokens.ids.length * 256)
	expect(tokens.symbols.filter((symbol) => !["^", "_", "$"].includes(symbol)).join("")).toBe("a b.")
})

test("alignment uses actual acoustic frames, rejects malformed outputs and unsupported phonemes", () => {
	const tokens = tokenizeEvents(
		"a",
		[
			{ type: "word", textPosition: 1, length: 1 },
			{ type: "phoneme", textPosition: 1, length: 0, phoneme: "a" },
			{ type: "end", textPosition: 1, length: 0 },
		],
		map,
	)
	const durations = tokens.ids.map((_, index) => (index === 2 ? 6 : 0))
	expect(alignWords(tokens, durations, 512).timings).toEqual([{ start: 0, end: 1, from: 0, to: 3 }])
	expect(() => alignWords(tokens, [], 512)).toThrow()
	expect(() =>
		alignWords(
			tokens,
			tokens.ids.map(() => NaN),
			512,
		),
	).toThrow()
	expect(() =>
		tokenizeEvents(
			"x",
			[
				{ type: "word", textPosition: 1, length: 1 },
				{ type: "phoneme", textPosition: 1, length: 0, phoneme: "x" },
			],
			map,
		),
	).toThrow("cannot pronounce")
})
