import { browser } from "wxt/browser"

import { SpeechEngine } from "../../speech/engine.ts"
import { SpeechService } from "../../speech/service.ts"

const service = new SpeechService(new SpeechEngine())
let alive = true
function connect() {
	if (!alive) return
	const port = browser.runtime.connect({ name: "speech-server" })
	port.onMessage.addListener((message: unknown) => {
		if (!message || typeof message !== "object" || !("client" in message) || typeof message.client !== "string") return
		if ("release" in message && message.release === true) {
			service.release(message.client)
			return
		}
		if ("request" in message) {
			const client = message.client
			void service.request(client, message.request).then((response) => {
				if (alive)
					try {
						port.postMessage({ client, response })
					} catch {}
			})
		}
	})
	port.onDisconnect.addListener(() => {
		service.releaseCurrent()
		if (alive) setTimeout(connect, 250)
	})
}
window.addEventListener("pagehide", () => {
	alive = false
	service.dispose()
})
connect()
