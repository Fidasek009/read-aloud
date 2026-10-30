import { defineBackground } from "#imports"
import { browser } from "wxt/browser"

export default defineBackground(() => {
	browser.runtime.onInstalled.addListener(async (details) => {
		await browser.contextMenus.removeAll()
		browser.contextMenus.create({ id: "read-selection", title: "Read selection", contexts: ["selection"] })
		browser.contextMenus.create({ id: "read-page", title: "Read this page", contexts: ["page"] })
		if (details.reason === "install") await browser.tabs.create({ url: browser.runtime.getURL("/voices.html") })
	})
	const start = async (tabId: number, mode: "selection" | "article", selection?: string) => {
		try {
			const tab = await browser.tabs.get(tabId)
			const previous = await browser.storage.session.get("readingTab")
			if (typeof previous.readingTab === "number" && previous.readingTab !== tabId) {
				await browser.tabs.sendMessage(previous.readingTab, { type: "stop-reading" }, { frameId: 0 }).catch(() => {})
				await browser.runtime.sendMessage({ type: "pdf-stop", tabId: previous.readingTab }).catch(() => {})
			}
			if (tab.url?.startsWith(browser.runtime.getURL("/pdf.html"))) {
				const result = await browser.runtime.sendMessage({ type: "pdf-read", tabId, mode })
				if (result?.error) throw new Error(String(result.error))
				await browser.storage.session.set({ readingTab: tabId })
				return
			}
			if (tab.url && /^https?:/u.test(tab.url) && /\.pdf(?:$|[?#])/iu.test(tab.url)) {
				if (mode === "selection" && !selection?.trim()) throw new Error("Select some PDF text first.")
				if (selection && selection.length > 500_000) throw new Error("Select a smaller part of the PDF to read.")
				const url = new URL(browser.runtime.getURL("/pdf.html"))
				url.searchParams.set("src", tab.url)
				url.searchParams.set("mode", mode)
				url.searchParams.set("source", String(tabId))
				const reader = await browser.tabs.create({ url: "about:blank", active: false })
				if (reader.id !== undefined) {
					if (selection) await browser.storage.session.set({ [`pdfSelection:${reader.id}`]: selection })
					const stored = await browser.storage.session.get("pdfReaders")
					const readers = stored.pdfReaders && typeof stored.pdfReaders === "object" ? stored.pdfReaders : {}
					await browser.storage.session.set({ pdfReaders: { ...readers, [reader.id]: tabId } })
					await browser.storage.session.set({ readingTab: reader.id })
					await browser.tabs.update(reader.id, { url: url.href, active: true })
				}
				return
			}
			await browser.action.setBadgeText({ tabId, text: "" })
			await browser.scripting.executeScript({ target: { tabId }, files: ["/content-scripts/reader.js"] })
			const result = await browser.tabs.sendMessage(tabId, { type: "start-reading", mode }, { frameId: 0 })
			if (result?.error) throw new Error(String(result.error))
			await browser.storage.session.set({ readingTab: tabId })
			if (result?.reuse) await browser.runtime.sendMessage({ type: "reset-reader", session: result.session })
		} catch (error) {
			await browser.action.setBadgeText({ tabId, text: "!" })
			await browser.action.setTitle({
				tabId,
				title: error instanceof Error ? error.message : "This page cannot be read here.",
			})
		}
	}
	browser.contextMenus.onClicked.addListener((info, tab) => {
		if (tab?.id !== undefined)
			void start(tab.id, info.menuItemId === "read-selection" ? "selection" : "article", info.selectionText)
	})
	browser.action.onClicked.addListener((tab) => {
		if (tab.id !== undefined) void start(tab.id, "article")
	})
	const stopPdfReaders = async (sourceTab: number, removed = false) => {
		const stored = await browser.storage.session.get("pdfReaders")
		if (!stored.pdfReaders || typeof stored.pdfReaders !== "object") return
		const readers = stored.pdfReaders as Record<string, number>
		for (const [reader, source] of Object.entries(readers)) {
			if (source === sourceTab) {
				await browser.runtime.sendMessage({ type: "pdf-stop", tabId: Number(reader) }).catch(() => {})
				delete readers[reader]
			}
			if (removed && Number(reader) === sourceTab) {
				delete readers[reader]
				await browser.storage.session.remove(`pdfSelection:${reader}`)
			}
		}
		await browser.storage.session.set({ pdfReaders: readers })
	}
	browser.tabs.onRemoved.addListener((tabId) => {
		void stopPdfReaders(tabId, true)
	})
	browser.tabs.onUpdated.addListener((tabId, change) => {
		if (change.status === "loading") void stopPdfReaders(tabId)
	})
	browser.runtime.onMessage.addListener((message: unknown, sender) => {
		if (
			sender.id !== browser.runtime.id ||
			!message ||
			typeof message !== "object" ||
			!("type" in message) ||
			message.type !== "reader" ||
			!("session" in message) ||
			typeof message.session !== "string" ||
			sender.tab?.id === undefined ||
			!sender.url
		)
			return
		const url = new URL(sender.url)
		if (url.host !== new URL(browser.runtime.getURL("/")).host || url.pathname !== "/player.html") return
		return browser.tabs.sendMessage(sender.tab.id, message, { frameId: 0 })
	})
})
