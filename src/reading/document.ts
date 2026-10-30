export interface TextRun {
	from: number
	to: number
	node: Text
	offset: number
}
export interface ReadingDocument {
	text: string
	runs: TextRun[]
}

/** Preserve DOM offsets while excluding page chrome from article reading. */
export function captureDocument(mode: "selection" | "article"): ReadingDocument {
	const selection = window.getSelection()
	const range = mode === "selection" && selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null
	if (mode === "selection" && (!range || range.collapsed)) throw new Error("Select some text to read first.")
	let root: Node =
		range?.commonAncestorContainer ?? document.querySelector("article, main, [role=main]") ?? document.body
	if (root.nodeType === Node.TEXT_NODE) root = root.parentNode!
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
	const runs: TextRun[] = []
	let text = "",
		lastBlock: Element | null = null
	for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
		const parent = node.parentElement
		if (!parent || parent.closest("script,style,noscript,template,[hidden],[aria-hidden=true],[data-read-aloud]"))
			continue
		if (
			!range &&
			parent.closest("nav,header,footer,aside,form,button,[role=navigation],[role=banner],[role=contentinfo]")
		)
			continue
		if (!parent.getClientRects().length || getComputedStyle(parent).visibility === "hidden") continue
		if (range && !range.intersectsNode(node)) continue
		const from = range?.startContainer === node ? range.startOffset : 0
		const to = range?.endContainer === node ? range.endOffset : node.length
		const value = node.data.slice(from, to)
		if (!value || (!value.trim() && !text)) continue
		const block = parent.closest("p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,td,div,section")
		if (text && block !== lastBlock) text += "\n"
		lastBlock = block
		runs.push({ from: text.length, to: text.length + value.length, node, offset: from })
		text += value
		if (text.length > 500_000)
			throw new Error("This page is too long to read in one session. Select a smaller section.")
	}
	if (!text.trim()) throw new Error("No readable text was found on this page.")
	return { text, runs }
}

export function sourceRange(source: ReadingDocument, start: number, end: number): Range | null {
	if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || end > source.text.length)
		return null
	const first = source.runs.find((run) => start >= run.from && start < run.to)
	const last = source.runs.find((run) => end > run.from && end <= run.to)
	if (!first?.node.isConnected || !last?.node.isConnected) return null
	for (const run of [first, last]) {
		if (run.node.data.slice(run.offset, run.offset + run.to - run.from) !== source.text.slice(run.from, run.to))
			return null
	}
	const range = document.createRange()
	try {
		range.setStart(first.node, first.offset + start - first.from)
		range.setEnd(last.node, last.offset + end - last.from)
	} catch {
		return null
	}
	return range
}

export interface ReadingChunk {
	start: number
	end: number
	sentence: number
}
export function readingChunks(text: string, language = "en"): ReadingChunk[] {
	const chunks: ReadingChunk[] = []
	let sentence = 0
	const segmenter = new Intl.Segmenter(language, { granularity: "sentence" })
	// Headings, list items, and Markdown paragraphs often have no final punctuation.
	// DOM block breaks are navigation boundaries even when ICU joins those lines.
	for (const block of text.matchAll(/[^\n]+/gu)) {
		for (const part of segmenter.segment(block[0])) {
			let start = block.index + part.index
			const limit = start + part.segment.length
			while (start < limit) {
				while (start < limit && /\s/u.test(text[start]!)) start++
				if (start === limit) break
				// A shorter first utterance produces audio sooner; read-ahead uses larger chunks.
				let end = Math.min(start + (chunks.length === 0 ? 100 : 240), limit)
				if (end < limit) {
					const boundary = text.lastIndexOf(" ", end)
					if (boundary > start) end = boundary
				}
				if (end < limit && /[\uDC00-\uDFFF]/u.test(text[end]!)) end--
				chunks.push({ start, end, sentence })
				start = end
			}
			sentence++
		}
	}
	return chunks
}

export function sentenceTarget(chunks: readonly ReadingChunk[], cursor: number, direction: -1 | 1): number {
	const current = Math.min(Math.max(0, cursor), chunks.length - 1)
	const sentence = chunks[current]?.sentence ?? 0
	if (direction === 1) return chunks.findIndex((chunk) => chunk.sentence > sentence)
	if (sentence === 0) return 0
	return chunks.findIndex((chunk) => chunk.sentence === sentence - 1)
}
