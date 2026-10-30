import { expect, test } from "bun:test"

import { locateSelection } from "../../../src/reading/selection.ts"

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
