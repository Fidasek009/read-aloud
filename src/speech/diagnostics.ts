import catalog from "./voices.json"

/** Configured runtime values and elapsed times only; never source text or errors. */
export interface WorkerTimings {
	threads?: number
	crossOriginIsolated?: boolean
	phonemizerMs?: number
	sessionMs?: number
	workerLoadMs?: number
}

export type GpuFallbackReason = "gpu-initialization-failed" | "gpu-inference-failed"

export interface SpeechDiagnostics extends WorkerTimings {
	backend?: "cpu" | "gpu"
	voice?: string
	modelReadMs?: number
	loadMs?: number
	synthesisMs?: number
	reusedSession?: boolean
	modelReusedOnFallback?: boolean
	gpuFallbackReason?: GpuFallbackReason
}

export interface SpeechPerformance extends SpeechDiagnostics {
	timeToFirstBufferMs: number
	audioContextState: "running" | "suspended" | "closed" | "interrupted"
	recordedAt: string
}

const workerDurations = ["phonemizerMs", "sessionMs", "workerLoadMs"] as const
const engineDurations = ["modelReadMs", "loadMs", "synthesisMs"] as const

function elapsed(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value) && value >= 0
}

function object(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value)
}

function workerField(key: string, value: unknown): boolean {
	if (key === "threads") return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 256
	if (key === "crossOriginIsolated") return typeof value === "boolean"
	return workerDurations.some((field) => field === key) && elapsed(value)
}

/** Reject extra worker fields before an engine can spread them into diagnostics. */
export function isWorkerTimings(value: unknown): value is WorkerTimings {
	return object(value) && Object.entries(value).every(([key, item]) => workerField(key, item))
}

function knownVoice(choice: unknown): choice is string {
	if (typeof choice !== "string" || choice.length > 160) return false
	const [id, speaker, extra] = choice.split("#")
	const voice = catalog.voices.find((item) => item.id === id)
	return (
		!!voice &&
		extra === undefined &&
		(speaker === undefined ||
			(/^\d+$/u.test(speaker) && Number.isSafeInteger(Number(speaker)) && Number(speaker) < voice.speakers))
	)
}

/** Copy an explicit allowlist at transport and persistence boundaries. */
export function speechDiagnostics(value: unknown): SpeechDiagnostics {
	if (!object(value)) return {}
	const result: SpeechDiagnostics = {}
	for (const field of [...workerDurations, ...engineDurations]) if (elapsed(value[field])) result[field] = value[field]
	if (workerField("threads", value.threads)) result.threads = value.threads as number
	if (typeof value.crossOriginIsolated === "boolean") result.crossOriginIsolated = value.crossOriginIsolated
	if (value.backend === "cpu" || value.backend === "gpu") result.backend = value.backend
	if (knownVoice(value.voice)) result.voice = value.voice
	if (typeof value.reusedSession === "boolean") result.reusedSession = value.reusedSession
	if (typeof value.modelReusedOnFallback === "boolean") result.modelReusedOnFallback = value.modelReusedOnFallback
	if (value.gpuFallbackReason === "gpu-initialization-failed" || value.gpuFallbackReason === "gpu-inference-failed")
		result.gpuFallbackReason = value.gpuFallbackReason
	return result
}

/** Build the persisted record without accepting arbitrary strings from callers. */
export function firstBufferPerformance(
	diagnostics: unknown,
	timeToFirstBufferMs: number,
	audioContextState: string,
): SpeechPerformance | undefined {
	if (
		!elapsed(timeToFirstBufferMs) ||
		!(
			audioContextState === "running" ||
			audioContextState === "suspended" ||
			audioContextState === "closed" ||
			audioContextState === "interrupted"
		)
	)
		return
	return {
		...speechDiagnostics(diagnostics),
		timeToFirstBufferMs,
		audioContextState,
		recordedAt: new Date().toISOString(),
	}
}
