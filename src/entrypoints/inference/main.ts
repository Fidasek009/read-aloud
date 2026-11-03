import { browser } from "wxt/browser"

import { isExtensionBackgroundSender, isExtensionPageSender } from "../../extension/sender.ts"
import { SpeechEngine } from "../../speech/engine.ts"
import { SPEECH_HOST_LOCK, SpeechHostLifetime } from "../../speech/host-lifetime.ts"
import { speechRequest } from "../../speech/protocol.ts"
import { SpeechService } from "../../speech/service.ts"

const service = new SpeechService(new SpeechEngine())
const lifetime = new SpeechHostLifetime()
let alive = true
let closeTimer: ReturnType<typeof setTimeout> | undefined
let closeFailures = 0
let connectedPort: ReturnType<typeof browser.runtime.connect> | undefined

function scheduleClose() {
	clearTimeout(closeTimer)
	closeTimer = undefined
	if (!alive) return
	const delay = lifetime.closeDelay(performance.now())
	if (delay !== undefined) closeTimer = setTimeout(requestClose, delay)
}

function requestClose() {
	closeTimer = undefined
	if (!alive) return
	void browser.runtime.sendMessage({ type: "close-idle-speech-host" }).then(
		(response: unknown) => {
			if (response && typeof response === "object" && "ok" in response && response.ok === true) return
			const delay = lifetime.closeDelay(performance.now())
			if (delay === undefined || delay > 0) {
				closeFailures = 0
				scheduleClose()
			} else if (++closeFailures <= 3 && alive && !closeTimer) {
				// Malformed/no replies must not create a zero-delay wakeup loop.
				closeTimer = setTimeout(requestClose, 30_000)
			}
		},
		() =>
			navigator.locks.request(SPEECH_HOST_LOCK, () => {
				if (!alive) return
				// A service worker can disappear after claiming the close. Acquiring
				// its lock proves that no close operation still owns that claim.
				lifetime.reopen()
				// A failed close must not create a reconnect/wakeup loop. New reader
				// activity resets this small retry budget and its lifetime deadline.
				if (++closeFailures <= 3 && !closeTimer && lifetime.closeDelay(performance.now()) !== undefined)
					closeTimer = setTimeout(requestClose, 30_000)
			}),
	)
}

function connect() {
	if (!alive || connectedPort) return
	const port = browser.runtime.connect({ name: "speech-server" })
	connectedPort = port
	port.onDisconnect.addListener(() => {
		if (connectedPort !== port) return
		connectedPort = undefined
	})
}
browser.runtime.onConnect.addListener((port) => {
	if (
		port.name !== "speech-client" ||
		!isExtensionPageSender(port.sender, browser.runtime.id, browser.runtime.getURL("/"), ["/player.html"])
	)
		return
	const client = crypto.randomUUID()
	if (!alive || !lifetime.connect(client)) {
		port.disconnect()
		return
	}
	closeFailures = 0
	scheduleClose()
	let open = true
	port.onMessage.addListener((request: unknown) => {
		if (!speechRequest(request)) {
			port.disconnect()
			return
		}
		void service.request(client, request).then(
			(response) => {
				if (!open || !alive) return
				try {
					port.postMessage(response)
				} catch {
					port.disconnect()
				}
			},
			() => port.disconnect(),
		)
	})
	port.onDisconnect.addListener(() => {
		open = false
		service.release(client)
		lifetime.disconnect(client, performance.now())
		scheduleClose()
	})
})
browser.runtime.onMessage.addListener((message: unknown, sender) => {
	if (!isExtensionBackgroundSender(sender, browser.runtime.id, browser.runtime.getURL("/"))) return
	if (!alive || !message || typeof message !== "object" || !("type" in message)) return
	if (message.type === "reserve-speech-host") {
		// Only the broker sends reservations, while holding the lifetime lock.
		// Thus any earlier claim belongs to a finished or terminated operation.
		lifetime.reopen()
		const reserved = lifetime.reserve(performance.now())
		if (reserved) {
			closeFailures = 0
			scheduleClose()
		}
		return Promise.resolve({ ok: reserved })
	}
	if (message.type === "claim-speech-host-close") {
		const claimed = lifetime.claimClose(performance.now())
		if (claimed) {
			clearTimeout(closeTimer)
			closeTimer = undefined
			service.dispose()
		}
		return Promise.resolve({ ok: claimed })
	}
	if (message.type === "release-speech-host-close") {
		lifetime.reopen()
		return Promise.resolve({ ok: true })
	}
	if (message.type === "speech-voice-deleted" && "id" in message && typeof message.id === "string") {
		service.voiceDeleted(message.id)
		return Promise.resolve({ ok: true })
	}
	if (message.type === "connect-speech-host") {
		const old = connectedPort
		connectedPort = undefined
		old?.disconnect()
		connect()
		return Promise.resolve({ ok: true })
	}
})
window.addEventListener("pagehide", () => {
	alive = false
	clearTimeout(closeTimer)
	service.dispose()
})
connect()
scheduleClose()
