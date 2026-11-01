import { expect, test } from "bun:test"

import { speechRequest } from "../../../src/speech/protocol.ts"
import { SpeechService } from "../../../src/speech/service.ts"

test("speech messages reject malformed and oversized input before crossing the inference boundary", () => {
	expect(speechRequest({ id: 1, type: "synthesize", text: "hello", speed: 1 })).toBe(true)
	expect(speechRequest({ id: 1, type: "synthesize", text: "a".repeat(4001), speed: 1 })).toBe(false)
	expect(speechRequest({ id: 1, type: "synthesize", text: "hello", speed: NaN })).toBe(false)
	expect(speechRequest({ id: 1, type: "load", voice: "a".repeat(161) })).toBe(false)
	expect(speechRequest({ id: 1.5, type: "cancel" })).toBe(false)
})

test("replaced or closed readers cannot receive late speech from the shared model host", async () => {
	const completions: ((clip: any) => void)[] = []
	let releases = 0
	const service = new SpeechService({
		diagnostics: { voice: "en_US-ljspeech-medium" },
		load: async () => {},
		synthesize: () => new Promise((resolve) => completions.push(resolve)),
		cancelQueued: () => {},
		clearClips: () => {
			releases++
		},
		dispose: () => {},
	})
	const clip = { pcm: Float32Array.of(0.1, -0.2), sampleRate: 22050, words: [{ start: 0, end: 1, from: 0, to: 1 }] }
	try {
		await service.request("old", { id: 1, type: "load", voice: "en_US-ljspeech-medium" })
		const stale = service.request("old", { id: 2, type: "synthesize", text: "old", speed: 1 })
		await service.request("new", { id: 3, type: "load", voice: "en_US-ljspeech-medium" })
		completions.shift()!(clip)
		expect(await stale).toMatchObject({ ok: false, error: "Reading stopped" })
		const closed = service.request("new", { id: 4, type: "synthesize", text: "new", speed: 1 })
		service.release("new")
		completions.shift()!(clip)
		expect(await closed).toMatchObject({ ok: false, error: "Reading stopped" })
		expect(releases).toBe(3)
		await service.request("live", { id: 5, type: "load", voice: "en_US-ljspeech-medium" })
		const live = service.request("live", { id: 6, type: "synthesize", text: "live", speed: 1 })
		completions.shift()!(clip)
		const response = await live
		expect(response.ok).toBe(true)
		const decoded = Uint8Array.fromBase64(response.clip!.pcm)
		expect([...new Float32Array(decoded.buffer)]).toEqual([...clip.pcm])
	} finally {
		service.dispose()
	}
})

test("deleting a voice cancels its pending load but leaves unrelated voice preparation alone", async () => {
	let rejectLoad: ((error: Error) => void) | undefined
	let disposed = 0
	const service = new SpeechService({
		diagnostics: { voice: "en_US-ljspeech-medium" },
		load: () =>
			new Promise<void>((_resolve, reject) => {
				rejectLoad = reject
			}),
		synthesize: async () => {
			throw new Error("Unexpected synthesis")
		},
		cancelQueued: () => {},
		clearClips: () => {},
		dispose: () => {
			disposed++
			rejectLoad?.(new DOMException("Reading stopped", "AbortError"))
		},
	})
	try {
		const pending = service.request("reader", { id: 1, type: "load", voice: "cs_CZ-jirka-medium" })
		service.voiceDeleted("en_US-ljspeech-medium")
		expect(disposed).toBe(0)
		service.voiceDeleted("cs_CZ-jirka-medium")
		expect(disposed).toBe(1)
		expect(await pending).toMatchObject({ ok: false, error: "Reading stopped" })
	} finally {
		service.dispose()
	}
})

test("cancelling the same reader prevents an in-flight content recovery from spawning new synthesis", async () => {
	const { SpeechTextError } = await import("../../../src/speech/errors.ts")
	let reject: (error: Error) => void = () => {}
	let calls = 0
	const service = new SpeechService({
		diagnostics: {},
		load: async () => {},
		synthesize: () => {
			calls++
			return new Promise((_resolve, fail) => {
				reject = fail
			})
		},
		cancelQueued: () => {},
		clearClips: () => {},
		dispose: () => {},
	})
	try {
		await service.request("reader", { id: 1, type: "load", voice: "en_US-ljspeech-medium" })
		const pending = service.request("reader", { id: 2, type: "synthesize", text: "first broken last", speed: 1 })
		await service.request("reader", { id: 3, type: "cancel" })
		reject(new SpeechTextError("Cannot pronounce"))
		expect(await pending).toMatchObject({ ok: false, error: "Reading stopped" })
		expect(calls).toBe(1)
	} finally {
		service.dispose()
	}
})
