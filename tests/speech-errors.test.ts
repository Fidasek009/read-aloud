import { expect, test } from "bun:test"

import {
	speechFailure,
	speechFailureCode,
	SpeechTextError,
	SpeechTimeoutError,
	SpeechTransportError,
	SpeechVoiceError,
} from "../src/speech/errors.ts"

test("speech failures retain their category across the transport without exposing internals", () => {
	for (const original of [
		new DOMException("stopped", "AbortError"),
		new SpeechTextError("private phonemizer diagnostic"),
		new SpeechTimeoutError("private timeout diagnostic"),
		new SpeechTransportError("private transport diagnostic"),
		new SpeechVoiceError("private voice diagnostic"),
		new Error("private runtime diagnostic"),
	]) {
		const code = speechFailureCode(original)
		const restored = speechFailure(code)
		expect(speechFailureCode(restored)).toBe(code)
		expect(restored.message).not.toContain("private")
	}
})
