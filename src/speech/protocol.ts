import type { SpeechDiagnostics } from "./diagnostics.ts"
import type { SpeechFailureCode } from "./errors.ts"
import type { WordTiming } from "./phonemes.ts"

export const MAX_VOICE_CHOICE_LENGTH = 160

/** A speaker choice can share one downloaded model with other choices. */
export function voiceModelId(choice: string): string {
	const separator = choice.indexOf("#")
	return separator < 0 ? choice : choice.slice(0, separator)
}

export interface SpeechClip {
	pcm: Float32Array<ArrayBuffer>
	sampleRate: number
	words: WordTiming[]
	skippedText?: boolean
}

export interface VoiceChange {
	id: string
	deleted: boolean
	revision: string
}
export function isVoiceChange(value: unknown): value is VoiceChange {
	return (
		!!value &&
		typeof value === "object" &&
		"id" in value &&
		typeof value.id === "string" &&
		value.id.length <= MAX_VOICE_CHOICE_LENGTH &&
		"deleted" in value &&
		typeof value.deleted === "boolean" &&
		"revision" in value &&
		typeof value.revision === "string"
	)
}

export type SpeechRequest = { id: number } & (
	{ type: "load"; voice: string } | { type: "synthesize"; text: string; speed: number } | { type: "cancel" }
)
export interface SpeechResponse {
	id: number
	ok: boolean
	code?: SpeechFailureCode
	diagnostics?: SpeechDiagnostics
	clip?: { pcm: string | Float32Array<ArrayBuffer>; sampleRate: number; words: WordTiming[]; skippedText?: boolean }
}
export function speechRequest(value: unknown): value is SpeechRequest {
	if (!value || typeof value !== "object" || !("id" in value) || !Number.isSafeInteger(value.id) || !("type" in value))
		return false
	if (value.type === "cancel") return true
	if (value.type === "load")
		return "voice" in value && typeof value.voice === "string" && value.voice.length <= MAX_VOICE_CHOICE_LENGTH
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
