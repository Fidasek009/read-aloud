import { pageScript } from "./page-script.ts"

/** Self-contained acceptance assertions serialized into the real extension PDF tab. */
async function checkPdfZoomInBrowser() {
	function page(): HTMLElement {
		const node = document.querySelector<HTMLElement>(".pdf-page")
		if (!node) throw Error("Missing PDF zoom fixture page")
		return node
	}
	function control(id: string): HTMLButtonElement {
		const node = document.querySelector<HTMLButtonElement>(id)
		if (!node) throw Error("Missing PDF zoom fixture control: " + id)
		return node
	}
	const level = document.querySelector<HTMLElement>("#zoom-level")
	if (!level) throw Error("Missing PDF zoom fixture level")
	const width = () => page().getBoundingClientRect().width
	const before = width()
	control("#zoom-in").click()
	const button = width()
	const buttonLevel = level.textContent
	const event = new WheelEvent("wheel", { deltaY: -100, ctrlKey: true, cancelable: true, bubbles: true })
	window.dispatchEvent(event)
	const wheel = width()
	control("#zoom-reset").click()
	return { before, button, level: buttonLevel, wheel, prevented: event.defaultPrevented, reset: width() }
}

export type PdfZoomResult = Awaited<ReturnType<typeof checkPdfZoomInBrowser>>

export const checkPdfZoom = pageScript(checkPdfZoomInBrowser)
