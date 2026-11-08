import type { browser } from "wxt/browser"

import { pageScript } from "./page-script.ts"

/** Self-contained: prepended to the copied background bundle to observe production routes. */
function installBackgroundProbe() {
	type Trace = Record<string, unknown>
	const globals = globalThis as unknown as { browser?: typeof browser; chrome?: typeof browser }
	const api = globals.browser ?? globals.chrome
	if (!api) throw Error("Extension API is unavailable")
	let omitTabUrl: number | undefined
	let omittedUrl = false
	let omitReaderUrls = false
	let omittedReaderUrls = false
	let trace: Trace[] = []
	const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error))
	const messageType = (message: unknown) =>
		message && typeof message === "object" && "type" in message ? message.type : undefined
	const fromExtension = (sender: unknown) =>
		!!sender && typeof sender === "object" && "id" in sender && sender.id === api.runtime.id
	const isProbeMessage = (message: unknown, type: string): message is { type: string } =>
		!!message && typeof message === "object" && "type" in message && message.type === type

	const updateTab = async (id: number, changes: { url?: string }) => {
		const result = await api.tabs.update(id, changes)
		trace.push({ type: "update-tab", id, url: changes.url })
		return result
	}
	const sendTab = async (tab: number, ...args: unknown[]) => {
		try {
			const result = await (api.tabs.sendMessage as (...parameters: unknown[]) => Promise<unknown>)(tab, ...args)
			trace.push({ tab, type: messageType(args[0]), ok: true })
			return result
		} catch (error) {
			trace.push({ tab, type: messageType(args[0]), error: errorMessage(error) })
			throw error
		}
	}
	const sendRuntime = async (message: unknown) => {
		try {
			const result = await (api.runtime.sendMessage as (value: unknown) => Promise<unknown>)(message)
			trace.push({ type: messageType(message), ok: true })
			return result
		} catch (error) {
			trace.push({ type: messageType(message), error: errorMessage(error) })
			throw error
		}
	}
	const getTab = async (id: number) => {
		const tab = await api.tabs.get(id)
		trace.push({ type: "get-tab", id, url: tab.url })
		if (omitReaderUrls && (tab.url ?? tab.pendingUrl)?.startsWith(api.runtime.getURL("/pdf.html"))) {
			const { url, pendingUrl, ...withoutUrl } = tab
			omittedReaderUrls = true
			return withoutUrl
		}
		if (id === omitTabUrl) {
			const { url, ...withoutUrl } = tab
			omittedUrl = true
			return withoutUrl
		}
		return tab
	}
	const addContextMenu = (listener: (info: unknown, tab: unknown) => unknown) => {
		api.contextMenus.onClicked.addListener(listener as Parameters<typeof api.contextMenus.onClicked.addListener>[0])
		const onMessage = (message: unknown, sender: unknown) => {
			if (!fromExtension(sender) || !isProbeMessage(message, "probe-context-menu")) return
			if (!("tab" in message) || !message.tab || typeof message.tab !== "object") return
			if (!("id" in message.tab) || typeof message.tab.id !== "number") return
			const tabId = message.tab.id
			const info = "info" in message ? message.info : undefined
			const omitTab = "omitTabUrl" in message && message.omitTabUrl
			const omitReader = "omitReaderUrls" in message && message.omitReaderUrls === true
			return (async () => {
				omitTabUrl = omitTab ? tabId : undefined
				omittedUrl = false
				omitReaderUrls = omitReader
				omittedReaderUrls = false
				trace = []
				try {
					await listener(info, message.tab)
					const badge = await api.action.getBadgeText({ tabId })
					return {
						ok: badge !== "!",
						error: badge === "!" ? await api.action.getTitle({ tabId }) : undefined,
						omittedUrl,
						omittedReaderUrls,
						trace,
					}
				} finally {
					omitTabUrl = undefined
					omitReaderUrls = false
				}
			})()
		}
		api.runtime.onMessage.addListener(onMessage as Parameters<typeof api.runtime.onMessage.addListener>[0])
	}
	const addAction = (listener: (tab: unknown) => unknown) => {
		api.action.onClicked.addListener(listener as Parameters<typeof api.action.onClicked.addListener>[0])
		const onMessage = (message: unknown, sender: unknown) => {
			if (!fromExtension(sender) || !isProbeMessage(message, "probe-action-click")) return
			if (!("tab" in message)) return
			trace = []
			listener(message.tab)
			return new Promise((resolve) => setTimeout(() => resolve({ ok: true, trace }), 500))
		}
		api.runtime.onMessage.addListener(onMessage as Parameters<typeof api.runtime.onMessage.addListener>[0])
	}
	return {
		__probeAddContextMenu: addContextMenu,
		__probeAddAction: addAction,
		__probeGetTab: getTab,
		__probeUpdateTab: updateTab,
		__probeSendTab: sendTab,
		__probeSendRuntime: sendRuntime,
	}
}

/** Invoke the installed background menu listener in copied test packages only. */
export async function observeContextMenu(directory: string) {
	const file = Bun.file(`${directory}/background.js`)
	const source = await file.text()
	const registration = /[\w$]+\.contextMenus\.onClicked\.addListener\(/gu
	const actionRegistration = /[\w$]+\.action\.onClicked\.addListener\(/gu
	if ([...source.matchAll(registration)].length !== 1) throw new Error("The background menu registration changed")
	if ([...source.matchAll(actionRegistration)].length !== 1)
		throw new Error("The background action registration changed")
	// Observe the compiled registration without replacing browser-owned API objects.
	const instrumented = source
		.replace(registration, "__probeAddContextMenu(")
		.replace(actionRegistration, "__probeAddAction(")
		.replace(/[\w$]+\.tabs\.get\(/gu, "__probeGetTab(")
		.replace(/[\w$]+\.tabs\.update\(/gu, "__probeUpdateTab(")
		.replace(/[\w$]+\.tabs\.sendMessage\(/gu, "__probeSendTab(")
		.replace(/[\w$]+\.runtime\.sendMessage\(/gu, "__probeSendRuntime(")
	const probe = pageScript(installBackgroundProbe)
	await Bun.write(
		file,
		`const {__probeAddContextMenu,__probeAddAction,__probeGetTab,__probeUpdateTab,__probeSendTab,__probeSendRuntime}=${probe};\n${instrumented}`,
	)
}
