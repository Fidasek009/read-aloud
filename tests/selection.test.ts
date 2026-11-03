import { expect, test } from "bun:test"

import { overlappingRuns } from "../src/reading/document.ts"
import { locateSelection } from "../src/reading/selection.ts"

test("native PDF selection normalizes layout whitespace while retaining exact source offsets", () => {
	const node = {} as Text
	const source = { text: "Header\nDobrý   den.\nFooter", runs: [{ from: 7, to: 19, node, offset: 0 }] }
	const selected = locateSelection(source, "Dobrý den.")
	expect(selected.text).toBe("Dobrý   den.")
	expect(selected.runs).toEqual([{ from: 0, to: 12, node, offset: 0 }])
})

test("selection rejects ambiguous and missing matches instead of reading the whole document", () => {
	expect(() => locateSelection({ text: "Repeated. Repeated.", runs: [] }, "Repeated.")).toThrow("more than once")
	expect(() => locateSelection({ text: "Original", runs: [] }, "Missing")).toThrow("could not be located")
})

test("PDF ligatures and supplementary Unicode retain source character boundaries", () => {
	expect(locateSelection({ text: "The oﬃce 😀.", runs: [] }, "office 😀").text).toBe("oﬃce 😀")
})

test("offset lookup skips unrelated pages while including split runs and layout gaps", () => {
	const node = {} as Text
	const runs = Array.from({ length: 1000 }, (_, i) => ({ from: i * 4, to: i * 4 + 3, node, offset: 0 }))
	const source = { text: "a".repeat(4000), runs }
	expect(overlappingRuns(source, 2001, 2009)).toEqual(runs.slice(500, 503))
	expect(overlappingRuns(source, 2003, 2004)).toEqual([])
	expect(overlappingRuns(source, 3999, 4000)).toEqual([])
})
