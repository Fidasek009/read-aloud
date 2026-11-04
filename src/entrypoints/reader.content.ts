import { defineContentScript } from "#imports"
import { browser } from "wxt/browser"

import { isExtensionBackgroundSender, isExtensionPageSender } from "../extension/sender.ts"
import { createReaderDispatcher } from "../reading/dispatch.ts"
import { captureDocument, type ReadingDocument, sourceRange } from "../reading/document.ts"
import { currentWordHighlight, paintReaderHighlight } from "../reading/layout.ts"
import { isStartReadingMessage, readingMessages } from "../reading/messages.ts"
import { ReaderSession } from "../reading/session.ts"

import currentWordStyle from "../reading/current-word.css?inline"

export default defineContentScript({
	registration: "runtime",
	main(ctx) {
		const scope = globalThis as { __readAloudInstalled?: boolean }
		if (scope.__readAloudInstalled) return
		scope.__readAloudInstalled = true
		const session = new ReaderSession<ReadingDocument>()
		let host: HTMLDivElement | undefined
		let frame: HTMLIFrameElement | undefined
		const pageAddress = () => `${location.origin}${location.pathname}${location.search}`
		let sourceUrl = pageAddress()
		let navigationTimer: ReturnType<typeof setInterval> | undefined
		const key = currentWordHighlight
		const style = document.createElement("style")
		style.textContent = currentWordStyle
		const close = () => {
			clearInterval(navigationTimer)
			navigationTimer = undefined
			host?.remove()
			host = undefined
			frame = undefined
			session.close()
			CSS.highlights?.delete(key)
			style.remove()
		}
		const dispatch = createReaderDispatcher({
			session,
			selection() {
				if (!window.getSelection()?.toString().trim()) return undefined
				const selected = captureDocument("selection")
				window.getSelection()?.removeAllRanges()
				return selected
			},
			replaced() {
				CSS.highlights?.delete(key)
			},
			close,
			resize(size) {
				if (!frame || !host) throw new Error("This reading session has ended.")
				frame.style.height = `${size.height}px`
				if (size.width !== undefined) host.style.setProperty("max-width", `${size.width}px`, "important")
			},
			highlight(start, end) {
				paintReaderHighlight(session.source ? sourceRange(session.source, start, end) : null)
			},
		})
		const onMessage: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (message: unknown, sender) => {
			if (!message || typeof message !== "object" || !("type" in message)) return
			const background = isExtensionBackgroundSender(sender, browser.runtime.id, browser.runtime.getURL("/"))
			const player = isExtensionPageSender(sender, browser.runtime.id, browser.runtime.getURL("/"), ["/player.html"])
			if (isStartReadingMessage(message) && background) {
				try {
					if ("reveal" in message && message.reveal === true && frame?.isConnected) {
						frame.focus()
						return Promise.resolve({ ok: true })
					}
					const captured = captureDocument(message.mode)
					if (message.mode === "selection") window.getSelection()?.removeAllRanges()
					sourceUrl = pageAddress()
					if (frame?.isConnected) {
						session.replace(captured)
						CSS.highlights?.delete(key)
						return Promise.resolve({ ok: true, reuse: true, session: session.id })
					}
					close()
					session.replace(captured)
					host = document.createElement("div")
					host.dataset.readAloud = ""
					host.style.cssText =
						"all:initial!important;position:fixed!important;top:12px!important;left:50%!important;transform:translateX(-50%)!important;width:calc(100vw - 24px)!important;max-width:640px!important;z-index:2147483647!important;display:block!important;"
					const shadow = host.attachShadow({ mode: "open" })
					frame = document.createElement("iframe")
					frame.title = "Read Aloud playback controls"
					frame.src = `${browser.runtime.getURL("/player.html")}#${session.id}`
					if (import.meta.env.BROWSER !== "firefox") frame.allow = "autoplay"
					frame.style.cssText =
						"display:block;width:100%;height:52px;border:0;border-radius:12px;color-scheme:light dark;"
					shadow.append(frame)
					document.documentElement.append(host, style)
					navigationTimer = setInterval(() => {
						if (pageAddress() !== sourceUrl) close()
					}, 300)
					return Promise.resolve({ ok: true })
				} catch (error) {
					return Promise.resolve({ error: error instanceof Error ? error.message : "This page could not be read." })
				}
			}
			if (message.type === readingMessages.stop && background) {
				close()
				return Promise.resolve({ ok: true })
			}
			if (message.type !== readingMessages.reader || (!background && !player)) return
			return dispatch(message)
		}
		browser.runtime.onMessage.addListener(onMessage)
		ctx.addEventListener(window, "pagehide", close)
		ctx.onInvalidated(() => {
			browser.runtime.onMessage.removeListener(onMessage)
			scope.__readAloudInstalled = false
			close()
		})
	},
})
