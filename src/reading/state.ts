export const readingKeys = { currentTab: "readingTab", pdfReaders: "pdfReaders" } as const
export const readingLocks = { session: "read-aloud-reading", pdfReaders: "read-aloud-pdf-readers" } as const
export type PdfReaders = Record<string, number>

function isTabId(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

/** Session storage is untrusted; consume only valid tab mappings. */
export function parsePdfReaders(value: unknown): PdfReaders {
	const readers: PdfReaders = {}
	if (!value || typeof value !== "object" || Array.isArray(value)) return readers
	for (const [reader, source] of Object.entries(value)) {
		if (/^(?:0|[1-9]\d*)$/u.test(reader) && isTabId(Number(reader)) && isTabId(source)) readers[reader] = source
	}
	return readers
}

export function parseReadingState(stored: Record<string, unknown>): {
	currentTab: number | undefined
	pdfReaders: PdfReaders
} {
	const currentTab = stored[readingKeys.currentTab]
	return {
		currentTab: isTabId(currentTab) ? currentTab : undefined,
		pdfReaders: parsePdfReaders(stored[readingKeys.pdfReaders]),
	}
}
