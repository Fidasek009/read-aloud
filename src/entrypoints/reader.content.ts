import { defineContentScript } from "#imports"
import { browser } from "wxt/browser"

import { isExtensionBackgroundSender, isExtensionPageSender } from "../extension/sender.ts"
import { captureDocument, type ReadingDocument, sourceRange } from "../reading/document.ts"
import { isReaderRequest, readerSize, shouldScrollToWord } from "../reading/host.ts"

import currentWordStyle from "../reading/current-word.css?inline"

export default defineContentScript({
	registration: "runtime",
	main(ctx) {
		const scope = globalThis as { __readAloudInstalled?: boolean }
		if (scope.__readAloudInstalled) return
		scope.__readAloudInstalled = true
		let source: ReadingDocument | undefined
		let session = ""
		let host: HTMLDivElement | undefined
		let frame: HTMLIFrameElement | undefined
		const pageAddress = () => `${location.origin}${location.pathname}${location.search}`
		let sourceUrl = pageAddress()
		let navigationTimer: ReturnType<typeof setInterval> | undefined
		const key = "read-aloud-current-word"
		const style = document.createElement("style")
		style.textContent = currentWordStyle
		const close = () => {
			clearInterval(navigationTimer)
			navigationTimer = undefined
			host?.remove()
			host = undefined
			frame = undefined
			source = undefined
			session = ""
			CSS.highlights?.delete(key)
			style.remove()
		}
		const onMessage: Parameters<typeof browser.runtime.onMessage.addListener>[0] = (message: unknown, sender) => {
			if (
				(!isExtensionPageSender(sender, browser.runtime.id, browser.runtime.getURL("/")) &&
					!isExtensionBackgroundSender(sender, browser.runtime.id, browser.runtime.getURL("/"))) ||
				!message ||
				typeof message !== "object" ||
				!("type" in message)
			)
				return
			if (
				message.type === "start-reading" &&
				"mode" in message &&
				(message.mode === "selection" || message.mode === "article")
			) {
				try {
					if ("reveal" in message && message.reveal === true && frame?.isConnected) {
						frame.focus()
						return Promise.resolve({ ok: true })
					}
					const captured = captureDocument(message.mode)
					if (message.mode === "selection") window.getSelection()?.removeAllRanges()
					sourceUrl = pageAddress()
					if (frame?.isConnected) {
						source = captured
						return Promise.resolve({ ok: true, reuse: true, session })
					}
					close()
					source = captured
					session = crypto.randomUUID()
					host = document.createElement("div")
					host.dataset.readAloud = ""
					host.style.cssText =
						"all:initial!important;position:fixed!important;top:12px!important;left:50%!important;transform:translateX(-50%)!important;width:calc(100vw - 24px)!important;max-width:640px!important;z-index:2147483647!important;display:block!important;"
					const shadow = host.attachShadow({ mode: "open" })
					frame = document.createElement("iframe")
					frame.title = "Read Aloud playback controls"
					frame.src = `${browser.runtime.getURL("/player.html")}#${session}`
					frame.allow = "autoplay"
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
			if (message.type === "stop-reading") {
				close()
				return Promise.resolve({ ok: true })
			}
			if (message.type !== "reader") return
			if (!isReaderRequest(message)) return Promise.resolve({ error: "Invalid reading request." })
			if (!session || message.session !== session) return Promise.resolve({ error: "This reading session has ended." })
			if (message.command === "document") return Promise.resolve({ text: source?.text ?? "" })
			if (message.command === "selection") {
				if (!window.getSelection()?.toString().trim()) return Promise.resolve({ text: null })
				try {
					source = captureDocument("selection")
					window.getSelection()?.removeAllRanges()
					CSS.highlights?.delete(key)
					return Promise.resolve({ text: source.text })
				} catch (error) {
					return Promise.resolve({
						error: error instanceof Error ? error.message : "This selection could not be read.",
					})
				}
			}
			if (message.command === "close") {
				close()
				return Promise.resolve({ ok: true })
			}
			if (message.command === "resize" && frame) {
				const size = readerSize(message.height, message.width)
				frame.style.height = `${size.height}px`
				if (host && size.width !== undefined) host.style.setProperty("max-width", `${size.width}px`, "important")
			}
			if (message.command === "highlight" && source) {
				const range = sourceRange(source, message.start, message.end)
				if (range && CSS.highlights) {
					CSS.highlights.set(key, new Highlight(range))
					const rect = range.getBoundingClientRect()
					if (shouldScrollToWord(rect.top, rect.bottom, innerHeight))
						window.scrollBy({ top: rect.top - innerHeight * 0.4, behavior: "instant" })
				} else CSS.highlights?.delete(key)
			}
			return Promise.resolve({ ok: true })
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
