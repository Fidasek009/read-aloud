import { expect, test } from "bun:test"

import { isPdfReaderContext, isPdfReaderUrl } from "../src/reading/pdf-reader.ts"

const root = "moz-extension://read-aloud/"
const source = "https://example.org/document.pdf"
const reader = `${root}pdf.html?src=${encodeURIComponent(source)}&source=7`

test("PDF discovery matches the extension document and its source rather than URL prefixes", () => {
	expect(isPdfReaderUrl(reader, root, source, 7)).toBe(true)
	expect(isPdfReaderUrl(reader, root, `${source}#page=4`, 7)).toBe(true)
	expect(isPdfReaderUrl(reader, root, source, 8)).toBe(false)
	expect(isPdfReaderUrl(reader, root, "https://example.org/another.pdf", 7)).toBe(false)
	expect(isPdfReaderUrl(reader.replace("pdf.html?", "pdf.html.other?"), root)).toBe(false)
	expect(isPdfReaderUrl(reader.replace("moz-extension:", "https:"), root)).toBe(false)
	expect(isPdfReaderUrl(reader.replace("//read-aloud/", "//another-extension/"), root)).toBe(false)
	expect(isPdfReaderUrl(undefined, root)).toBe(false)
	expect(isPdfReaderUrl("invalid", root)).toBe(false)
})

test("PDF discovery accepts older source-less tabs but rejects another tab or embedded frame", () => {
	const legacy = `${root}pdf.html?src=${encodeURIComponent(source)}`
	expect(isPdfReaderUrl(legacy, root, source, 7)).toBe(true)
	expect(isPdfReaderContext({ tabId: 3, frameId: 0, documentUrl: reader }, 3, root, source, 7)).toBe(true)
	expect(isPdfReaderContext({ tabId: 3, frameId: 2, documentUrl: reader }, 3, root, source, 7)).toBe(false)
	expect(isPdfReaderContext({ tabId: 4, frameId: 0, documentUrl: reader }, 3, root, source, 7)).toBe(false)
	expect(isPdfReaderContext({ tabId: 3, frameId: 0 }, 3, root, source, 7)).toBe(false)
})

test("reader sources support extensionless documents and local user-selected files", () => {
	for (const source of ["https://arxiv.org/pdf/2404.07981", "file:///home/user/Downloads/paper.pdf"]) {
		const url = `${root}pdf.html?src=${encodeURIComponent(source)}&source=7`
		expect(isPdfReaderUrl(url, root, source, 7)).toBe(true)
	}
	expect(isPdfReaderUrl(`${root}pdf.html?src=${encodeURIComponent("javascript:alert(1)")}`, root)).toBe(false)
})
