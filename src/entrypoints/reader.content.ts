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
		let padding: { value: string; priority: string; computed: number; applied: string } | undefined
		const reserve = (height: number) => {
			const root = document.documentElement
			padding ??= {
				value: root.style.getPropertyValue("padding-top"),
				priority: root.style.getPropertyPriority("padding-top"),
				computed: parseFloat(getComputedStyle(root).paddingTop) || 0,
				applied: "",
			}
			padding.applied = `${padding.computed + height + 32}px`
			root.style.setProperty("padding-top", padding.applied, "important")
		}
		const key = "read-aloud-current-word"
		const style = document.createElement("style")
		style.textContent = `::highlight(${key}) { background: #ffdc78; color: #14191f; }`
		const close = () => {
			if (padding && document.documentElement.style.getPropertyValue("padding-top") === padding.applied) {
				if (padding.value) document.documentElement.style.setProperty("padding-top", padding.value, padding.priority)
				else document.documentElement.style.removeProperty("padding-top")
			}
			padding = undefined
			host?.remove()
			host = undefined
			frame = undefined
			source = undefined
			session = ""
			CSS.highlights?.delete(key)
			style.remove()
		}
		browser.runtime.onMessage.addListener((message: unknown, sender) => {
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
						"all:initial!important;position:fixed!important;top:16px!important;left:50%!important;transform:translateX(-50%)!important;width:calc(100vw - 32px)!important;max-width:800px!important;z-index:2147483647!important;display:block!important;"
					const shadow = host.attachShadow({ mode: "open" })
					frame = document.createElement("iframe")
					frame.title = "Read Aloud playback controls"
					frame.src = `${browser.runtime.getURL("/player.html")}#${session}`
					frame.allow = "autoplay"
					frame.style.cssText =
						"display:block;width:100%;height:104px;border:0;color-scheme:light dark;border-radius:14px;box-shadow:0 6px 30px #0003;"
					shadow.append(frame)
					document.documentElement.append(host, style)
					reserve(104)
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
			if (message.command === "close") {
				close()
				return Promise.resolve({ ok: true })
			}
			if (message.command === "resize" && "height" in message && typeof message.height === "number" && frame) {
				const height = Math.min(180, Math.max(64, message.height))
				frame.style.height = `${height}px`
				reserve(height)
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
		})
		ctx.addEventListener(window, "pagehide", close)
		ctx.setInterval(() => {
			if (host && location.href !== sourceUrl) close()
		}, 300)
		ctx.onInvalidated(() => {
			scope.__readAloudInstalled = false
			close()
		})
	},
})
