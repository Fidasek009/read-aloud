import { defineBackground } from "#imports"
import { browser } from "wxt/browser"

import type { ReaderChange } from "../reading/host.ts"
import type { PdfAction, PdfCommand } from "../reading/pdf-control.ts"

import { installSpeechBroker } from "../speech/broker.ts"

export default defineBackground(() => {
	const commandPdf = (tabId: number, action: PdfAction) =>
		browser.storage.local.set({
			pdfCommand: { ...action, tabId, revision: crypto.randomUUID() } satisfies PdfCommand,
		})
	installSpeechBroker()
	browser.runtime.onInstalled.addListener(async (details) => {
		await browser.contextMenus.removeAll()
		browser.contextMenus.create({ id: "read-selection", title: "Read selection", contexts: ["selection"] })
		browser.contextMenus.create({ id: "read-page", title: "Read this page", contexts: ["page"] })
		if (details.reason === "install") await browser.tabs.create({ url: browser.runtime.getURL("/voices.html") })
	})
	const start = async (
		tabId: number,
		mode: "selection" | "article",
		selection?: string,
		reveal = false,
		pageUrl?: string,
	) => {
		try {
			const tab = await browser.tabs.get(tabId)
			// Own extension tabs can omit Tab.url without the broad tabs permission.
			// The native context-menu event supplies the invoking document URL.
			const documentUrl = pageUrl?.startsWith(browser.runtime.getURL("/pdf.html")) ? pageUrl : (tab.url ?? pageUrl)
			await browser.action.setBadgeText({ tabId, text: "" })
			const previous = await browser.storage.session.get("readingTab")
			const existingPdf = reveal ? await browser.storage.session.get("pdfReaders") : {}
			const revealsPreviousPdf =
				reveal &&
				existingPdf.pdfReaders &&
				typeof existingPdf.pdfReaders === "object" &&
				(existingPdf.pdfReaders as Record<string, unknown>)[String(previous.readingTab)] === tabId
			if (typeof previous.readingTab === "number" && previous.readingTab !== tabId && !revealsPreviousPdf) {
				await browser.tabs.sendMessage(previous.readingTab, { type: "stop-reading" }, { frameId: 0 }).catch(() => {})
				await commandPdf(previous.readingTab, { action: "stop" })
			}
			if (documentUrl?.startsWith(browser.runtime.getURL("/pdf.html"))) {
				await commandPdf(tabId, { action: "read", mode, reveal })
				await browser.storage.session.set({ readingTab: tabId })
				return
			}
			if (documentUrl && /^https?:/u.test(documentUrl) && /\.pdf(?:$|[?#])/iu.test(documentUrl)) {
				if (reveal) {
					const { pdfReaders } = await browser.storage.session.get("pdfReaders")
					if (pdfReaders && typeof pdfReaders === "object") {
						for (const [reader, source] of Object.entries(pdfReaders)) {
							if (source === tabId && (await browser.tabs.get(Number(reader)).catch(() => undefined))) {
								await browser.tabs.update(Number(reader), { active: true })
								return
							}
						}
					}
				}
				if (mode === "selection" && !selection?.trim()) throw new Error("Select some PDF text first.")
				if (selection && selection.length > 500_000) throw new Error("Select a smaller part of the PDF to read.")
				const url = new URL(browser.runtime.getURL("/pdf.html"))
				url.searchParams.set("src", documentUrl)
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
			const message = { type: "start-reading", mode, reveal }
			let result
			try {
				result = await browser.tabs.sendMessage(tabId, message, { frameId: 0 })
			} catch {
				await browser.scripting.executeScript({ target: { tabId }, files: ["/content-scripts/reader.js"] })
				result = await browser.tabs.sendMessage(tabId, message, { frameId: 0 })
			}
			if (result?.error) throw new Error(String(result.error))
			await browser.storage.session.set({ readingTab: tabId })
			if (result?.reuse)
				await browser.storage.local.set({
					readerChange: { session: result.session, revision: crypto.randomUUID() } satisfies ReaderChange,
				})
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
			return start(
				tab.id,
				info.menuItemId === "read-selection" ? "selection" : "article",
				info.selectionText,
				false,
				info.pageUrl,
			)
	})
	browser.action.onClicked.addListener((tab) => {
		if (tab.id !== undefined) void start(tab.id, "article", undefined, true)
	})
	const stopPdfReaders = async (sourceTab: number, removed = false) => {
		const stored = await browser.storage.session.get("pdfReaders")
		if (!stored.pdfReaders || typeof stored.pdfReaders !== "object") return
		const readers = stored.pdfReaders as Record<string, number>
		for (const [reader, source] of Object.entries(readers)) {
			if (source === sourceTab) {
				await commandPdf(Number(reader), { action: "stop" })
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
