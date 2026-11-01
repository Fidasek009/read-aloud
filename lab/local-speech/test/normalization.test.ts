import { expect, test } from "bun:test"

import { normalizeDocument } from "../../../src/reading/normalize.ts"
import { locateSelection } from "../../../src/reading/selection.ts"

test("line-end hyphenation joins speech while source runs retain exact DOM characters", () => {
	const values = ["Read in-", "frastructure and pre-exascale. co\u00adoperate.\nNext paragraph."]
	const nodes = values.map((data) => ({ data }) as Text)
	const raw = values.join("\n")
	const source = {
		text: raw,
		runs: [
			{ node: nodes[0]!, from: 0, to: values[0]!.length, offset: 0 },
			{ node: nodes[1]!, from: values[0]!.length + 1, to: raw.length, offset: 0 },
		],
	}
	const normalized = normalizeDocument(source)
	expect(normalized.text).toBe("Read infrastructure and pre-exascale. cooperate.\nNext paragraph.")
	for (const run of normalized.runs)
		expect(normalized.text.slice(run.from, run.to)).toBe(
			run.node.data.slice(run.offset, run.offset + run.to - run.from),
		)
	const selected = locateSelection(normalized, "in-\nfrastructure and pre-exascale")
	expect(selected.text).toBe("infrastructure and pre-exascale")
	expect(selected.runs[0]?.offset).toBe(5)
	expect(selected.runs.at(-1)?.node).toBe(nodes[1]!)
})

test("PDF layout line breaks become spaces, with page breaks, genuine hyphens and domain dots intact", () => {
	const normalized = normalizeDocument(
		{ text: "in-\nfrastructure.\nUse consensus.app and pre-exascale.\n\nSecond page.", runs: [] },
		true,
	)
	expect(normalized.text).toBe("infrastructure. Use consensus.app and pre-exascale.\n\nSecond page.")
	for (const text of ["pre-exascale", "in- frastructure", "in-\n\nfrastructure", "in-\nFrance"])
		expect(normalizeDocument({ text, runs: [] }).text).toBe(text)
})
