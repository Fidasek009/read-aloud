import type { PDFPageProxy, RenderTask } from "pdfjs-dist"

import { getDocument, GlobalWorkerOptions, TextLayer } from "pdfjs-dist"
import { browser } from "wxt/browser"

import type { ReaderRequest } from "../../reading/host.ts"

import { captureDocument, type ReadingDocument, sourceRange, type TextRun } from "../../reading/document.ts"
import { locateSelection } from "../../reading/selection.ts"
import "pdfjs-dist/web/pdf_viewer.css"
import "./style.css"

const pages = document.querySelector<HTMLDivElement>("#pages")!
const status = document.querySelector<HTMLParagraphElement>("#status")!
const controls = document.querySelector<HTMLDivElement>("#controls")!
const params = new URLSearchParams(location.search)
const key = "read-aloud-current-word"
const session = crypto.randomUUID()
let source: ReadingDocument = { text: "", runs: [] }
let complete: ReadingDocument = source
let frame: HTMLIFrameElement | undefined
let tabId: number | undefined
let alive = true
let revision = 0
let allowStart = true
interface PageState {
	page: PDFPageProxy
	canvas: HTMLCanvasElement
	container: HTMLDivElement
	content: Awaited<ReturnType<PDFPageProxy["getTextContent"]>>
	viewport: ReturnType<PDFPageProxy["getViewport"]>
	runs: (TextRun | undefined)[]
	task?: RenderTask
	visible: boolean
	textReady?: Promise<void>
	pending: Promise<void>
}
const owners = new WeakMap<Text, { page: PageState; run: TextRun }>()

function ensureText(state: PageState): Promise<void> {
	return (state.textReady ??= (async () => {
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
			owners.set(node, { page: state, run })
		}
	})())
}

function stop() {
	revision++
	frame?.remove()
	frame = undefined
	CSS.highlights?.delete(key)
}

async function start(mode: "article" | "selection", initial?: ReadingDocument) {
	revision++
	if (!complete.text.trim()) throw new Error("This PDF has no readable text layer.")
	source = initial ?? (mode === "selection" ? captureDocument("selection") : complete)
	if (mode === "selection") window.getSelection()?.removeAllRanges()
	if (frame) {
		frame.contentWindow?.dispatchEvent(new Event("read-aloud-source-changed"))
		return
	}
	frame = document.createElement("iframe")
	frame.title = "Read Aloud playback controls"
	frame.allow = "autoplay"
	frame.src = `${browser.runtime.getURL("/player.html")}#${session}`
	controls.append(frame)
}

window.readAloudHost = async (message: ReaderRequest) => {
	if (message.session !== session) throw new Error("This reading session has ended")
	if (message.command === "document") return { text: source.text }
	if (message.command === "close") {
		stop()
		return { ok: true }
	}
	if (message.command === "resize" && typeof message.height === "number" && frame)
		frame.style.height = `${Math.min(180, Math.max(64, message.height))}px`
	if (message.command === "highlight" && typeof message.start === "number" && typeof message.end === "number") {
		const current = revision
		for (const run of source.runs.filter((run) => run.from < message.end! && run.to > message.start!)) {
			const owner = owners.get(run.node)
			if (owner) {
				await ensureText(owner.page)
				run.node = owner.run.node
			}
		}
		if (current !== revision || !alive || !frame) return { ok: false }
		const range = sourceRange(source, message.start, message.end)
		if (range && CSS.highlights) {
			CSS.highlights.set(key, new Highlight(range))
			const rect = range.getBoundingClientRect()
			if (rect.top < 150 || rect.bottom > innerHeight - 50)
				window.scrollBy({ top: rect.top - innerHeight * 0.4, behavior: "instant" })
		} else CSS.highlights?.delete(key)
	}
	return { ok: true }
}

browser.runtime.onMessage.addListener((message: unknown, sender) => {
	if (
		sender.id !== browser.runtime.id ||
		!message ||
		typeof message !== "object" ||
		!("tabId" in message) ||
		message.tabId !== tabId ||
		!("type" in message)
	)
		return
	if (message.type === "pdf-stop") {
		allowStart = false
		stop()
		return Promise.resolve({ ok: true })
	}
	if (
		message.type === "pdf-read" &&
		"mode" in message &&
		(message.mode === "selection" || message.mode === "article")
	) {
		const mode = message.mode
		return (async () => {
			allowStart = true
			await start(mode)
		})().then(
			() => ({ ok: true }),
			(error) => ({ error: error instanceof Error ? error.message : "This PDF could not be read." }),
		)
	}
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

async function load() {
	const raw = params.get("src")
	if (!raw) throw new Error("Open a PDF and choose Read Aloud from the browser toolbar.")
	const url = new URL(raw)
	if (!["https:", "http:"].includes(url.protocol)) throw new Error("This PDF address is not supported.")
	tabId = (await browser.tabs.getCurrent())?.id
	GlobalWorkerOptions.workerSrc = browser.runtime.getURL("/pdf-runtime/pdf.worker.mjs")
	let bytes: Uint8Array<ArrayBuffer> | undefined
	for (let attempt = 0; attempt < 2; attempt++) {
		const response = await fetch(url, {
			credentials: "include",
			referrerPolicy: "no-referrer",
			signal: AbortSignal.timeout(60_000),
		})
		if (!response.ok) throw new Error("The PDF could not be downloaded. Open it on its original site and try again.")
		const candidate = new Uint8Array(await response.arrayBuffer())
		if (new TextDecoder().decode(candidate.subarray(0, 5)) === "%PDF-") {
			bytes = candidate
			break
		}
		// Some document sites establish a session cookie before serving PDF bytes.
		if (attempt === 0 && response.headers.get("content-type")?.includes("text/html")) {
			await new Promise((resolve) => setTimeout(resolve, 700))
			continue
		}
		break
	}
	if (!bytes)
		throw new Error("The site returned a web page instead of a PDF. Open the original PDF on its site, then try again.")
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
	window.addEventListener(
		"pagehide",
		() => {
			alive = false
			stop()
			observer.disconnect()
			for (const renderer of renderers.values()) renderer.task?.cancel()
			void task.destroy()
		},
		{ once: true },
	)
	const pdf = await task.promise
	const result: ReadingDocument = { text: "", runs: [] }
	for (let n = 1; n <= pdf.numPages && alive; n++) {
		status.textContent = `Opening PDF · ${n} of ${pdf.numPages} pages`
		const page = await pdf.getPage(n)
		const scale = Math.min(1.4, Math.max(280, innerWidth - 40) / page.getViewport({ scale: 1 }).width)
		const viewport = page.getViewport({ scale })
		const section = document.createElement("section")
		section.className = "pdf-page"
		section.setAttribute("aria-label", `Page ${n}`)
		section.dataset.scale = String(scale)
		section.style.cssText = `width:${viewport.width}px;height:${viewport.height}px;--total-scale-factor:${scale};`
		const canvas = document.createElement("canvas")
		canvas.width = canvas.height = 0
		canvas.setAttribute("aria-hidden", "true")
		const container = document.createElement("div")
		container.className = "textLayer"
		section.append(canvas, container)
		pages.append(section)
		const content = await page.getTextContent()
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
				state.runs.push(undefined)
				continue
			}
			if (result.text && !/\s$/u.test(result.text) && !/^\s/u.test(item.str)) result.text += " "
			const node = document.createTextNode(item.str)
			const run = { from: result.text.length, to: result.text.length + item.str.length, node, offset: 0 }
			owners.set(node, { page: state, run })
			state.runs.push(run)
			result.runs.push(run)
			result.text += item.str
		}
		result.text += "\n"
		renderers.set(section, state)
		observer.observe(section)
	}
	complete = result
	let requested: ReadingDocument | undefined
	status.textContent = ""
	if (params.get("mode") === "selection" && tabId !== undefined) {
		const name = `pdfSelection:${tabId}`
		const stored = await browser.storage.session.get(name)
		await browser.storage.session.remove(name)
		if (typeof stored[name] !== "string")
			throw new Error("The PDF selection is no longer available. Select it in this reader and try again.")
		requested = locateSelection(result, stored[name])
	}
	if (params.has("source") && tabId !== undefined) {
		const { pdfReaders } = await browser.storage.session.get("pdfReaders")
		if (
			!pdfReaders ||
			typeof pdfReaders !== "object" ||
			(pdfReaders as Record<string, unknown>)[tabId] !== Number(params.get("source"))
		) {
			allowStart = false
			status.textContent = "Reading stopped because the original PDF changed or closed."
		}
	}
	if (allowStart && alive) await start("article", requested)
}
void load().catch((error) => {
	status.textContent = error instanceof Error ? error.message : "This PDF could not be opened."
})
