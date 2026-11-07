import { type Browser, browser } from "wxt/browser"

import { isExtensionPageSender } from "../extension/sender.ts"
import { localKeys } from "../extension/storage.ts"
import { SpeechEngine } from "./engine.ts"
import { SPEECH_HOST_LOCK, SpeechHostLifetime } from "./host-lifetime.ts"
import {
	sendSpeechHost,
	SPEECH_CLIENT_PORT,
	SPEECH_GPU_FAILURE_KEY,
	SPEECH_SERVER_PORT,
	speechHostDispatcher,
} from "./host-protocol.ts"
import { SpeechPortRegistry } from "./port-registry.ts"
import { isVoiceChange } from "./protocol.ts"
import { SpeechService } from "./service.ts"
import { installedVoices } from "./vault.ts"
import { voiceLock } from "./voice-store.ts"

export function installSpeechBroker() {
	const isPage = (sender: Browser.runtime.MessageSender | undefined, path: string) =>
		isExtensionPageSender(sender, browser.runtime.id, browser.runtime.getURL("/"), [path])
	// IndexedDB model storage can be partitioned in an embedded frame. Unlike
	// IndexedDB, browser.storage.local remains extension-scoped there.
	const firefoxService =
		import.meta.env.BROWSER === "firefox" ? new SpeechService(new SpeechEngine(), "structured") : undefined
	const lifetime = new SpeechHostLifetime()
	let idleTimer: ReturnType<typeof setTimeout> | undefined
	const firefoxRegistry = firefoxService
		? new SpeechPortRegistry(firefoxService, {
				connect(client) {
					clearTimeout(idleTimer)
					return lifetime.connect(client)
				},
				disconnect(client) {
					lifetime.disconnect(client, performance.now())
					const delay = lifetime.closeDelay(performance.now())
					if (delay !== undefined)
						idleTimer = setTimeout(() => {
							firefoxService.dispose()
							lifetime.reopen()
						}, delay)
				},
			})
		: undefined
	let host: Browser.runtime.Port | undefined
	let connected: (() => void) | undefined
	browser.storage.onChanged.addListener((changes, area) => {
		const change: unknown = changes[localKeys.voiceChange]?.newValue
		if (area !== "local" || !isVoiceChange(change) || !change.deleted) return
		void navigator.locks.request(voiceLock(change.id), async () => {
			// A later download may have committed before this event was handled.
			if ((await installedVoices()).includes(change.id)) return
			firefoxService?.voiceDeleted(change.id)
			// The offscreen document may outlive this service worker and have no
			// port yet. Runtime messaging can reach it without creating it.
			if (!firefoxService) await sendSpeechHost({ type: "speech-voice-deleted", id: change.id }).catch(() => {})
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
			else await sendSpeechHost({ type: "connect-speech-host" })
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
			const lease = await sendSpeechHost({ type: "reserve-speech-host" })
			if (!lease.ok) throw new Error("The speech host is closing")
		})
	const playerCommands = speechHostDispatcher({
		"installed-voices": () => installedVoices(),
		"prepare-speech-host": () => (firefoxService ? { ok: true } : ready().then(() => ({ ok: true }))),
	})
	const inferenceCommands = speechHostDispatcher({
		"speech-gpu-available": async () => ({
			ok: (await browser.storage.session.get(SPEECH_GPU_FAILURE_KEY))[SPEECH_GPU_FAILURE_KEY] !== true,
		}),
		"speech-gpu-failed": async () => {
			await browser.storage.session.set({ [SPEECH_GPU_FAILURE_KEY]: true })
			return { ok: true }
		},
		"close-idle-speech-host": () =>
			navigator.locks.request(SPEECH_HOST_LOCK, async () => {
				const claim = await sendSpeechHost({ type: "claim-speech-host-close" })
				if (!claim.ok) return { ok: false }
				try {
					await browser.offscreen.closeDocument()
					host = undefined
					return { ok: true }
				} catch (error) {
					// Keep preparations usable if the browser rejects document closure.
					await sendSpeechHost({ type: "release-speech-host-close" }).catch(() => {})
					throw error
				}
			}),
	})
	browser.runtime.onMessage.addListener((message: unknown, sender) => {
		if (isPage(sender, "/player.html")) return playerCommands(message)
		if (!firefoxService && isPage(sender, "/inference.html")) return inferenceCommands(message)
	})
	browser.runtime.onConnect.addListener((port) => {
		if (port.name === SPEECH_SERVER_PORT && isPage(port.sender, "/inference.html")) {
			host = port
			connected?.()
			connected = undefined
			port.onDisconnect.addListener(() => {
				if (host === port) host = undefined
			})
			return
		}
		if (port.name === SPEECH_CLIENT_PORT && isPage(port.sender, "/player.html")) firefoxRegistry?.connect(port)
	})
}
