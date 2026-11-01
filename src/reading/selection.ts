import type { ReadingDocument } from "./document.ts"

import { layoutHyphenation } from "./normalize.ts"

function sliceDocument(source: ReadingDocument, start: number, end: number): ReadingDocument {
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

/** PDF text spans omit layout spaces; select from the mapped text, not DOM textContent. */
export function selectRange(source: ReadingDocument, range: Range | null): ReadingDocument {
	if (!range || range.collapsed) throw new Error("Select some PDF text first.")
	let start: number | undefined
	let end: number | undefined
	for (const run of source.runs) {
		if (!run.node.isConnected || !range.intersectsNode(run.node)) continue
		const from = Math.max(run.offset, range.startContainer === run.node ? range.startOffset : run.offset)
		const to = Math.min(
			run.offset + run.to - run.from,
			range.endContainer === run.node ? range.endOffset : run.offset + run.to - run.from,
		)
		if (to <= from) continue
		start ??= run.from + from - run.offset
		end = run.from + to - run.offset
	}
	if (start === undefined || end === undefined) throw new Error("Select some PDF text first.")
	return sliceDocument(source, start, end)
}

function normalized(text: string) {
	let value = "",
		offset = 0
	const positions: number[] = []
	const removed = [...text.matchAll(layoutHyphenation)]
	let removal = 0
	for (const character of text) {
		while (removed[removal] && offset >= removed[removal]!.index + removed[removal]![0].length) removal++
		const deletion = removed[removal]
		if (deletion && offset >= deletion.index) {
			offset += character.length
			continue
		}
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
	return sliceDocument(source, start, end)
}
