import { expect, test } from "bun:test"

import type { SpeechClip } from "../../../src/speech/protocol.ts"

import { SpeechTextError } from "../../../src/speech/errors.ts"
import { synthesizeWithRecovery } from "../../../src/speech/recovery.ts"

const clip = (text: string): SpeechClip => ({
	pcm: Float32Array.of(0.1, 0.2),
	sampleRate: 2,
	words: [{ start: 0, end: text.length, from: 0, to: 1 }],
})

test("unreadable text is isolated, usable speech stays ordered and timed against the original source", async () => {
	const text = "First broken Last"
	const result = await synthesizeWithRecovery(text, async (input) => {
		if (input.includes("broken")) throw new SpeechTextError("Unsupported character")
		return clip(input)
	})
	expect(result.skippedText).toBe(true)
	expect([...result.pcm]).toEqual([...clip("").pcm, ...clip("").pcm])
	expect(result.words).toEqual([
		{ start: 0, end: 5, from: 0, to: 1 },
		{ start: 13, end: 17, from: 1, to: 2 },
	])
})

test("healthy speech is unchanged and a completely unreadable passage has bounded recovery", async () => {
	const original = clip("hello")
	expect(await synthesizeWithRecovery("hello", async () => original)).toBe(original)
	let calls = 0
	const unreadable = await synthesizeWithRecovery(
		"one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen",
		async () => {
			calls++
			throw new SpeechTextError("Cannot pronounce")
		},
	)
	expect(calls).toBeLessThanOrEqual(15)
	expect(unreadable.skippedText).toBe(true)
	expect(unreadable.words).toEqual([])
	expect(unreadable.pcm).toHaveLength(1)
})

test("cancellation and runtime failures propagate immediately instead of discarding text", async () => {
	for (const error of [new DOMException("Reading stopped", "AbortError"), new Error("GPU disconnected")]) {
		let calls = 0
		await expect(
			synthesizeWithRecovery("first second third", async () => {
				calls++
				throw error
			}),
		).rejects.toBe(error)
		expect(calls).toBe(1)
	}
})
