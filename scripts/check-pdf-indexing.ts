import type {} from "../src/reading/bridge.ts"

import { pageScript } from "./page-script.ts"

interface IndexingGate {
	held: number
	release(): void
}
type IndexingWindow = Window & { __pdfIndexingGate?: IndexingGate }

/** Test copy only: hold later PDF.js text requests while keeping the first page usable. */
function installIndexingGate() {
	if (!new URLSearchParams(location.search).has("probeIndexing")) return
	const waiting: (() => void)[] = []
	let released = false
	const gate: IndexingGate = {
		held: 0,
		release() {
			released = true
			for (const send of waiting.splice(0)) send()
		},
	}
	;(window as IndexingWindow).__pdfIndexingGate = gate
	const post = Worker.prototype.postMessage
	Worker.prototype.postMessage = function (message: unknown, ...options: unknown[]) {
		const send = () => Reflect.apply(post, this, [message, ...options])
		if (
			!released &&
			message &&
			typeof message === "object" &&
			"action" in message &&
			message.action === "GetTextContent" &&
			"data" in message &&
			message.data &&
			typeof message.data === "object" &&
			"pageIndex" in message.data &&
			typeof message.data.pageIndex === "number" &&
			message.data.pageIndex > 0
		) {
			gate.held++
			waiting.push(send)
		} else send()
	}
}

export async function observePdfIndexing(directory: string) {
	await Bun.write(`${directory}/probe-pdf-indexing.js`, pageScript(installIndexingGate))
	const html = Bun.file(`${directory}/pdf.html`)
	await Bun.write(html, (await html.text()).replace("<head>", '<head><script src="probe-pdf-indexing.js"></script>'))
}

/** Exercises the installed background listener and the actual reader while extraction is held. */
async function checkIndexingInBrowser(mode: "missing" | "selection") {
	const gate = (window as IndexingWindow).__pdfIndexingGate
	if (!gate?.held) throw new Error("The PDF indexing fixture did not hold later pages")
	const globals = globalThis as unknown as {
		chrome: typeof import("wxt/browser").browser
		browser?: typeof import("wxt/browser").browser
	}
	const api = globals.browser ?? globals.chrome
	const tab = await api.tabs.getCurrent()
	if (tab?.id === undefined) throw new Error("The PDF indexing fixture has no tab")
	const invoke = (selection: boolean) =>
		api.runtime.sendMessage({
			type: "probe-context-menu",
			tab,
			info: { menuItemId: selection ? "read-selection" : "read-page", pageUrl: location.href },
		}) as Promise<{ ok: boolean; error?: string }>
	const selection = getSelection()
	if (!selection) throw new Error("The PDF selection API is unavailable")
	selection.removeAllRanges()
	let expected: string | undefined
	if (mode === "missing") {
		const result = await invoke(true)
		if (result.ok || !result.error?.includes("Select some PDF text first."))
			throw new Error("An empty selection during indexing was not rejected")
	} else {
		// This must resolve before release: background routing must not block a
		// subsequent selection behind article preparation's indexing promise.
		const article = await Promise.race([
			invoke(false),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error("Article preparation blocked selection routing")), 2000),
			),
		])
		if (!article.ok) throw new Error("Article preparation was not accepted")
		const layer = document.querySelector(".pdf-page .textLayer")
		if (!layer) throw new Error("The first PDF page has no text layer")
		const walker = document.createTreeWalker(layer, NodeFilter.SHOW_TEXT)
		let selected: Text | undefined
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			if (node instanceof Text && node.data.trim().length >= 10) {
				selected = node
				break
			}
		}
		if (!selected) throw new Error("No readable text on the first PDF page")
		const range = document.createRange()
		range.selectNodeContents(selected)
		selection.addRange(range)
		expected = selected.data
		const result = await invoke(true)
		if (!result.ok) throw new Error("An indexed-page selection failed during extraction: " + result.error)
		const frame = document.querySelector<HTMLIFrameElement>("iframe")
		if (!frame) throw new Error("Selection did not open the player before indexing completed")
		const reply = await window.readAloudHost?.({ session: new URL(frame.src).hash.slice(1), command: "document" })
		if (!reply || !("text" in reply) || reply.text !== expected)
			throw new Error("Reading scope does not match the selected text during indexing")
	}
	gate.release()
	const deadline = performance.now() + 15000
	while (document.querySelectorAll(".pdf-page").length < 60 && performance.now() < deadline)
		await new Promise<void>((resolve) => setTimeout(resolve, 25))
	await new Promise<void>((resolve) => setTimeout(resolve, 100))
	if (document.querySelectorAll(".pdf-page").length !== 60) throw new Error("PDF indexing did not finish after release")
	const frame = document.querySelector<HTMLIFrameElement>("iframe")
	if (mode === "missing") {
		if (frame) throw new Error("A rejected selection silently started the whole PDF after indexing")
	} else {
		if (!frame) throw new Error("The selected scope disappeared after indexing")
		const reply = await window.readAloudHost?.({ session: new URL(frame.src).hash.slice(1), command: "document" })
		if (!reply || !("text" in reply) || reply.text !== expected)
			throw new Error("Indexing completion replaced the selected scope with the whole PDF")
	}
	return {
		duringIndexing: mode,
		scopePreserved: true,
		...(mode === "missing" ? { rejectedSelectionDoesNotAutostart: true } : {}),
	}
}

export const checkPdfIndexing = (mode: "missing" | "selection") => pageScript(checkIndexingInBrowser, mode)
