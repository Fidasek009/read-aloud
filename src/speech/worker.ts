import { createEspeak } from "@spelling-creator/spellophone/browser"
import * as ort from "onnxruntime-web"

import type { WorkerTimings } from "./diagnostics.ts"
import type { VoiceConfig } from "./voice-config.ts"

import { speechDataFetch } from "./data-fetch.ts"
import { SpeechTextError } from "./errors.ts"
import { alignWords, tokenizeEvents, tokenizeText } from "./phonemes.ts"
import { isWorkerRequest, type WorkerResponse } from "./worker-protocol.ts"

declare const SPEECH_BACKEND: "wasm" | "webgpu"
const base = new URL("../", self.location.href)
ort.env.wasm.wasmPaths = new URL(`ort/${SPEECH_BACKEND}/`, base).href
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1)) : 1
ort.env.wasm.proxy = false

let session: ort.InferenceSession | undefined
let phonemizer: Awaited<ReturnType<typeof createEspeak>> | undefined
let voiceId: string | undefined
// GPU inference can fail after a successful load. Retain its source buffer so
// the CPU retry transfers ownership rather than rereading the full model.
let fallbackModel: ArrayBuffer | undefined
let config: VoiceConfig | undefined
let busy = false
self.onmessage = async ({ data }: MessageEvent<unknown>) => {
	if (
		!data ||
		typeof data !== "object" ||
		!("id" in data) ||
		typeof data.id !== "number" ||
		!Number.isSafeInteger(data.id) ||
		!("type" in data)
	)
		return
	const id = data.id
	if (busy) {
		self.postMessage({ id, ok: false, error: "Speech worker is busy" } satisfies WorkerResponse)
		return
	}
	busy = true
	try {
		if (!isWorkerRequest(data)) throw new Error("Invalid speech request")
		if (data.type === "load") {
			const started = performance.now()
			const model = data.model
			fallbackModel = SPEECH_BACKEND === "webgpu" ? model : undefined
			await session?.release()
			voiceId = undefined
			config = data.config
			if (SPEECH_BACKEND === "webgpu") {
				const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" })
				if (!adapter || adapter.info.isFallbackAdapter) throw new Error("Hardware GPU is unavailable")
				ort.env.webgpu.adapter = adapter
			}
			const timings: WorkerTimings = {
				threads: ort.env.wasm.numThreads ?? 1,
				crossOriginIsolated: self.crossOriginIsolated,
			}
			const pronunciation = (async () => {
				const began = performance.now()
				phonemizer ??= await createEspeak({
					dataUrl: new URL("espeak-ng-data/", base),
					fetch: speechDataFetch(new URL("espeak-ng-data/", base)),
					wasmUrl: new URL("espeak-ng.wasm", base),
					languages: [],
					phonemeEvents: "ipa",
				})
				await phonemizer.loadVoice(config!.espeak.voice)
				timings.phonemizerMs = performance.now() - began
			})()
			const modelSession = (async () => {
				const began = performance.now()
				session = await ort.InferenceSession.create(model, {
					executionProviders: [SPEECH_BACKEND],
					graphOptimizationLevel: "all",
					extra: { session: { disable_prepacking: "1" } },
				})
				timings.sessionMs = performance.now() - began
			})()
			await Promise.all([pronunciation, modelSession])
			voiceId = data.voice
			timings.workerLoadMs = performance.now() - started
			self.postMessage({ id, ok: true, type: "load", timings } satisfies WorkerResponse)
		} else if (data.type === "synthesize" && voiceId && session && phonemizer && config) {
			if (data.speaker >= (config.num_speakers ?? 1)) throw new Error("This speaker is not available")
			const tokens =
				config.phoneme_type === "text"
					? tokenizeText(data.text, config.phoneme_id_map, config.espeak.voice)
					: tokenizeEvents(
							data.text,
							phonemizer.synthesize(data.text).events,
							config.phoneme_id_map,
							config.phoneme_map,
						)
			const ids = BigInt64Array.from(tokens.ids, BigInt)
			const feeds: Record<string, ort.Tensor> = {
				input: new ort.Tensor("int64", ids, [1, ids.length]),
				input_lengths: new ort.Tensor("int64", new BigInt64Array([BigInt(ids.length)]), [1]),
				scales: new ort.Tensor(
					"float32",
					new Float32Array([
						config.inference.noise_scale,
						config.inference.length_scale / data.speed,
						config.inference.noise_w,
					]),
					[3],
				),
			}
			if (session.inputNames.includes("sid"))
				feeds.sid = new ort.Tensor("int64", new BigInt64Array([BigInt(data.speaker)]), [1])
			const output = await session.run(feeds)
			const pcm = Float32Array.from(output.output!.data as Float32Array)
			const durations = output.read_aloud_durations!.data as Float32Array
			const alignment = alignWords(tokens, durations, config.audio.sample_rate, config.hop_length ?? 256)
			if (!pcm.length || pcm.some((value) => !Number.isFinite(value)) || Math.abs(pcm.length - alignment.samples) > 256)
				throw new Error("Speech output is invalid")
			self.postMessage(
				{
					id,
					ok: true,
					type: "synthesize",
					pcm,
					sampleRate: config.audio.sample_rate,
					words: alignment.timings,
				} satisfies WorkerResponse,
				[pcm.buffer],
			)
		} else throw new Error("Invalid speech request")
	} catch (error) {
		// Return ownership after a failed load so CPU fallback can reuse the
		// exact bytes without an unconditional 60+ MB copy on successful loads.
		const model =
			data.type === "load" && "model" in data && data.model instanceof ArrayBuffer && data.model.byteLength
				? data.model
				: !(error instanceof SpeechTextError)
					? fallbackModel
					: undefined
		if (model) fallbackModel = undefined
		self.postMessage(
			{
				id,
				ok: false,
				error: error instanceof Error ? error.message : "Speech could not be generated",
				...(error instanceof SpeechTextError ? { code: "unreadable-text" as const } : {}),
				...(model ? { model } : {}),
			} satisfies WorkerResponse,
			model ? [model] : [],
		)
	} finally {
		busy = false
	}
}
