import { expect, test } from "bun:test"

import { SpeechEngine } from "../src/speech/engine.ts"

test("a reused voice reports warm diagnostics without past initialization timings", async () => {
	const engine = new SpeechEngine()
	const internals = engine as unknown as { voice: string; worker: { terminate(): void } }
	internals.voice = "en_US-ljspeech-medium"
	internals.worker = { terminate() {} }
	engine.diagnostics = { loadMs: 7000, sessionMs: 6000, backend: "cpu" }
	await engine.load(internals.voice)
	expect(engine.diagnostics).toEqual({ backend: "cpu", voice: internals.voice, reusedSession: true })
	engine.dispose()
})

test("switching speakers uses the existing model and sends each speaker with its synthesis request", async () => {
	const engine = new SpeechEngine()
	const commands: number[] = []
	let terminated = 0
	const internals = engine as unknown as {
		voice: string
		worker: { terminate(): void }
		request: (message: { speaker: number }) => Promise<unknown>
	}
	internals.voice = "en_GB-aru-medium"
	internals.worker = { terminate: () => terminated++ }
	internals.request = async (message) => {
		commands.push(message.speaker)
		return { pcm: Float32Array.of(0.1), sampleRate: 22050, words: [] }
	}
	await engine.synthesize("hello", 1)
	await engine.load("en_GB-aru-medium#1")
	await engine.synthesize("hello", 1)
	expect(commands).toEqual([0, 1])
	expect(terminated).toBe(0)
	expect(engine.diagnostics.reusedSession).toBe(true)
	engine.dispose()
})

test("a speaker change cannot deliver cancelled speech from the previous speaker", async () => {
	const engine = new SpeechEngine()
	const commands: number[] = []
	let complete: ((value: unknown) => void) | undefined
	const internals = engine as unknown as {
		voice: string
		worker: { terminate(): void }
		request: (message: { speaker: number }) => Promise<unknown>
	}
	internals.voice = "en_GB-aru-medium"
	internals.worker = { terminate() {} }
	internals.request = (message) => {
		commands.push(message.speaker)
		if (commands.length === 1) return new Promise((resolve) => (complete = resolve))
		return Promise.resolve({ pcm: Float32Array.of(0.2), sampleRate: 22050, words: [] })
	}
	const old = engine.synthesize("hello", 1)
	while (!complete) await Promise.resolve()
	engine.cancelQueued()
	await engine.load("en_GB-aru-medium#1")
	const next = engine.synthesize("hello", 1)
	complete({ pcm: Float32Array.of(0.1), sampleRate: 22050, words: [] })
	await expect(old).rejects.toMatchObject({ name: "AbortError" })
	expect([...(await next).pcm]).toEqual([...Float32Array.of(0.2)])
	expect(commands).toEqual([0, 1])
	engine.dispose()
})

test("a cancelled GPU failure does not start CPU fallback or synthesize again", async () => {
	const engine = new SpeechEngine()
	const internals = engine as unknown as {
		backend: "gpu" | "cpu"
		voice: string
		request: () => Promise<unknown>
		initialize: () => Promise<void>
	}
	internals.backend = "gpu"
	internals.voice = "en_US-ljspeech-medium"
	let rejectRequest: (error: Error) => void = () => {}
	let requests = 0
	let fallbacks = 0
	internals.request = () => {
		requests++
		return new Promise((_resolve, reject) => {
			rejectRequest = reject
		})
	}
	internals.initialize = async () => {
		fallbacks++
	}
	const result = engine.synthesize("Read only this text.", 1)
	// Wait for the queued synthesis to enter the worker request.
	while (!requests) await Promise.resolve()
	engine.cancelQueued()
	rejectRequest(new Error("GPU failed"))
	await expect(result).rejects.toMatchObject({ name: "AbortError" })
	expect(fallbacks).toBe(0)
	expect(requests).toBe(1)
	engine.dispose()
})
