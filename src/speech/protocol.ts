import type { WordTiming } from "./phonemes.ts"

export interface SpeechClip {
	pcm: Float32Array<ArrayBuffer>
	sampleRate: number
	words: WordTiming[]
}

export type SpeechRequest = { id: number } & (
	{ type: "load"; voice: string } | { type: "synthesize"; text: string; speed: number } | { type: "cancel" }
)
export interface SpeechResponse {
	id: number
	ok: boolean
	error?: string
	diagnostics?: Record<string, unknown>
	clip?: { pcm: string; sampleRate: number; words: WordTiming[] }
}
export function speechRequest(value: unknown): value is SpeechRequest {
	if (!value || typeof value !== "object" || !("id" in value) || !Number.isSafeInteger(value.id) || !("type" in value))
		return false
	if (value.type === "cancel") return true
	if (value.type === "load") return "voice" in value && typeof value.voice === "string" && value.voice.length <= 160
	return (
		value.type === "synthesize" &&
		"text" in value &&
		typeof value.text === "string" &&
		value.text.length <= 4000 &&
		"speed" in value &&
		typeof value.speed === "number" &&
		Number.isFinite(value.speed) &&
		value.speed >= 0.5 &&
		value.speed <= 2
	)
}
