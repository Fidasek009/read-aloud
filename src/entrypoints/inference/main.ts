import { browser } from "wxt/browser"

import { isExtensionBackgroundSender, isExtensionPageSender } from "../../extension/sender.ts"
import { SpeechEngine } from "../../speech/engine.ts"
import { SPEECH_HOST_LOCK, SpeechHostLifetime } from "../../speech/host-lifetime.ts"
import {
	sendSpeechHost,
	SPEECH_CLIENT_PORT,
	SPEECH_SERVER_PORT,
	speechHostDispatcher,
} from "../../speech/host-protocol.ts"
import { SpeechPortRegistry } from "../../speech/port-registry.ts"
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
	void sendSpeechHost({ type: "close-idle-speech-host" }).then(
		(response) => {
			if (response.ok) return
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
	const port = browser.runtime.connect({ name: SPEECH_SERVER_PORT })
	connectedPort = port
	port.onDisconnect.addListener(() => {
		if (connectedPort !== port) return
		connectedPort = undefined
	})
}
const registry = new SpeechPortRegistry(service, {
	connect(client) {
		if (!alive || !lifetime.connect(client)) return false
		closeFailures = 0
		scheduleClose()
		return true
	},
	disconnect(client) {
		lifetime.disconnect(client, performance.now())
		scheduleClose()
	},
})
browser.runtime.onConnect.addListener((port) => {
	if (
		port.name === SPEECH_CLIENT_PORT &&
		isExtensionPageSender(port.sender, browser.runtime.id, browser.runtime.getURL("/"), ["/player.html"])
	)
		registry.connect(port)
})
const backgroundCommands = speechHostDispatcher({
	"reserve-speech-host": () => {
		// Only the broker sends reservations, while holding the lifetime lock.
		// Thus any earlier claim belongs to a finished or terminated operation.
		lifetime.reopen()
		const reserved = lifetime.reserve(performance.now())
		if (reserved) {
			closeFailures = 0
			scheduleClose()
		}
		return { ok: reserved }
	},
	"claim-speech-host-close": () => {
		const claimed = lifetime.claimClose(performance.now())
		if (claimed) {
			clearTimeout(closeTimer)
			closeTimer = undefined
			service.dispose()
		}
		return { ok: claimed }
	},
	"release-speech-host-close": () => {
		lifetime.reopen()
		return { ok: true }
	},
	"speech-voice-deleted": (message) => {
		service.voiceDeleted(message.id)
		return { ok: true }
	},
	"connect-speech-host": () => {
		const old = connectedPort
		connectedPort = undefined
		old?.disconnect()
		connect()
		return { ok: true }
	},
})
browser.runtime.onMessage.addListener((message: unknown, sender) => {
	if (alive && isExtensionBackgroundSender(sender, browser.runtime.id, browser.runtime.getURL("/")))
		return backgroundCommands(message)
})
window.addEventListener("pagehide", () => {
	alive = false
	clearTimeout(closeTimer)
	service.dispose()
})
connect()
scheduleClose()
