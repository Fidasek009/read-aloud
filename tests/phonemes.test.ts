import { expect, test } from "bun:test"

import { alignWords, tokenizeEvents } from "../src/speech/phonemes.ts"

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

test("alignment uses actual acoustic frames and rejects malformed outputs", () => {
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
	).toThrow("no pronounceable words")
})

test("Piper compatibility skips missing IPA symbols without padding or losing word alignment", () => {
	// These five symbols caused all 18 failures; legacy maps predate their IDs.
	for (const missing of ["\u0329", "\u0303", "#", "ʰ", "\u032a", "\u0329\u0303#ʰ\u032a"]) {
		const tokens = tokenizeEvents(
			"a b.",
			[
				{ type: "word", textPosition: 1, length: 1 },
				{ type: "phoneme", textPosition: 1, length: 0, phoneme: `a${missing}` },
				{ type: "word", textPosition: 3, length: 1 },
				{ type: "phoneme", textPosition: 3, length: 0, phoneme: `${missing}b` },
				{ type: "end", textPosition: 4, length: 0 },
			],
			map,
		)
		expect(tokens.ids).toEqual([0, 1, 4, 1, 3, 1, 5, 1, 6, 1, 2])
		expect(tokens.symbols).toEqual(["^", "_", "a", "_", " ", "_", "b", "_", ".", "_", "$"])
		expect(tokens.words).toEqual([
			null,
			null,
			{ start: 0, end: 1 },
			{ start: 0, end: 1 },
			null,
			null,
			{ start: 2, end: 3 },
			{ start: 2, end: 3 },
			null,
			null,
			null,
		])
	}
})

test("Piper compatibility decomposes IPA before config replacements and retains known diacritics", () => {
	const idMap = { "^": [1], _: [0], $: [2], c: [3], "̧": [4, 5], a: [6], "̃": [7] }
	const tokens = tokenizeEvents(
		"ça",
		[
			{ type: "word", textPosition: 1, length: 2 },
			{ type: "phoneme", textPosition: 1, length: 0, phoneme: "çã" },
		],
		idMap,
		{ c: ["a"], "̧": [], a: ["c"] },
	)
	expect(tokens.ids).toEqual([1, 0, 6, 0, 3, 0, 7, 0, 2])
	expect(tokens.words.slice(2, -1).every((word) => word?.start === 0 && word.end === 2)).toBe(true)
	const known = tokenizeEvents("ç", [{ type: "phoneme", textPosition: 1, length: 0, phoneme: "ç" }], idMap)
	expect(known.ids).toEqual([1, 0, 3, 0, 4, 5, 0, 2])
})

test("skipping IPA never disguises broken model framing, invalid IDs or wholly unpronounceable text", () => {
	const events = [{ type: "phoneme", textPosition: 1, length: 0, phoneme: "a" }]
	for (const symbol of ["^", "_", "$"]) {
		const malformed = { ...map }
		delete malformed[symbol]
		expect(() => tokenizeEvents("a", events, malformed)).toThrow("Invalid voice phoneme map")
	}
	for (const ids of [[], [-1], [NaN], [1.1]])
		expect(() => tokenizeEvents("a", events, { ...map, a: ids })).toThrow("Invalid voice phoneme map")
	expect(() => tokenizeEvents("a", events, map, { a: [] })).toThrow("no pronounceable words")
	expect(() => tokenizeEvents("", [], map)).toThrow("no pronounceable words")
})

test("valid phonemizer spans remain distinct in scripts without spaces; unmappable annotations retain speech", () => {
	const tokens = tokenizeEvents(
		"今天很好",
		[
			{ type: "word", textPosition: 1, length: 2 },
			{ type: "phoneme", textPosition: 1, length: 0, phoneme: "a" },
			{ type: "word", textPosition: 3, length: 2 },
			{ type: "phoneme", textPosition: 3, length: 0, phoneme: "b" },
		],
		map,
	)
	expect(
		alignWords(
			tokens,
			tokens.ids.map(() => 1),
			256,
		).timings.map(({ start, end }) => ({ start, end })),
	).toEqual([
		{ start: 0, end: 2 },
		{ start: 2, end: 4 },
	])
	const unmapped = tokenizeEvents(
		"a",
		[
			{ type: "word", textPosition: 99, length: 1 },
			{ type: "phoneme", textPosition: 99, length: 0, phoneme: "a" },
		],
		map,
	)
	expect(unmapped.symbols).toContain("a")
	expect(unmapped.words.every((word) => word === null)).toBe(true)
})
