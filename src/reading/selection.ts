import type { ReadingDocument } from "./document.ts"

function normalized(text: string) {
	let value = "",
		offset = 0
	const positions: number[] = []
	for (const character of text) {
		if (/\s/u.test(character)) {
			if (value && !value.endsWith(" ")) {
				positions.push(offset)
				value += " "
			}
		} else {
			for (const unit of character.normalize("NFKC").split("")) {
				positions.push(offset)
				value += unit
			}
		}
		offset += character.length
	}
	positions.push(text.length)
	return { value, positions }
}

/** Match a native PDF selection without reading beyond it or losing DOM offsets. */
export function locateSelection(source: ReadingDocument, selection: string): ReadingDocument {
	const haystack = normalized(source.text)
	const needle = normalized(selection).value.trim()
	if (!needle) throw new Error("Select some PDF text first.")
	const match = haystack.value.indexOf(needle)
	if (match < 0)
		throw new Error("This selection could not be located in the PDF. Select it in this reader and try again.")
	if (haystack.value.indexOf(needle, match + 1) >= 0)
		throw new Error("This selection appears more than once. Select it in this reader to choose its exact location.")
	const start = haystack.positions[match]!
	const last = haystack.positions[match + needle.length - 1]!
	const end = last + (source.text.codePointAt(last)! > 0xffff ? 2 : 1)
	return {
		text: source.text.slice(start, end),
		runs: source.runs
			.filter((run) => run.to > start && run.from < end)
			.map((run) => ({
				node: run.node,
				from: Math.max(run.from, start) - start,
				to: Math.min(run.to, end) - start,
				offset: run.offset + Math.max(0, start - run.from),
			})),
	}
}
