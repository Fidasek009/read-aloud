import type { SpeechService } from "./service.ts"

import { speechRequest, type SpeechResponse } from "./protocol.ts"

export interface SpeechPort {
	onMessage: { addListener(listener: (request: unknown) => void): void }
	onDisconnect: { addListener(listener: () => void): void }
	postMessage(response: SpeechResponse): void
	disconnect(): void
}

/** A single routing implementation shared by the background and offscreen hosts. */
export class SpeechPortRegistry {
	private clients = new Map<string, SpeechPort>()
	constructor(
		private service: SpeechService,
		private lifecycle: {
			connect(client: string): boolean
			disconnect(client: string): void
		},
	) {}

	connect(port: SpeechPort) {
		const client = crypto.randomUUID()
		if (!this.lifecycle.connect(client)) {
			port.disconnect()
			return
		}
		this.clients.set(client, port)
		port.onMessage.addListener((request: unknown) => {
			if (!speechRequest(request)) {
				port.disconnect()
				return
			}
			void this.service.request(client, request).then(
				(response) => {
					if (this.clients.get(client) !== port) return
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
			if (!this.clients.delete(client)) return
			this.service.release(client)
			this.lifecycle.disconnect(client)
		})
	}
}
