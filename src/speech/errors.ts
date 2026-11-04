/** Only source-specific failures may be skipped; runtime and connection failures must surface. */
export class SpeechTextError extends Error {
	override name = "SpeechTextError"
}

export type SpeechFailureCode = "cancelled" | "text" | "timeout" | "transport" | "voice" | "unavailable"

export const SPEECH_REQUEST_TIMEOUT_MS = 90_000

export function isSpeechCancellation(error: unknown): boolean {
	return error instanceof Error && error.name === "AbortError"
}

export class SpeechTimeoutError extends Error {
	override name = "SpeechTimeoutError"
}

export class SpeechTransportError extends Error {
	override name = "SpeechTransportError"
}

export class SpeechVoiceError extends Error {
	override name = "SpeechVoiceError"
}

export class SpeechUnavailableError extends Error {
	override name = "SpeechUnavailableError"
}

export function speechFailureCode(error: unknown): SpeechFailureCode {
	if (error instanceof SpeechTextError) return "text"
	if (error instanceof SpeechTimeoutError) return "timeout"
	if (error instanceof SpeechTransportError) return "transport"
	if (error instanceof SpeechVoiceError) return "voice"
	if (isSpeechCancellation(error)) return "cancelled"
	return "unavailable"
}

export function speechFailure(code: SpeechFailureCode): Error {
	switch (code) {
		case "cancelled":
			return new DOMException("Reading stopped", "AbortError")
		case "text":
			return new SpeechTextError("This voice cannot read this passage. Try a different voice or selection.")
		case "timeout":
			return new SpeechTimeoutError("Speech took too long. Press Play to try again.")
		case "transport":
			return new SpeechTransportError("Speech disconnected. Press Play to reconnect.")
		case "voice":
			return new SpeechVoiceError("This voice is unavailable. Delete it in Voices and download it again.")
		case "unavailable":
			return new SpeechUnavailableError("Speech could not start. Press Play to try again, or choose another voice.")
	}
}
