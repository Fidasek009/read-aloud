export type SpeechFailureCode = "cancelled" | "text" | "timeout" | "transport" | "voice" | "unavailable"

export const SPEECH_REQUEST_TIMEOUT_MS = 90_000

const messages: Record<SpeechFailureCode, string> = {
	cancelled: "Reading stopped",
	text: "This voice cannot read this passage. Try a different voice or selection.",
	timeout: "Speech took too long. Press Play to try again.",
	transport: "Speech disconnected. Press Play to reconnect.",
	voice: "This voice is unavailable. Delete it in Voices and download it again.",
	unavailable: "Speech could not start. Press Play to try again, or choose another voice.",
}

/** A failure whose category survives transport; internal details stay out of user-facing messages. */
export class SpeechError extends Error {
	override name = "SpeechError"
	constructor(
		readonly code: SpeechFailureCode,
		message: string,
	) {
		super(message)
	}
}

/** Only source-specific failures may be skipped; runtime and connection failures must surface. */
export class SpeechTextError extends SpeechError {
	override name = "SpeechTextError"
	constructor(message: string) {
		super("text", message)
	}
}

export function isSpeechCancellation(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError"
}

export function speechFailureCode(error: unknown): SpeechFailureCode {
	if (error instanceof SpeechError) return error.code
	if (isSpeechCancellation(error)) return "cancelled"
	return "unavailable"
}

export function speechFailure(code: SpeechFailureCode): Error {
	if (code === "cancelled") return new DOMException(messages.cancelled, "AbortError")
	if (code === "text") return new SpeechTextError(messages.text)
	return new SpeechError(code, messages[code])
}
