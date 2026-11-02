import type { TextRun } from "./document.ts"

/** Project offsets while retaining the source's live DOM binding (PDF layers bind lazily). */
export function projectRun(run: TextRun, from: number, to: number, offset: number): TextRun {
	return {
		from,
		to,
		offset,
		get node() {
			return run.node
		},
	}
}
