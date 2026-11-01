import { type Browser, browser } from "wxt/browser"

import type { SpeechClip, SpeechRequest, SpeechResponse } from "./protocol.ts"

export class SpeechClient {
	diagnostics: Record<string, unknown> = {}
	private port: Browser.runtime.Port | undefined
	private sequence = 0
	private selectedVoice = ""
	private pending = new Map<
		number,
		{
			resolve: (response: SpeechResponse) => void
			reject: (error: Error) => void
			timer: ReturnType<typeof setTimeout>
		}
	>()
	private connect() {
		if (this.port) return this.port
		const port = browser.runtime.connect({ name: "speech-client" })
		this.port = port
		port.onMessage.addListener((response: SpeechResponse) => {
			if (!response || !Number.isSafeInteger(response.id)) return
			const pending = this.pending.get(response.id)
			if (!pending) return
			clearTimeout(pending.timer)
			this.pending.delete(response.id)
			if (response.diagnostics) this.diagnostics = response.diagnostics
			if (response.ok) pending.resolve(response)
			else pending.reject(new Error(response.error ?? "Speech could not continue"))
		})
		port.onDisconnect.addListener(() => {
			if (this.port === port) {
				this.port = undefined
				this.rejectPending(new Error("The speech host disconnected. Press Play to reconnect."))
			}
		})
		return port
	}
	private request(
		command:
			| Omit<Extract<SpeechRequest, { type: "load" }>, "id">
			| Omit<Extract<SpeechRequest, { type: "synthesize" }>, "id">
			| { type: "cancel" },
	) {
		const port = this.connect(),
			id = ++this.sequence
		return new Promise<SpeechResponse>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id)
				reject(new Error("Speech took too long. Please try again."))
			}, 90_000)
			this.pending.set(id, { resolve, reject, timer })
			port.postMessage({ ...command, id })
		})
	}
	async load(voice: string) {
		this.selectedVoice = voice
		await this.request({ type: "load", voice })
	}
	async synthesize(text: string, speed: number): Promise<SpeechClip> {
		if (!this.port) {
			if (!this.selectedVoice) throw new Error("Choose a downloaded voice first")
			await this.load(this.selectedVoice)
		}
		const { clip } = await this.request({ type: "synthesize", text, speed })
		if (
			!clip ||
			typeof clip.pcm !== "string" ||
			clip.pcm.length > 32_000_000 ||
			!Number.isFinite(clip.sampleRate) ||
			!Array.isArray(clip.words)
		)
			throw new Error("Invalid speech response")
		const bytes = Uint8Array.fromBase64(clip.pcm)
		if (bytes.byteLength % 4) throw new Error("Invalid speech buffer")
		return {
			pcm: new Float32Array(bytes.buffer),
			sampleRate: clip.sampleRate,
			words: clip.words,
			skippedText: clip.skippedText === true,
		}
	}
	cancelQueued() {
		if (this.port) void this.request({ type: "cancel" }).catch(() => {})
	}
	private rejectPending(error: Error) {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer)
			pending.reject(error)
		}
		this.pending.clear()
	}
	dispose() {
		this.selectedVoice = ""
		const port = this.port
		this.port = undefined
		port?.disconnect()
		this.rejectPending(new DOMException("Reading stopped", "AbortError"))
	}
}
