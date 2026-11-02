import { defineContentScript } from "#imports"
import { browser } from "wxt/browser"

import { captureDocument, type ReadingDocument, sourceRange } from "../reading/document.ts"

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
		let sourceUrl = location.href
		const key = "read-aloud-current-word"
		const style = document.createElement("style")
		style.textContent = `::highlight(${key}) { background: #ffdc78; color: #14191f; }`
		const close = () => {
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
				sender.id !== browser.runtime.id ||
				(sender.url && !sender.url.startsWith(browser.runtime.getURL("/"))) ||
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
					sourceUrl = location.href
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
					return Promise.resolve({ ok: true })
				} catch (error) {
					return Promise.resolve({ error: error instanceof Error ? error.message : "This page could not be read." })
				}
			}
			if (message.type === "stop-reading") {
				close()
				return Promise.resolve({ ok: true })
			}
			if (
				message.type !== "reader" ||
				!("session" in message) ||
				message.session !== session ||
				!("command" in message)
			)
				return
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
			if (message.command === "resize" && "height" in message && typeof message.height === "number" && frame) {
				const height = Math.min(240, Math.max(44, message.height))
				frame.style.height = `${height}px`
				if (host && "width" in message && typeof message.width === "number" && Number.isFinite(message.width)) {
					host.style.setProperty("max-width", `${Math.min(640, Math.max(240, message.width))}px`, "important")
				}
			}
			if (
				message.command === "highlight" &&
				source &&
				"start" in message &&
				"end" in message &&
				typeof message.start === "number" &&
				typeof message.end === "number"
			) {
				const range = sourceRange(source, message.start, message.end)
				if (range && CSS.highlights) {
					CSS.highlights.set(key, new Highlight(range))
					const rect = range.getBoundingClientRect()
					if (rect.top < 140 || rect.bottom > innerHeight - 50)
						window.scrollBy({ top: rect.top - innerHeight * 0.4, behavior: "instant" })
				} else CSS.highlights?.delete(key)
			}
			return Promise.resolve({ ok: true })
		}
		browser.runtime.onMessage.addListener(onMessage)
		ctx.addEventListener(window, "pagehide", close)
		ctx.setInterval(() => {
			if (host && location.href !== sourceUrl) close()
		}, 300)
		ctx.onInvalidated(() => {
			browser.runtime.onMessage.removeListener(onMessage)
			scope.__readAloudInstalled = false
			close()
		})
	},
})
