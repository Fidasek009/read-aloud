import { browser } from "wxt/browser"

import type { WordTiming } from "./phonemes.ts"

import { readModel } from "./vault.ts"

export interface SpeechClip {
	pcm: Float32Array<ArrayBuffer>
	sampleRate: number
	words: WordTiming[]
}

export class SpeechEngine {
	private worker: Worker | undefined
	private voice = ""
	private backend: "cpu" | "gpu" = "cpu"
	private epoch = 0
	private sequence = 0
	private serial: Promise<unknown> = Promise.resolve()
	private pending = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
	>()

	async load(voice: string): Promise<void> {
		if (this.voice === voice && this.worker) return
		this.dispose()
		const epoch = this.epoch
		const backends: ("gpu" | "cpu")[] = "gpu" in navigator ? ["gpu", "cpu"] : ["cpu"]
		for (const backend of backends) {
			try {
				await this.initialize(voice, backend, epoch)
				return
			} catch (error) {
				if (epoch !== this.epoch) throw new DOMException("Reading stopped", "AbortError")
				this.stopWorker()
				if (backend === "cpu") throw error
			}
		}
	}

	private async initialize(voice: string, backend: "cpu" | "gpu", epoch: number) {
		const model = await readModel(voice)
		if (epoch !== this.epoch) throw new DOMException("Reading stopped", "AbortError")
		this.backend = backend
		const workerPath = backend === "cpu" ? "/runtime/cpu/speech.js" : "/runtime/gpu/speech.js"
		this.worker = new Worker(browser.runtime.getURL(workerPath), { type: "module" })
		this.worker.onmessage = ({ data }: MessageEvent<unknown>) => {
			if (!data || typeof data !== "object" || !("id" in data) || typeof data.id !== "number" || !("ok" in data)) return
			const pending = this.pending.get(data.id)
			if (!pending) return
			clearTimeout(pending.timer)
			this.pending.delete(data.id)
			if (data.ok === true) pending.resolve(data)
			else pending.reject(new Error("error" in data && typeof data.error === "string" ? data.error : "Speech failed"))
		}
		this.worker.onerror = () => this.stopWorker(new Error("The speech worker stopped unexpectedly"))
		await this.request({ type: "load", voice, model }, [model])
		this.voice = voice
	}

	synthesize(text: string, speed: number): Promise<SpeechClip> {
		const epoch = this.epoch
		const job = this.serial
			.catch(() => {})
			.then(() => {
				if (epoch !== this.epoch) throw new DOMException("Reading stopped", "AbortError")
				return this.generate(text, speed)
			})
		this.serial = job
		return job
	}

	private async generate(text: string, speed: number): Promise<SpeechClip> {
		const epoch = this.epoch
		let value: unknown
		try {
			value = await this.request({ type: "synthesize", text, speed })
		} catch (error) {
			if (epoch !== this.epoch || this.backend === "cpu") throw error
			const voice = this.voice
			this.stopWorker()
			await this.initialize(voice, "cpu", epoch)
			value = await this.request({ type: "synthesize", text, speed })
		}
		if (epoch !== this.epoch) throw new DOMException("Reading stopped", "AbortError")
		if (
			!value ||
			typeof value !== "object" ||
			!("pcm" in value) ||
			!(value.pcm instanceof Float32Array) ||
			!("sampleRate" in value) ||
			typeof value.sampleRate !== "number" ||
			!("words" in value) ||
			!Array.isArray(value.words)
		)
			throw new Error("Invalid speech response")
		return value as SpeechClip
	}

	private request(message: object, transfer: Transferable[] = []): Promise<unknown> {
		return new Promise((resolve, reject) => {
			if (!this.worker) return reject(new Error("Choose a downloaded voice first"))
			const id = ++this.sequence
			const timer = setTimeout(() => this.stopWorker(new Error("Speech took too long. Please try again.")), 90_000)
			this.pending.set(id, { resolve, reject, timer })
			this.worker.postMessage({ ...message, id }, transfer)
		})
	}

	private stopWorker(error: Error = new DOMException("Reading stopped", "AbortError")) {
		this.worker?.terminate()
		this.worker = undefined
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer)
			pending.reject(error)
		}
		this.pending.clear()
	}

	dispose() {
		this.epoch++
		this.voice = ""
		this.stopWorker()
	}
}
