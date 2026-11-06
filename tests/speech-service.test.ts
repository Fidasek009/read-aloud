import { expect, test } from "bun:test"

import { SpeechTextError } from "../src/speech/errors.ts"
import { type SpeechClip, speechRequest } from "../src/speech/protocol.ts"
import { SpeechService } from "../src/speech/service.ts"

type Backend = ConstructorParameters<typeof SpeechService>[0]
function fakeBackend(overrides: Partial<Backend> = {}): Backend {
	return {
		diagnostics: {},
		load: async () => {},
		synthesize: async () => {
			throw new Error("Unexpected synthesis")
		},
		cancelQueued: () => {},
		clearClips: () => {},
		dispose: () => {},
		...overrides,
	}
}

const clip = (pcm = Float32Array.of(0.1, -0.2)): SpeechClip => ({
	pcm,
	sampleRate: 22050,
	words: [{ start: 0, end: 1, from: 0, to: 1 }],
})

test("speech messages reject malformed and oversized input before crossing the inference boundary", () => {
	expect(speechRequest({ id: 1, type: "synthesize", text: "hello", speed: 1 })).toBe(true)
	expect(speechRequest({ id: 1, type: "synthesize", text: "a".repeat(4001), speed: 1 })).toBe(false)
	expect(speechRequest({ id: 1, type: "synthesize", text: "hello", speed: NaN })).toBe(false)
	expect(speechRequest({ id: 1, type: "load", voice: "a".repeat(161) })).toBe(false)
	expect(speechRequest({ id: 1.5, type: "cancel" })).toBe(false)
})

test("structured transport preserves PCM samples without base64 encoding", async () => {
	const pcm = Float32Array.of(0.1, -0.2)
	const service = new SpeechService(fakeBackend({ synthesize: async () => clip(pcm) }), "structured")
	try {
		await service.request("reader", { id: 1, type: "load", voice: "en_US-ljspeech-medium" })
		const result = await service.request("reader", { id: 2, type: "synthesize", text: "hello", speed: 1 })
		expect(result.clip?.pcm).toBeInstanceOf(Float32Array)
		expect([...((result.clip?.pcm ?? []) as Float32Array)]).toEqual([...pcm])
	} finally {
		service.dispose()
	}
})

test("changing a voice invalidates in-flight speech even without a separate cancel message", async () => {
	let finish: ((value: SpeechClip) => void) | undefined
	let cancelled = 0
	const service = new SpeechService(
		fakeBackend({
			synthesize: () => new Promise((resolve) => (finish = resolve)),
			cancelQueued: () => cancelled++,
		}),
	)
	try {
		await service.request("reader", { id: 1, type: "load", voice: "en_GB-aru-medium" })
		const stale = service.request("reader", { id: 2, type: "synthesize", text: "hello", speed: 1 })
		await service.request("reader", { id: 3, type: "load", voice: "en_US-ljspeech-medium" })
		finish!(clip(Float32Array.of(0.1)))
		expect(await stale).toMatchObject({ ok: false, code: "cancelled" })
		expect(cancelled).toBe(1)
	} finally {
		service.dispose()
	}
})

test("replaced or closed readers cannot receive late speech from the shared model host", async () => {
	const completions: ((clip: SpeechClip) => void)[] = []
	let releases = 0
	const service = new SpeechService(
		fakeBackend({
			diagnostics: { voice: "en_US-ljspeech-medium" },
			synthesize: () => new Promise((resolve) => completions.push(resolve)),
			clearClips: () => {
				releases++
			},
		}),
	)
	const sample = clip()
	try {
		await service.request("old", { id: 1, type: "load", voice: "en_US-ljspeech-medium" })
		const stale = service.request("old", { id: 2, type: "synthesize", text: "old", speed: 1 })
		await service.request("new", { id: 3, type: "load", voice: "en_US-ljspeech-medium" })
		completions.shift()!(sample)
		expect(await stale).toMatchObject({ ok: false, code: "cancelled" })
		const closed = service.request("new", { id: 4, type: "synthesize", text: "new", speed: 1 })
		service.release("new")
		completions.shift()!(sample)
		expect(await closed).toMatchObject({ ok: false, code: "cancelled" })
		expect(releases).toBe(3)
		await service.request("live", { id: 5, type: "load", voice: "en_US-ljspeech-medium" })
		const live = service.request("live", { id: 6, type: "synthesize", text: "live", speed: 1 })
		completions.shift()!(sample)
		const response = await live
		expect(response.ok).toBe(true)
		expect(typeof response.clip!.pcm).toBe("string")
		const decoded = Uint8Array.fromBase64(response.clip!.pcm as string)
		expect([...new Float32Array(decoded.buffer)]).toEqual([...sample.pcm])
	} finally {
		service.dispose()
	}
})

test("deleting a voice cancels its pending load but leaves unrelated voice preparation alone", async () => {
	let rejectLoad: ((error: Error) => void) | undefined
	let disposed = 0
	const service = new SpeechService(
		fakeBackend({
			diagnostics: { voice: "en_US-ljspeech-medium" },
			load: () =>
				new Promise<void>((_resolve, reject) => {
					rejectLoad = reject
				}),
			dispose: () => {
				disposed++
				rejectLoad?.(new DOMException("Reading stopped", "AbortError"))
			},
		}),
	)
	try {
		const pending = service.request("reader", { id: 1, type: "load", voice: "cs_CZ-jirka-medium" })
		service.voiceDeleted("en_US-ljspeech-medium")
		expect(disposed).toBe(0)
		service.voiceDeleted("cs_CZ-jirka-medium")
		expect(disposed).toBe(1)
		expect(await pending).toMatchObject({ ok: false, code: "cancelled" })
	} finally {
		service.dispose()
	}
})

test("cancelling the same reader prevents an in-flight content recovery from spawning new synthesis", async () => {
	let reject: (error: Error) => void = () => {}
	let calls = 0
	const service = new SpeechService(
		fakeBackend({
			synthesize: () => {
				calls++
				return new Promise((_resolve, fail) => {
					reject = fail
				})
			},
		}),
	)
	try {
		await service.request("reader", { id: 1, type: "load", voice: "en_US-ljspeech-medium" })
		const pending = service.request("reader", { id: 2, type: "synthesize", text: "first broken last", speed: 1 })
		await service.request("reader", { id: 3, type: "cancel" })
		reject(new SpeechTextError("Cannot pronounce"))
		expect(await pending).toMatchObject({ ok: false, code: "cancelled" })
		expect(calls).toBe(1)
	} finally {
		service.dispose()
	}
})
