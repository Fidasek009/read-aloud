import { browser } from "wxt/browser"

import type { SpeechClip } from "./protocol.ts"

import { voiceChoice } from "./catalog.ts"
import { readVoice } from "./vault.ts"

export class SpeechEngine {
	diagnostics: Record<string, unknown> = {}
	private worker: Worker | undefined
	private voice = ""
	private backend: "cpu" | "gpu" = "cpu"
	private epoch = 0
	private sequence = 0
	private serial: Promise<unknown> = Promise.resolve()
	private generation = 0
	private clips = new Map<string, SpeechClip>()
	private clipBytes = 0
	private loading: { voice: string; promise: Promise<void> } | undefined
	private pending = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
	>()

	load(voice: string): Promise<void> {
		if (this.loading?.voice === voice) return this.loading.promise
		const promise = this.loadVoice(voice)
		this.loading = { voice, promise }
		void promise
			.finally(() => {
				if (this.loading?.promise === promise) this.loading = undefined
			})
			.catch(() => {})
		return promise
	}

	private async loadVoice(voice: string): Promise<void> {
		if (this.voice === voice && this.worker) return
		this.dispose()
		const epoch = this.epoch
		const backends: ("gpu" | "cpu")[] = "gpu" in navigator ? ["gpu", "cpu"] : ["cpu"]
		let fallback: string | undefined
		for (const backend of backends) {
			try {
				await this.initialize(voice, backend, epoch)
				if (fallback) this.diagnostics.gpuFallbackReason = fallback
				return
			} catch (error) {
				if (epoch !== this.epoch) throw new DOMException("Reading stopped", "AbortError")
				this.stopWorker()
				if (backend === "cpu") throw error
				fallback = error instanceof Error ? error.message : "GPU initialization failed"
			}
		}
	}

	private async initialize(voice: string, backend: "cpu" | "gpu", epoch: number) {
		const started = performance.now()
		const selected = voiceChoice(voice)
		const { model, config } = await readVoice(selected.voice.id)
		const modelReadMs = performance.now() - started
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
		const loaded = await this.request(
			{ type: "load", voice: selected.voice.id, speaker: selected.speaker, config, model },
			[model],
		)
		this.diagnostics = {
			backend,
			voice,
			modelReadMs,
			loadMs: performance.now() - started,
			...(loaded as { timings?: object }).timings,
		}
		this.voice = voice
	}

	synthesize(text: string, speed: number): Promise<SpeechClip> {
		const epoch = this.epoch
		const generation = this.generation
		const key = `${this.voice}\u0000${speed}\u0000${text}`
		const job = this.serial
			.catch(() => {})
			.then(() => {
				if (epoch !== this.epoch || generation !== this.generation)
					throw new DOMException("Reading stopped", "AbortError")
				return (
					this.clips.get(key) ??
					this.generate(text, speed).then((clip) => {
						if (epoch === this.epoch && generation === this.generation && clip.pcm.byteLength <= 4_000_000) {
							this.clips.set(key, clip)
							this.clipBytes += clip.pcm.byteLength
							while (this.clips.size > 12 || this.clipBytes > 8_000_000) {
								const oldest = this.clips.keys().next().value!
								this.clipBytes -= this.clips.get(oldest)!.pcm.byteLength
								this.clips.delete(oldest)
							}
						}
						return clip
					})
				)
			})
		this.serial = job
		return job
	}

	private async generate(text: string, speed: number): Promise<SpeechClip> {
		const epoch = this.epoch
		const started = performance.now()
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
		this.diagnostics.synthesisMs = performance.now() - started
		return value as SpeechClip
	}

	cancelQueued() {
		this.generation++
	}
	clearClips() {
		this.cancelQueued()
		this.clips.clear()
		this.clipBytes = 0
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
		this.loading = undefined
		this.epoch++
		this.voice = ""
		this.stopWorker()
		this.generation++
		this.clips.clear()
		this.clipBytes = 0
	}
}
