import { expect, test } from "bun:test"

import { SpeechError, speechFailure, speechFailureCode, SpeechTextError } from "../src/speech/errors.ts"

test("speech failures retain their category across the transport without exposing internals", () => {
	for (const original of [
		new DOMException("stopped", "AbortError"),
		new SpeechTextError("private phonemizer diagnostic"),
		new SpeechError("timeout", "private timeout diagnostic"),
		new SpeechError("transport", "private transport diagnostic"),
		new SpeechError("voice", "private voice diagnostic"),
		new Error("private runtime diagnostic"),
	]) {
		const code = speechFailureCode(original)
		const restored = speechFailure(code)
		expect(speechFailureCode(restored)).toBe(code)
		expect(restored.message).not.toContain("private")
	}
})
