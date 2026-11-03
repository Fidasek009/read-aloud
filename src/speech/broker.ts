import { type Browser, browser } from "wxt/browser"

import { isExtensionPageSender } from "../extension/sender.ts"
import { SpeechEngine } from "./engine.ts"
import { SPEECH_HOST_LOCK } from "./host-lifetime.ts"
import { isVoiceChange, speechRequest } from "./protocol.ts"
import { SpeechService } from "./service.ts"
import { installedVoices } from "./vault.ts"

export function installSpeechBroker() {
	const isPage = (sender: Browser.runtime.MessageSender | undefined, path: string) =>
		isExtensionPageSender(sender, browser.runtime.id, browser.runtime.getURL("/"), [path])
	// Read from extension-owned storage, never the embedded frame's partition.
	browser.runtime.onMessage.addListener((message: unknown, sender) => {
		if (
			!isPage(sender, "/player.html") ||
			!message ||
			typeof message !== "object" ||
			!("type" in message) ||
			message.type !== "installed-voices"
		)
			return
		return installedVoices()
	})
	const local = import.meta.env.BROWSER === "firefox" ? new SpeechService(new SpeechEngine(), "structured") : undefined
	const clients = new Map<string, Browser.runtime.Port>()
	let host: Browser.runtime.Port | undefined
	let connected: (() => void) | undefined
	browser.storage.onChanged.addListener((changes, area) => {
		const change: unknown = changes.voiceChange?.newValue
		if (area !== "local" || !isVoiceChange(change) || !change.deleted) return
		void navigator.locks.request(`voice:${change.id}`, async () => {
			// A later download may have committed before this event was handled.
			if ((await installedVoices()).includes(change.id)) return
			local?.voiceDeleted(change.id)
			// The offscreen document may outlive this service worker and have no
			// port yet. Runtime messaging can reach it without creating it.
			if (!local) await browser.runtime.sendMessage({ type: "speech-voice-deleted", id: change.id }).catch(() => {})
		})
	})
	const connectHost = async () => {
		if (host) return
		let timer: ReturnType<typeof setTimeout> | undefined
		const waiting = new Promise<void>((resolve, reject) => {
			timer = setTimeout(() => reject(new Error("The speech host could not start")), 10_000)
			connected = () => {
				clearTimeout(timer)
				resolve()
			}
		})
		// Chrome service workers cannot create DOM workers. The client list
		// supports all declared Chrome versions, unlike offscreen.hasDocument().
		try {
			const scope = globalThis as unknown as { clients: { matchAll(): Promise<{ url: string }[]> } }
			const existing = (await scope.clients.matchAll()).some(
				(client) => client.url === browser.runtime.getURL("/inference.html"),
			)
			if (!existing)
				await browser.offscreen.createDocument({
					url: "inference.html",
					reasons: ["WORKERS"],
					justification:
						"Run local speech inference with isolated WebAssembly workers, independently of page controls.",
				})
			else await browser.runtime.sendMessage({ type: "connect-speech-host" })
			await waiting
		} finally {
			clearTimeout(timer)
			connected = undefined
		}
	}
	const ready = () =>
		navigator.locks.request(SPEECH_HOST_LOCK, async () => {
			await connectHost()
			// Reserve before replying: the player opens its port asynchronously.
			const lease: unknown = await browser.runtime.sendMessage({ type: "reserve-speech-host" })
			if (!lease || typeof lease !== "object" || !("ok" in lease) || lease.ok !== true)
				throw new Error("The speech host is closing")
		})
	browser.runtime.onMessage.addListener((message: unknown, sender) => {
		if (
			local ||
			!isPage(sender, "/inference.html") ||
			!message ||
			typeof message !== "object" ||
			!("type" in message) ||
			message.type !== "close-idle-speech-host"
		)
			return
		return navigator.locks.request(SPEECH_HOST_LOCK, async () => {
			const claim: unknown = await browser.runtime.sendMessage({ type: "claim-speech-host-close" })
			if (!claim || typeof claim !== "object" || !("ok" in claim) || claim.ok !== true) return { ok: false }
			try {
				await browser.offscreen.closeDocument()
				host = undefined
				return { ok: true }
			} catch (error) {
				// Keep preparations usable if the browser rejects document closure.
				await browser.runtime.sendMessage({ type: "release-speech-host-close" }).catch(() => {})
				throw error
			}
		})
	})
	browser.runtime.onMessage.addListener((message: unknown, sender) => {
		if (
			local ||
			!isPage(sender, "/player.html") ||
			!message ||
			typeof message !== "object" ||
			!("type" in message) ||
			message.type !== "prepare-speech-host"
		)
			return
		return ready().then(() => ({ ok: true }))
	})
	browser.runtime.onConnect.addListener((port) => {
		if (port.name === "speech-server" && isPage(port.sender, "/inference.html")) {
			host = port
			connected?.()
			connected = undefined
			port.onDisconnect.addListener(() => {
				if (host === port) host = undefined
			})
			return
		}
		if (!local || port.name !== "speech-client" || !isPage(port.sender, "/player.html")) return
		const id = crypto.randomUUID()
		clients.set(id, port)
		port.onMessage.addListener((request: unknown) => {
			if (!speechRequest(request)) {
				port.disconnect()
				return
			}
			const reply = (response: unknown) => {
				if (clients.get(id) !== port) return
				try {
					port.postMessage(response)
				} catch {
					port.disconnect()
				}
			}
			void local.request(id, request).then(reply, () => port.disconnect())
		})
		port.onDisconnect.addListener(() => {
			clients.delete(id)
			local.release(id)
		})
	})
}
