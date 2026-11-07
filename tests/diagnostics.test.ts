import { expect, test } from "bun:test"

import { firstAudioPerformance, firstBufferPerformance, speechDiagnostics } from "../src/speech/diagnostics.ts"
import { isWorkerTimings } from "../src/speech/worker-timings.ts"

test("diagnostics retain measured metadata and remove source text and arbitrary errors", () => {
	expect(
		speechDiagnostics({
			backend: "cpu",
			voice: "en_US-ljspeech-medium",
			threads: 4,
			crossOriginIsolated: true,
			modelReadMs: 22,
			phonemizerMs: 34,
			sessionMs: 123,
			workerLoadMs: 130,
			loadMs: 160,
			synthesisMs: 50,
			reusedSession: false,
			modelReusedOnFallback: true,
			gpuFallbackReason: "gpu-initialization-failed",
			text: "Private article text",
			error: "Private runtime diagnostic",
			url: "https://private.example/",
		}),
	).toEqual({
		backend: "cpu",
		voice: "en_US-ljspeech-medium",
		threads: 4,
		crossOriginIsolated: true,
		modelReadMs: 22,
		phonemizerMs: 34,
		sessionMs: 123,
		workerLoadMs: 130,
		loadMs: 160,
		synthesisMs: 50,
		reusedSession: false,
		modelReusedOnFallback: true,
		gpuFallbackReason: "gpu-initialization-failed",
	})
})

test("diagnostics reject malformed timings, unknown voices and raw fallback messages", () => {
	expect(
		speechDiagnostics({
			voice: "Private article text",
			gpuFallbackReason: "GPU failed while reading Private article text",
			loadMs: NaN,
			synthesisMs: -1,
			threads: 1.5,
			backend: "cloud",
			crossOriginIsolated: "true",
		}),
	).toEqual({})
	expect(speechDiagnostics({ voice: "en_GB-aru-medium" })).toEqual({ voice: "en_GB-aru-medium" })
	for (const voice of ["en_GB-aru-medium#1", "en_US-ljspeech-medium#1"])
		expect(speechDiagnostics({ voice })).toEqual({})
})

test("worker timings accept only declared fields with appropriate values", () => {
	expect(isWorkerTimings({ threads: 4, crossOriginIsolated: true, sessionMs: 0 })).toBe(true)
	for (const value of [
		null,
		[],
		{ sessionMs: NaN },
		{ sessionMs: -1 },
		{ sessionMs: true },
		{ threads: 0 },
		{ text: "private" },
		{ unrelated: 3 },
	])
		expect(isWorkerTimings(value)).toBe(false)
})

test("performance persistence constructs a fresh allowlisted record without arbitrary strings", () => {
	const result = firstBufferPerformance(
		{
			synthesisMs: 50,
			reusedSession: true,
			text: "Private article text",
			recordedAt: "private",
			audioContextState: "private",
		},
		80,
	)
	expect(result).toMatchObject({
		synthesisMs: 50,
		reusedSession: true,
		timeToFirstBufferMs: 80,
	})
	expect(new Date(result!.recordedAt).toISOString()).toBe(result!.recordedAt)
	expect(JSON.stringify(result)).not.toContain("private")
	expect(firstBufferPerformance({}, Infinity)).toBeUndefined()
	expect(firstAudioPerformance({}, 10, 9)).toBeUndefined()
	expect(firstAudioPerformance({}, 10, Infinity)).toBeUndefined()
	expect(firstAudioPerformance({}, 10, 20)).toMatchObject({ timeToFirstBufferMs: 10, timeToFirstAudioMs: 20 })
	expect(firstBufferPerformance({ audioContextState: "running" }, 10)).not.toHaveProperty("audioContextState")
})
