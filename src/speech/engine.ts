import { browser } from "wxt/browser"

import type { GpuFallbackReason, SpeechDiagnostics } from "./diagnostics.ts"
import type { SpeechClip } from "./protocol.ts"
import type { VoiceConfig } from "./voice-config.ts"
import type { WorkerCommand, WorkerRequest, WorkerSuccess } from "./worker-protocol.ts"

import { voiceChoice } from "./catalog.ts"
import { SpeechTextError, SpeechTimeoutError } from "./errors.ts"
import { readVoice } from "./vault.ts"
import { isWorkerResponse } from "./worker-protocol.ts"

class WorkerFailure extends Error {
	constructor(
		message: string,
		readonly model: ArrayBuffer | undefined,
	) {
		super(message)
	}
}

class WorkerLoadFailure extends WorkerFailure {
	constructor(
		error: WorkerFailure,
		readonly config: VoiceConfig,
		readonly modelReadMs: number,
	) {
		super(error.message, error.model)
	}
}

export class SpeechEngine {
	diagnostics: SpeechDiagnostics = {}
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
		{
			type: WorkerRequest["type"]
			resolve: (value: WorkerSuccess) => void
			reject: (error: Error) => void
			timer: ReturnType<typeof setTimeout>
		}
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
		if (this.voice && this.worker && voiceChoice(this.voice).voice.id === voiceChoice(voice).voice.id) {
			// A reused session did not incur the previous initialization costs.
			this.voice = voice
			this.diagnostics = { backend: this.backend, voice, reusedSession: true }
			return
		}
		this.dispose()
		const loadStarted = performance.now()
		const epoch = this.epoch
		const backends: ("gpu" | "cpu")[] = "gpu" in navigator ? ["gpu", "cpu"] : ["cpu"]
		let fallback: GpuFallbackReason | undefined
		let recovered: { model: ArrayBuffer; config: VoiceConfig; modelReadMs: number } | undefined
		for (const backend of backends) {
			try {
				await this.initialize(voice, backend, epoch, recovered)
				this.diagnostics.loadMs = performance.now() - loadStarted
				if (fallback) this.diagnostics.gpuFallbackReason = fallback
				return
			} catch (error) {
				if (epoch !== this.epoch) throw new DOMException("Reading stopped", "AbortError")
				this.stopWorker()
				if (backend === "cpu") throw error
				fallback = "gpu-initialization-failed"
				if (error instanceof WorkerLoadFailure && error.model)
					recovered = { model: error.model, config: error.config, modelReadMs: error.modelReadMs }
			}
		}
	}

	private async initialize(
		voice: string,
		backend: "cpu" | "gpu",
		epoch: number,
		recovered?: { model: ArrayBuffer; config: VoiceConfig; modelReadMs: number },
	) {
		const started = performance.now()
		const selected = voiceChoice(voice)
		const { model, config } = recovered ?? (await readVoice(selected.voice.id))
		const modelReadMs = recovered ? recovered.modelReadMs : performance.now() - started
		if (epoch !== this.epoch) throw new DOMException("Reading stopped", "AbortError")
		this.backend = backend
		const workerPath = backend === "cpu" ? "/runtime/cpu/speech.js" : "/runtime/gpu/speech.js"
		this.worker = new Worker(browser.runtime.getURL(workerPath), { type: "module" })
		this.worker.onmessage = ({ data }: MessageEvent<unknown>) => {
			if (!data || typeof data !== "object" || !("id" in data) || typeof data.id !== "number") return
			const pending = this.pending.get(data.id)
			if (!pending) return
			clearTimeout(pending.timer)
			this.pending.delete(data.id)
			if (!isWorkerResponse(data) || (data.ok && data.type !== pending.type))
				pending.reject(new Error("Invalid speech response"))
			else if (data.ok) pending.resolve(data)
			else
				pending.reject(
					data.code === "unreadable-text" ? new SpeechTextError(data.error) : new WorkerFailure(data.error, data.model),
				)
		}
		this.worker.onerror = () => this.stopWorker(new Error("The speech worker stopped unexpectedly"))
		let loaded: Extract<WorkerSuccess, { type: "load" }>
		try {
			loaded = await this.request(
				{ type: "load", voice: selected.voice.id, speaker: selected.speaker, config, model },
				[model],
			)
		} catch (error) {
			if (error instanceof WorkerFailure && error.model) throw new WorkerLoadFailure(error, config, modelReadMs)
			throw error
		}
		if (epoch !== this.epoch) throw new DOMException("Reading stopped", "AbortError")
		this.diagnostics = {
			backend,
			voice,
			modelReadMs,
			loadMs: performance.now() - started,
			...(recovered ? { modelReusedOnFallback: true } : {}),
			...loaded.timings,
		}
		this.voice = voice
	}

	synthesize(text: string, speed: number): Promise<SpeechClip> {
		const epoch = this.epoch
		const generation = this.generation
		const speaker = voiceChoice(this.voice).speaker
		const key = `${this.voice}\u0000${speed}\u0000${text}`
		const job = this.serial
			.catch(() => {})
			.then(() => {
				if (epoch !== this.epoch || generation !== this.generation)
					throw new DOMException("Reading stopped", "AbortError")
				return (
					this.clips.get(key) ??
					this.generate(text, speed, generation, speaker).then((clip) => {
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

	private async generate(text: string, speed: number, generation: number, speaker: number): Promise<SpeechClip> {
		const epoch = this.epoch
		const started = performance.now()
		let value: Extract<WorkerSuccess, { type: "synthesize" }>
		try {
			value = await this.request({ type: "synthesize", text, speed, speaker })
		} catch (error) {
			if (epoch !== this.epoch || generation !== this.generation)
				throw new DOMException("Reading stopped", "AbortError")
			if (this.backend === "cpu" || error instanceof SpeechTextError) throw error
			const voice = this.voice
			this.stopWorker()
			await this.initialize(voice, "cpu", epoch)
			if (epoch !== this.epoch || generation !== this.generation)
				throw new DOMException("Reading stopped", "AbortError")
			this.diagnostics.gpuFallbackReason = "gpu-inference-failed"
			value = await this.request({ type: "synthesize", text, speed, speaker })
		}
		if (epoch !== this.epoch || generation !== this.generation) throw new DOMException("Reading stopped", "AbortError")
		this.diagnostics.synthesisMs = performance.now() - started
		return value
	}

	cancelQueued() {
		this.generation++
	}
	clearClips() {
		this.cancelQueued()
		this.clips.clear()
		this.clipBytes = 0
	}

	private request(
		message: Extract<WorkerCommand, { type: "load" }>,
		transfer?: Transferable[],
	): Promise<Extract<WorkerSuccess, { type: "load" }>>
	private request(
		message: Extract<WorkerCommand, { type: "synthesize" }>,
		transfer?: Transferable[],
	): Promise<Extract<WorkerSuccess, { type: "synthesize" }>>
	private request(message: WorkerCommand, transfer: Transferable[] = []): Promise<WorkerSuccess> {
		return new Promise((resolve, reject) => {
			if (!this.worker) return reject(new Error("Choose a downloaded voice first"))
			const id = ++this.sequence
			const timer = setTimeout(() => this.stopWorker(new SpeechTimeoutError("Speech timed out")), 90_000)
			this.pending.set(id, { type: message.type, resolve, reject, timer })
			this.worker.postMessage({ ...message, id } satisfies WorkerRequest, transfer)
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
