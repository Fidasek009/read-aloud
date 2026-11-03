import { expect, test } from "bun:test"

import config from "../src/speech/configs/en_US-ljspeech-medium.json"
import { isWorkerRequest, isWorkerResponse } from "../src/speech/worker-protocol.ts"

test("worker accepts a validated model and rejects corrupted configuration and speaker IDs", () => {
	const load = { id: 1, type: "load", voice: "en_US-ljspeech-medium", speaker: 0, config, model: new ArrayBuffer(1) }
	expect(isWorkerRequest(load)).toBe(true)
	expect(isWorkerRequest({ ...load, config: { ...config, audio: { sample_rate: 1 } } })).toBe(false)
	expect(isWorkerRequest({ ...load, config: null })).toBe(false)
	expect(isWorkerRequest({ ...load, config: { ...config, hop_length: 0 } })).toBe(false)
	expect(isWorkerRequest({ ...load, config: { ...config, phoneme_map: { a: 1 } } })).toBe(false)
	expect(isWorkerRequest({ ...load, speaker: 1 })).toBe(false)
	expect(isWorkerRequest({ ...load, speaker: -1 })).toBe(false)
	expect(isWorkerRequest({ ...load, model: "not a buffer" })).toBe(false)
})

test("worker synthesis uses the same finite speed and input limits as the service", () => {
	const speech = { id: 2, type: "synthesize", text: "hello", speed: 1, speaker: 0 }
	expect(isWorkerRequest(speech)).toBe(true)
	expect(isWorkerRequest({ ...speech, speed: NaN })).toBe(false)
	expect(isWorkerRequest({ ...speech, text: "x".repeat(4001) })).toBe(false)
	expect(isWorkerRequest({ ...speech, speaker: -1 })).toBe(false)
	expect(isWorkerRequest({ ...speech, speaker: 1.5 })).toBe(false)
	expect(isWorkerRequest({ ...speech, type: "cancel" })).toBe(false)
})

test("worker responses reject malformed audio, timings and error codes", () => {
	const clip = {
		id: 3,
		ok: true,
		type: "synthesize",
		pcm: new Float32Array([0.1]),
		sampleRate: 22050,
		words: [{ start: 0, end: 5, from: 0, to: 0.5 }],
	}
	expect(isWorkerResponse(clip)).toBe(true)
	expect(isWorkerResponse({ ...clip, pcm: "invalid" })).toBe(false)
	expect(isWorkerResponse({ ...clip, sampleRate: NaN })).toBe(false)
	expect(isWorkerResponse({ ...clip, words: [{ ...clip.words[0], to: Infinity }] })).toBe(false)
	expect(isWorkerResponse({ ...clip, words: [{ ...clip.words[0], start: 9 }] })).toBe(false)
	expect(isWorkerResponse({ id: 4, ok: true, type: "load", timings: { sessionMs: 10 } })).toBe(true)
	expect(isWorkerResponse({ id: 4, ok: true, type: "load", timings: { sessionMs: NaN } })).toBe(false)
	expect(isWorkerResponse({ id: 5, ok: false, error: "bad text", code: "unreadable-text" })).toBe(true)
	expect(isWorkerResponse({ id: 5, ok: false, error: "bad text", code: "other" })).toBe(false)
	expect(isWorkerResponse({ id: 5, ok: false, error: "GPU failed", model: new ArrayBuffer(8) })).toBe(true)
	expect(isWorkerResponse({ id: 5, ok: false, error: "GPU failed", model: "invalid" })).toBe(false)
})
