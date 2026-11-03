import { type Browser, browser } from "wxt/browser"

import type { SpeechDiagnostics } from "./diagnostics.ts"
import type { SpeechClip, SpeechRequest, SpeechResponse } from "./protocol.ts"

import { speechDiagnostics } from "./diagnostics.ts"
import { speechFailure } from "./errors.ts"

// Firefox extension frames can receive typed arrays from another JS realm.
function isPcm(value: unknown): value is Float32Array<ArrayBuffer> {
	return ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === "[object Float32Array]"
}

export class SpeechClient {
	diagnostics: SpeechDiagnostics = {}
	private port: Browser.runtime.Port | undefined
	private connecting: Promise<Browser.runtime.Port> | undefined
	private connectionEpoch = 0
	private sequence = 0
	private selectedVoice = ""
	get voice() {
		return this.selectedVoice
	}
	private pending = new Map<
		number,
		{
			resolve: (response: SpeechResponse) => void
			reject: (error: Error) => void
			timer: ReturnType<typeof setTimeout>
		}
	>()
	private async connect() {
		if (this.port) return this.port
		if (this.connecting) return this.connecting
		const epoch = this.connectionEpoch
		const pending = this.openPort(epoch)
		this.connecting = pending
		try {
			return await pending
		} finally {
			if (this.connecting === pending) this.connecting = undefined
		}
	}
	private async openPort(epoch: number) {
		if (import.meta.env.BROWSER !== "firefox") {
			try {
				const ready: unknown = await browser.runtime.sendMessage({ type: "prepare-speech-host" })
				if (!ready || typeof ready !== "object" || !("ok" in ready) || ready.ok !== true)
					throw speechFailure("transport")
			} catch {
				throw speechFailure("transport")
			}
		}
		if (epoch !== this.connectionEpoch) throw new DOMException("Reading stopped", "AbortError")
		const port = browser.runtime.connect({ name: "speech-client" })
		this.port = port
		port.onMessage.addListener((response: SpeechResponse) => {
			if (!response || !Number.isSafeInteger(response.id)) return
			const pending = this.pending.get(response.id)
			if (!pending) return
			clearTimeout(pending.timer)
			this.pending.delete(response.id)
			if (response.diagnostics) this.diagnostics = speechDiagnostics(response.diagnostics)
			if (response.ok) pending.resolve(response)
			else pending.reject(speechFailure(response.code ?? "unavailable"))
		})
		port.onDisconnect.addListener(() => {
			if (this.port === port) {
				this.port = undefined
				this.rejectPending(speechFailure("transport"))
			}
		})
		return port
	}
	private async request(
		command:
			| Omit<Extract<SpeechRequest, { type: "load" }>, "id">
			| Omit<Extract<SpeechRequest, { type: "synthesize" }>, "id">
			| { type: "cancel" },
	) {
		const port = await this.connect(),
			id = ++this.sequence
		return new Promise<SpeechResponse>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id)
				reject(speechFailure("timeout"))
			}, 90_000)
			this.pending.set(id, { resolve, reject, timer })
			try {
				port.postMessage({ ...command, id })
			} catch {
				clearTimeout(timer)
				this.pending.delete(id)
				reject(speechFailure("transport"))
			}
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
			!(typeof clip.pcm === "string" || isPcm(clip.pcm)) ||
			clip.pcm.length > 32_000_000 ||
			!Number.isFinite(clip.sampleRate) ||
			!Array.isArray(clip.words)
		)
			throw speechFailure("unavailable")
		let pcm: Float32Array<ArrayBuffer>
		if (isPcm(clip.pcm)) pcm = clip.pcm
		else {
			let bytes: Uint8Array<ArrayBuffer>
			try {
				bytes = Uint8Array.fromBase64(clip.pcm)
			} catch {
				throw speechFailure("unavailable")
			}
			if (bytes.byteLength % 4) throw speechFailure("unavailable")
			pcm = new Float32Array(bytes.buffer)
		}
		return {
			pcm,
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
		this.connectionEpoch++
		this.connecting = undefined
		this.selectedVoice = ""
		const port = this.port
		this.port = undefined
		port?.disconnect()
		this.rejectPending(new DOMException("Reading stopped", "AbortError"))
	}
}
