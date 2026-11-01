import { type Browser, browser } from "wxt/browser"

import { SpeechEngine } from "./engine.ts"
import { isVoiceChange, speechRequest } from "./protocol.ts"
import { SpeechService } from "./service.ts"
import { installedVoices } from "./vault.ts"

export function installSpeechBroker() {
	// Read from extension-owned storage, never the embedded frame's partition.
	browser.runtime.onMessage.addListener((message: unknown, sender) => {
		if (
			sender.id !== browser.runtime.id ||
			!sender.url ||
			!message ||
			typeof message !== "object" ||
			!("type" in message) ||
			message.type !== "installed-voices"
		)
			return
		const url = new URL(sender.url),
			own = new URL(browser.runtime.getURL("/"))
		if (url.protocol !== own.protocol || url.host !== own.host || url.pathname !== "/player.html") return
		return installedVoices()
	})
	const local = import.meta.env.BROWSER === "firefox" ? new SpeechService(new SpeechEngine()) : undefined
	const clients = new Map<string, Browser.runtime.Port>()
	let host: Browser.runtime.Port | undefined
	let opening: Promise<void> | undefined
	let connected: (() => void) | undefined
	browser.storage.onChanged.addListener((changes, area) => {
		const change: unknown = changes.voiceChange?.newValue
		if (area !== "local" || !isVoiceChange(change) || !change.deleted) return
		local?.voiceDeleted(change.id)
		host?.postMessage({ deletedVoice: change.id })
	})
	const ready = () =>
		(opening ??= (async () => {
			if (host) return
			const waiting = new Promise<void>((resolve, reject) => {
				const timer = setTimeout(() => reject(new Error("The speech host could not start")), 10_000)
				connected = () => {
					clearTimeout(timer)
					resolve()
				}
			})
			// The offscreen document owns DOM workers; Chrome service workers cannot create them.
			if (!(await browser.offscreen.hasDocument()))
				await browser.offscreen.createDocument({
					url: "inference.html",
					reasons: ["WORKERS"],
					justification:
						"Run local speech inference with isolated WebAssembly workers, independently of page controls.",
				})
			await waiting
		})().finally(() => {
			opening = undefined
		}))
	browser.runtime.onConnect.addListener((port) => {
		if (port.sender?.id !== browser.runtime.id || !port.sender.url) return
		const url = new URL(port.sender.url),
			own = new URL(browser.runtime.getURL("/"))
		if (url.protocol !== own.protocol || url.host !== own.host) return
		if (port.name === "speech-server" && url.pathname === "/inference.html") {
			host = port
			connected?.()
			connected = undefined
			port.onMessage.addListener((message) => {
				if (message && typeof message.client === "string" && message.response)
					clients.get(message.client)?.postMessage(message.response)
			})
			port.onDisconnect.addListener(() => {
				if (host === port) {
					host = undefined
					for (const client of clients.values()) client.disconnect()
					clients.clear()
				}
			})
			return
		}
		if (port.name !== "speech-client" || url.pathname !== "/player.html") return
		const id = crypto.randomUUID()
		clients.set(id, port)
		port.onMessage.addListener((request: unknown) => {
			if (!speechRequest(request)) {
				port.disconnect()
				return
			}
			const reply = (response: unknown) => {
				if (clients.get(id) === port) port.postMessage(response)
			}
			if (local) void local.request(id, request).then(reply)
			else
				void ready()
					.then(() => {
						if (clients.get(id) === port) host?.postMessage({ client: id, request })
					})
					.catch((error) =>
						reply({ id: request.id, ok: false, error: error instanceof Error ? error.message : "Speech host failed" }),
					)
		})
		port.onDisconnect.addListener(() => {
			clients.delete(id)
			if (local) local.release(id)
			else host?.postMessage({ client: id, release: true })
		})
	})
}
