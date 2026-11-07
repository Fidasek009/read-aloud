import type { PDFPageProxy, RenderTask } from "pdfjs-dist"

import { getDocument, GlobalWorkerOptions, TextLayer } from "pdfjs-dist"
import { browser } from "wxt/browser"

import { isExtensionBackgroundSender } from "../../extension/sender.ts"
import { createReaderDispatcher } from "../../reading/dispatch.ts"
import { overlappingRuns, type ReadingDocument, sourceRange, type TextRun } from "../../reading/document.ts"
import { currentWordHighlight, paintReaderHighlight } from "../../reading/layout.ts"
import { sourceChangedMessage } from "../../reading/messages.ts"
import { normalizeDocument } from "../../reading/normalize.ts"
import { fetchPdf } from "../../reading/pdf-access.ts"
import { isPdfCommand, isPdfSelectionToken, type PdfCommand, pdfSelectionKey } from "../../reading/pdf-control.ts"
import { invalidateSelectionIndex, mapNativeSelection, selectRange } from "../../reading/selection.ts"
import { ReaderSession } from "../../reading/session.ts"
import { parsePdfReaders, readingKeys } from "../../reading/state.ts"
import "pdfjs-dist/web/pdf_viewer.css"
import "../../reading/current-word.css"
import "./style.css"

const pages = document.querySelector<HTMLDivElement>("#pages")!
const status = document.querySelector<HTMLParagraphElement>("#status")!
const controls = document.querySelector<HTMLDivElement>("#controls")!
const params = new URLSearchParams(location.search)
const highlightKey = currentWordHighlight
const session = new ReaderSession<ReadingDocument>()
let complete: ReadingDocument = { text: "", runs: [] }
let nativeMapping: ReturnType<typeof mapNativeSelection> | undefined
let currentHighlight: { start: number; end: number } | undefined
let frame: HTMLIFrameElement | undefined
let tabId: number | undefined
let alive = true
let allowStart = true
let indexing = true
const indexed = Promise.withResolvers<void>()
void indexed.promise.catch(() => {})
const ownTab = browser.tabs.getCurrent().then((tab) => (tabId = tab?.id))
let pendingSelection: ReadingDocument | undefined
let pendingSelectionKey: string | undefined
function captureSelection() {
	const selection = getSelection()
	if (selection?.toString().trim() && selection.rangeCount) {
		try {
			pendingSelection = normalizeDocument(selectRange(complete, selection.getRangeAt(0)), true)
		} catch {
			pendingSelection = undefined
		}
	}
}
function takeSelection(): ReadingDocument | undefined {
	const selection = getSelection()
	const captured = selection?.toString().trim()
		? normalizeDocument(selectRange(complete, selection.rangeCount ? selection.getRangeAt(0) : null), true)
		: pendingSelection
	pendingSelection = undefined
	selection?.removeAllRanges()
	return captured
}
document.addEventListener("selectionchange", captureSelection)
pages.addEventListener("contextmenu", captureSelection)
pages.addEventListener("pointerdown", (event) => {
	if (event.button === 0) pendingSelection = undefined
})
document.addEventListener("keydown", (event) => {
	if (event.key === "Escape" || event.key.startsWith("Arrow")) pendingSelection = undefined
})
// Only the PDF layer owner rebinds nodes; normalized/sliced views are read-only.
interface PdfTextRun extends TextRun {
	node: Text
}
interface PageState {
	page: PDFPageProxy
	canvas: HTMLCanvasElement
	container: HTMLDivElement
	content: Awaited<ReturnType<PDFPageProxy["getTextContent"]>>
	viewport: ReturnType<PDFPageProxy["getViewport"]>
	runs: (PdfTextRun | undefined)[]
	task?: RenderTask
	visible: boolean
	textReady?: Promise<void>
	pending: Promise<void>
}
const owners = new WeakMap<Text, PageState>()

function ensureText(state: PageState): Promise<void> {
	return (state.textReady ??= (async () => {
		state.container.replaceChildren()
		const layer = new TextLayer({
			textContentSource: state.content,
			container: state.container,
			viewport: state.viewport,
		})
		await layer.render()
		for (let index = 0; index < state.runs.length; index++) {
			const run = state.runs[index]
			if (!run) continue
			const node = layer.textDivs[index]?.firstChild
			if (!(node instanceof Text) || node.data !== run.node.data)
				throw new Error("The PDF text layer could not be mapped accurately.")
			run.node = node
			owners.set(node, state)
		}
		invalidateSelectionIndex(complete)
	})().catch((error) => {
		delete state.textReady
		invalidateSelectionIndex(complete)
		throw error
	}))
}

function stop() {
	nativeMapping = undefined
	currentHighlight = undefined
	pendingSelection = undefined
	session.close()
	frame?.remove()
	frame = undefined
	CSS.highlights?.delete(highlightKey)
}

async function start(mode: "article" | "selection", initial?: ReadingDocument) {
	// Any explicit request supersedes startup, including a rejected selection.
	allowStart = false
	const started = await session.start(async () => {
		const selected = initial ?? (mode === "selection" ? takeSelection() : undefined)
		if (mode === "selection" && !selected) throw new Error("Select some PDF text first.")
		if (!selected) await indexed.promise
		const scope = selected ?? complete
		if (!scope.text.trim()) throw new Error("This PDF has no readable text layer.")
		return scope
	})
	if (!started || !alive) return
	clearMapping()
	if (frame) {
		frame.contentWindow?.postMessage(sourceChangedMessage(), location.origin)
		return
	}
	frame = document.createElement("iframe")
	frame.title = "Read Aloud playback controls"
	if (import.meta.env.BROWSER !== "firefox") frame.allow = "autoplay"
	frame.src = `${browser.runtime.getURL("/player.html")}#${session.id}`
	controls.append(frame)
}

async function handleCommand(command: PdfCommand) {
	if (command.action === "stop") {
		allowStart = false
		stop()
		return
	}
	if (command.reveal && frame?.isConnected) {
		frame.focus()
		return
	}
	const reading = start(command.mode)
	if (command.mode === "article" && indexing) {
		// Accept preparation without holding the background's routing lock until
		// indexing finishes. A newer selection/stop can invalidate this request.
		void reading.catch((error: unknown) => {
			if (alive) status.textContent = error instanceof Error ? error.message : "This PDF could not be read."
		})
		return
	}
	await reading
	status.textContent = ""
}

// A synchronous guard leaves unrelated runtime messages for their own receiver.
// Identity is established before the load routine yields its first document work.
browser.runtime.onMessage.addListener((message: unknown, sender) => {
	if (
		!isPdfCommand(message) ||
		message.tabId !== tabId ||
		!isExtensionBackgroundSender(sender, browser.runtime.id, browser.runtime.getURL("/"))
	)
		return
	return (async () => {
		try {
			await handleCommand(message)
			return { ok: true }
		} catch (error) {
			const failure = error instanceof Error ? error.message : "This PDF could not be read. Select the text again."
			if (alive) status.textContent = failure
			return { ok: false, error: failure }
		}
	})()
})

function clearMapping() {
	nativeMapping = undefined
	currentHighlight = undefined
	pendingSelection = undefined
	CSS.highlights?.delete(highlightKey)
}

window.readAloudHost = createReaderDispatcher({
	session,
	selection: takeSelection,
	replaced: clearMapping,
	close: stop,
	resize(size) {
		if (!frame) throw new Error("This reading session has ended.")
		frame.style.height = `${size.height}px`
		if (size.width !== undefined) controls.style.maxWidth = `${size.width}px`
	},
	async highlight(start, end) {
		currentHighlight = { start, end }
		const printed = nativeMapping?.document ?? session.source
		const bounds = nativeMapping ? nativeMapping.range(start, end) : { start, end }
		if (!bounds || !printed) {
			paintReaderHighlight(null)
			return
		}
		const current = session.revision
		try {
			for (const run of overlappingRuns(printed, bounds.start, bounds.end)) {
				const page = owners.get(run.node)
				if (page) await ensureText(page)
			}
		} catch {
			if (alive) status.textContent = "Could not highlight this page. Playback continues."
			throw new Error("Could not highlight this page. Playback continues.")
		}
		if (!session.isCurrent(current) || !alive || !frame) return
		paintReaderHighlight(sourceRange(printed, bounds.start, bounds.end))
	},
})

const renderers = new Map<Element, PageState>()
const observer = new IntersectionObserver(
	(entries) => {
		for (const entry of entries) {
			const item = renderers.get(entry.target)
			if (!item) continue
			item.visible = entry.isIntersecting
			if (!entry.isIntersecting) item.task?.cancel()
			item.pending = item.pending
				.catch(() => {})
				.then(async () => {
					if (!alive) return
					if (!item.visible) {
						item.canvas.width = item.canvas.height = 0
						entry.target.removeAttribute("data-painted")
						return
					}
					await ensureText(item)
					if (!item.visible || !alive) return
					const pixelRatio = Math.min(devicePixelRatio, 2)
					item.canvas.width = Math.ceil(item.viewport.width * pixelRatio)
					item.canvas.height = Math.ceil(item.viewport.height * pixelRatio)
					item.task = item.page.render({
						canvas: item.canvas,
						viewport: item.viewport,
						...(pixelRatio === 1 ? {} : { transform: [pixelRatio, 0, 0, pixelRatio, 0, 0] }),
					})
					try {
						await item.task.promise
						if (item.visible && alive) entry.target.setAttribute("data-painted", "")
					} catch (error) {
						if (!(error instanceof Error && error.name === "RenderingCancelledException") && alive) throw error
					}
				})
				.catch(() => {
					if (alive) status.textContent = "A page image could not be rendered. Its text is still available."
				})
		}
	},
	{ rootMargin: "100% 0px" },
)
let pdfTask: ReturnType<typeof getDocument> | undefined
const lifecycle = new AbortController()
window.addEventListener(
	"pagehide",
	() => {
		alive = false
		lifecycle.abort()
		stop()
		observer.disconnect()
		for (const renderer of renderers.values()) renderer.task?.cancel()
		if (pendingSelectionKey) void browser.storage.session.remove(pendingSelectionKey)
		void pdfTask?.destroy()
	},
	{ once: true },
)

async function load() {
	const raw = params.get("src")
	if (!raw) throw new Error("Open a PDF and choose Read Aloud from the browser toolbar.")
	const url = new URL(raw)
	if (!["https:", "http:", "file:"].includes(url.protocol)) throw new Error("This PDF address is not supported.")
	await ownTab
	let initial: ReadingDocument | undefined
	if (params.has("source") && tabId !== undefined) {
		const stored = await browser.storage.session.get(readingKeys.pdfReaders)
		if (parsePdfReaders(stored[readingKeys.pdfReaders])[tabId] !== Number(params.get("source"))) {
			allowStart = false
			status.textContent = "Reading stopped because the original PDF changed or closed."
		}
	}
	if (params.get("mode") === "selection" && tabId !== undefined) {
		const token = params.get("selection")
		if (token !== null && !isPdfSelectionToken(token)) throw new Error("This PDF selection could not be opened.")
		const name = pdfSelectionKey(tabId, token ?? undefined)
		pendingSelectionKey = name
		const stored = await browser.storage.session.get(name)
		await browser.storage.session.remove(name)
		pendingSelectionKey = undefined
		if (typeof stored[name] !== "string" || !stored[name].trim())
			throw new Error("The PDF selection is no longer available. Select it in this reader and try again.")
		initial = normalizeDocument({ text: stored[name], runs: [] }, true)
		if (allowStart && alive) await start("selection", initial)
	}
	GlobalWorkerOptions.workerSrc = new URL("/pdf-runtime/pdf.worker.mjs", location.href).href
	let bytes: Uint8Array<ArrayBuffer> | undefined
	for (let attempt = 0; attempt < 2; attempt++) {
		const response = await fetchPdf(url, lifecycle.signal, status)
		if (!response.ok) throw new Error("The PDF could not be downloaded. Open it on its original site and try again.")
		const candidate = new Uint8Array(await response.arrayBuffer())
		// A login/challenge response can establish cookies before serving the
		// document. PDF.js remains the authority on whether the bytes are valid.
		if (
			attempt === 0 &&
			response.headers.get("content-type")?.includes("text/html") &&
			!new TextDecoder().decode(candidate.subarray(0, 1024)).includes("%PDF-")
		) {
			await new Promise((resolve) => setTimeout(resolve, 700))
			continue
		}
		bytes = candidate
		break
	}
	if (!bytes) throw new Error("The document could not be opened. Try again.")
	lifecycle.signal.throwIfAborted()
	const base = new URL("pdf-runtime/", location.href)
	const task = getDocument({
		data: bytes,
		cMapUrl: new URL("cmaps/", base).href,
		cMapPacked: true,
		standardFontDataUrl: new URL("standard_fonts/", base).href,
		wasmUrl: new URL("wasm/", base).href,
		iccUrl: new URL("iccs/", base).href,
		verbosity: 0,
	})
	pdfTask = task
	const pdf = await task.promise.catch(async (error: unknown) => {
		if (error instanceof Error && error.message.startsWith("Setting up fake worker failed:")) {
			let reason = error.message
			let line: number | undefined
			try {
				// Recover the module error swallowed by PDF.js. Only packaged-code
				// metadata is logged, never a PDF URL or selected text.
				// @ts-expect-error Packaged by prepare-runtime.ts, outside the module graph.
				await import(/* @vite-ignore */ "/pdf-runtime/pdf.worker.mjs")
			} catch (moduleError: unknown) {
				if (moduleError instanceof Error) {
					reason = moduleError.message
					if ("lineNumber" in moduleError && typeof moduleError.lineNumber === "number") line = moduleError.lineNumber
				}
			}
			console.error("Read Aloud: PDF worker startup failed", {
				asset: new URL(GlobalWorkerOptions.workerSrc, location.href).pathname,
				reason,
				line,
			})
			throw new Error("The PDF reader could not start. Reload the extension and reopen this PDF.")
		}
		if (error instanceof Error && error.name === "InvalidPDFException")
			throw new Error("This document is not a readable PDF. Open a PDF and try again.")
		throw error
	})
	const result: ReadingDocument = { text: "", runs: [] }
	complete = result
	const textRequests = new Map<number, Promise<{ page: PDFPageProxy; content: PageState["content"] }>>()
	const pageText = (number: number) => {
		let pending = textRequests.get(number)
		if (!pending) {
			pending = pdf.getPage(number).then(async (page) => ({ page, content: await page.getTextContent() }))
			void pending.catch(() => {}) // A stopped reader may never consume prefetched work.
			textRequests.set(number, pending)
		}
		return pending
	}
	if (pdf.numPages > 1) void pageText(2)
	for (let n = 1; n <= pdf.numPages && alive; n++) {
		// Keep progress visual without announcing every extracted page.
		status.setAttribute("aria-live", "off")
		status.textContent = `Opening PDF · ${n} of ${pdf.numPages} pages`
		const { page, content } = await pageText(n)
		textRequests.delete(n)
		if (n + 1 <= pdf.numPages) void pageText(n + 1)
		const scale = Math.min(1.4, Math.max(280, innerWidth - 40) / page.getViewport({ scale: 1 }).width)
		const viewport = page.getViewport({ scale })
		const section = document.createElement("section")
		section.className = "pdf-page"
		section.setAttribute("aria-label", `Page ${n}`)
		section.style.width = `${viewport.width}px`
		section.style.height = `${viewport.height}px`
		section.style.setProperty("--total-scale-factor", String(scale))
		const canvas = document.createElement("canvas")
		canvas.width = canvas.height = 0
		canvas.setAttribute("aria-hidden", "true")
		const container = document.createElement("div")
		container.className = "textLayer"
		section.append(canvas, container)
		pages.append(section)
		const state: PageState = {
			page,
			canvas,
			container,
			content,
			viewport,
			runs: [],
			visible: false,
			pending: Promise.resolve(),
		}
		for (const item of content.items) {
			if (!("str" in item)) continue
			if (!item.str) {
				if (item.hasEOL && !result.text.endsWith("\n")) result.text += "\n"
				state.runs.push(undefined)
				continue
			}
			const node = document.createTextNode(item.str)
			const run = { from: result.text.length, to: result.text.length + item.str.length, node, offset: 0 }
			owners.set(node, state)
			state.runs.push(run)
			result.runs.push(run)
			result.text += item.str
			if (item.hasEOL) result.text += "\n"
		}
		result.text = result.text.replace(/\n?$/u, "\n\n")
		invalidateSelectionIndex(complete)
		renderers.set(section, state)
		observer.observe(section)
	}
	complete = normalizeDocument(result, true)
	indexing = false
	indexed.resolve()
	status.textContent = ""
	status.setAttribute("aria-live", "polite")
	if (initial && session.source === initial && frame && alive) {
		try {
			nativeMapping = mapNativeSelection(complete, initial.text)
			if (currentHighlight)
				await window.readAloudHost?.({ session: session.id, command: "highlight", ...currentHighlight })
		} catch {
			status.textContent = "Highlighting is unavailable for this selection."
		}
	}
	if (!initial && allowStart && alive) await start("article")
}

void load().catch((error) => {
	indexed.reject(error)
	status.setAttribute("aria-live", "polite")
	if (pendingSelectionKey) void browser.storage.session.remove(pendingSelectionKey)
	if (!alive) return
	status.textContent = error instanceof Error ? error.message : "This PDF could not be opened."
})
