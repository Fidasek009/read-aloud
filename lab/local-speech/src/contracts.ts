export type ComputeMode = "auto" | "cpu" | "gpu"
export type Backend = "wasm" | "webgpu"
export interface SampleReport {
	lang: string
	text: string
	speed: number
	synthesisMs: number
	durationSeconds: number
	predictedDurationSeconds: number
	realTimeFactor: number
	peak: number
	rms: number
}
export interface ProbeReport {
	userAgent: string
	crossOriginIsolated: boolean
	hardwareConcurrency: number
	requested: ComputeMode
	selected: Backend
	gpu: { api: boolean; adapter: boolean }
	threads: number
	steps: number
	requests: string[]
	denied: string[]
	samples: SampleReport[]
	fallback: string | null
	limitation: string
	initializationMs?: number
	firstClipReadyMs?: number
	speedDurationRatio?: number
}
export interface Clip {
	samples: Float32Array<ArrayBuffer>
	sampleRate: number
}
export interface ProbeResult {
	ok: boolean
	error?: string | null
	report?: ProbeReport
	waves?: string[]
	remoteRequests?: string[]
}
export interface WorkerResult extends ProbeResult {
	clips?: Clip[]
}
