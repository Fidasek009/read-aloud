import { browser } from "wxt/browser"

import type { GpuFallbackReason, SpeechDiagnostics } from "./diagnostics.ts"
import type { SpeechClip } from "./protocol.ts"
import type { VoiceConfig } from "./voice-config.ts"

import { voiceChoice } from "./catalog.ts"
import { SPEECH_REQUEST_TIMEOUT_MS, speechFailure, SpeechTextError, SpeechTimeoutError } from "./errors.ts"
import { sendSpeechHost, SPEECH_GPU_FAILURE_KEY } from "./host-protocol.ts"
import { readVoice } from "./vault.ts"
import { isWorkerResponse, type WorkerCommand, type WorkerRequest, type WorkerSuccess } from "./worker-protocol.ts"

export interface SpeechWorker {
	onmessage: ((event: MessageEvent<unknown>) => unknown) | null
	onerror: ((event: ErrorEvent) => unknown) | null
	postMessage(message: WorkerRequest, transfer: Transferable[]): void
	terminate(): void
}

export interface SpeechEngineRuntime {
	readVoice: typeof readVoice
	createWorker(backend: "cpu" | "gpu"): SpeechWorker
	gpuAvailable(): Promise<boolean>
	disableGpu(): void
}

type RecoveredModel = { model: ArrayBuffer; config: VoiceConfig; modelReadMs: number }

let gpuUnavailable = false
const defaultRuntime: SpeechEngineRuntime = {
	readVoice,
	createWorker: (backend) => new Worker(browser.runtime.getURL(`/runtime/${backend}/speech.js`), { type: "module" }),
	async gpuAvailable() {
		if (gpuUnavailable || !("gpu" in navigator)) return false
		// Chrome offscreen documents expose runtime only, not storage APIs.
		if (import.meta.env.BROWSER !== "firefox") return (await sendSpeechHost({ type: "speech-gpu-available" })).ok
		const remembered = await browser.storage.session.get(SPEECH_GPU_FAILURE_KEY)
		return remembered[SPEECH_GPU_FAILURE_KEY] !== true
	},
	disableGpu() {
		gpuUnavailable = true
		if (import.meta.env.BROWSER === "firefox")
			void browser.storage.session.set({ [SPEECH_GPU_FAILURE_KEY]: true }).catch(() => {})
		else void sendSpeechHost({ type: "speech-gpu-failed" }).catch(() => {})
	},
}

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
	private worker: SpeechWorker | undefined
	private loadedConfig: VoiceConfig | undefined
	private modelReadMs = 0
	private cpuFallback: { recovered: RecoveredModel | undefined } | undefined
	private voice = ""
	private backend: "cpu" | "gpu" = "cpu"
	private epoch = 0
	private sequence = 0
	private serial: Promise<unknown> = Promise.resolve()
	private generation = 0
	private cacheEpoch = 0
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

	constructor(private runtime: SpeechEngineRuntime = defaultRuntime) {}

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
		const sameModel = this.voice && voiceChoice(this.voice).voice.id === voiceChoice(voice).voice.id
		if (sameModel && this.worker && !this.cpuFallback) {
			// A reused session did not incur the previous initialization costs.
			this.voice = voice
			this.diagnostics = { backend: this.backend, voice, reusedSession: true }
			return
		}
		let recovered = sameModel ? this.cpuFallback?.recovered : undefined
		this.dispose()
		const loadStarted = performance.now()
		const epoch = this.epoch
		const backends: ("gpu" | "cpu")[] = (await this.runtime.gpuAvailable()) ? ["gpu", "cpu"] : ["cpu"]
		if (epoch !== this.epoch) throw speechFailure("cancelled")
		let fallback: GpuFallbackReason | undefined
		for (const backend of backends) {
			try {
				await this.initialize(voice, backend, epoch, recovered)
				this.diagnostics.loadMs = performance.now() - loadStarted
				if (fallback) this.diagnostics.gpuFallbackReason = fallback
				return
			} catch (error) {
				if (epoch !== this.epoch) throw speechFailure("cancelled")
				this.stopWorker()
				if (backend === "cpu") throw error
				this.runtime.disableGpu()
				fallback = "gpu-initialization-failed"
				if (error instanceof WorkerLoadFailure && error.model)
					recovered = { model: error.model, config: error.config, modelReadMs: error.modelReadMs }
			}
		}
	}

	private async initialize(voice: string, backend: "cpu" | "gpu", epoch: number, recovered?: RecoveredModel) {
		const started = performance.now()
		const selected = voiceChoice(voice)
		// Parsing the worker and loading its runtime imports overlaps the IDB read.
		const worker = this.runtime.createWorker(backend)
		this.worker = worker
		worker.onmessage = ({ data }: MessageEvent<unknown>) => {
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
		worker.onerror = () => {
			if (this.worker === worker) this.stopWorker(new Error("The speech worker stopped unexpectedly"))
		}
		const { model, config } = recovered ?? (await this.runtime.readVoice(selected.voice.id))
		const modelReadMs = recovered ? recovered.modelReadMs : performance.now() - started
		if (epoch !== this.epoch) throw speechFailure("cancelled")
		this.backend = backend
		let loaded: Extract<WorkerSuccess, { type: "load" }>
		try {
			loaded = await this.request(
				{ type: "load", voice: selected.voice.id, speaker: selected.speaker, config, model },
				[model],
			)
		} catch (error) {
			if (error instanceof WorkerFailure && error.model) throw new WorkerLoadFailure(error, config, modelReadMs)
			if (model.byteLength)
				throw new WorkerLoadFailure(
					new WorkerFailure(error instanceof Error ? error.message : "Speech worker failed", model),
					config,
					modelReadMs,
				)
			throw error
		}
		if (epoch !== this.epoch) throw speechFailure("cancelled")
		this.loadedConfig = config
		this.modelReadMs = modelReadMs
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
		const cacheEpoch = this.cacheEpoch
		const speaker = voiceChoice(this.voice).speaker
		const key = `${this.voice}\u0000${speed}\u0000${text}`
		const job = this.serial
			.catch(() => {})
			.then(() => {
				if (epoch !== this.epoch || generation !== this.generation) throw speechFailure("cancelled")
				return (
					this.clips.get(key) ??
					this.generate(text, speed, generation, speaker).then((clip) => {
						// Completed work can be reused after Next/Previous, but never
						// across model disposal or a change in reading ownership.
						if (epoch === this.epoch && cacheEpoch === this.cacheEpoch && clip.pcm.byteLength <= 4_000_000) {
							this.clips.set(key, clip)
							this.clipBytes += clip.pcm.byteLength
							while (this.clips.size > 12 || this.clipBytes > 8_000_000) {
								const oldest = this.clips.keys().next().value!
								this.clipBytes -= this.clips.get(oldest)!.pcm.byteLength
								this.clips.delete(oldest)
							}
						}
						if (epoch !== this.epoch || generation !== this.generation) throw speechFailure("cancelled")
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
			if (this.cpuFallback) {
				const recovered = this.cpuFallback.recovered
				this.stopWorker()
				await this.initialize(this.voice, "cpu", epoch, recovered)
				this.cpuFallback = undefined
				if (epoch !== this.epoch || generation !== this.generation) throw speechFailure("cancelled")
				this.diagnostics.gpuFallbackReason = "gpu-inference-failed"
			}
			value = await this.request({ type: "synthesize", text, speed, speaker })
		} catch (error) {
			if (epoch !== this.epoch) throw speechFailure("cancelled")
			if (this.backend === "cpu" || error instanceof SpeechTextError) {
				if (generation !== this.generation) throw speechFailure("cancelled")
				throw error
			}
			const voice = this.voice
			const recovered =
				error instanceof WorkerFailure && error.model && this.loadedConfig
					? { model: error.model, config: this.loadedConfig, modelReadMs: this.modelReadMs }
					: undefined
			this.runtime.disableGpu()
			this.cpuFallback = { recovered }
			// A cancelled failed GPU job remembers the broken backend and model,
			// but only a subsequent live request may pay for CPU initialization.
			if (generation !== this.generation) throw speechFailure("cancelled")
			this.stopWorker()
			await this.initialize(voice, "cpu", epoch, recovered)
			this.cpuFallback = undefined
			if (epoch !== this.epoch || generation !== this.generation) throw speechFailure("cancelled")
			this.diagnostics.gpuFallbackReason = "gpu-inference-failed"
			value = await this.request({ type: "synthesize", text, speed, speaker })
		}
		if (epoch !== this.epoch) throw speechFailure("cancelled")
		this.diagnostics.synthesisMs = performance.now() - started
		return value
	}

	cancelQueued() {
		this.generation++
	}
	clearClips() {
		this.cancelQueued()
		// Do not allow an already-running clip to repopulate source-text caches
		// after the reader closed or a different client claimed ownership.
		this.cacheEpoch++
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
			const timer = setTimeout(
				() => this.stopWorker(new SpeechTimeoutError("Speech timed out")),
				SPEECH_REQUEST_TIMEOUT_MS,
			)
			this.pending.set(id, { type: message.type, resolve, reject, timer })
			try {
				this.worker.postMessage({ ...message, id } satisfies WorkerRequest, transfer)
			} catch (error) {
				clearTimeout(timer)
				this.pending.delete(id)
				reject(error)
			}
		})
	}

	private stopWorker(error: Error = speechFailure("cancelled")) {
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
		this.cacheEpoch++
		this.voice = ""
		this.loadedConfig = undefined
		this.cpuFallback = undefined
		this.stopWorker()
		this.generation++
		this.clips.clear()
		this.clipBytes = 0
	}
}
