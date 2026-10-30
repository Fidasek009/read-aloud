import { createEspeak } from "@spelling-creator/spellophone/browser"
import * as ort from "onnxruntime-web"

import type { VoiceConfig } from "./catalog.ts"

import { alignWords, tokenizeEvents, tokenizeText } from "./phonemes.ts"

declare const SPEECH_BACKEND: "wasm" | "webgpu"
const base = new URL("../", self.location.href)
ort.env.wasm.wasmPaths = new URL(`ort/${SPEECH_BACKEND}/`, base).href
ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1)) : 1
ort.env.wasm.proxy = false

let session: ort.InferenceSession | undefined
let phonemizer: Awaited<ReturnType<typeof createEspeak>> | undefined
let voiceId: string | undefined
let config: VoiceConfig | undefined
let speaker = 0
let busy = false
self.onmessage = async ({ data }: MessageEvent<unknown>) => {
	if (!data || typeof data !== "object" || !("id" in data) || !Number.isSafeInteger(data.id) || !("type" in data))
		return
	const id = data.id
	if (busy) {
		self.postMessage({ id, ok: false, error: "Speech worker is busy" })
		return
	}
	busy = true
	try {
		if (
			data.type === "load" &&
			"voice" in data &&
			typeof data.voice === "string" &&
			"model" in data &&
			data.model instanceof ArrayBuffer
		) {
			const started = performance.now()
			const model = data.model
			await session?.release()
			voiceId = undefined
			if (!("config" in data) || !data.config || typeof data.config !== "object")
				throw new Error("Missing voice configuration")
			config = data.config as VoiceConfig
			speaker = "speaker" in data && typeof data.speaker === "number" ? data.speaker : 0
			if (SPEECH_BACKEND === "webgpu") {
				const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" })
				if (!adapter || adapter.info.isFallbackAdapter) throw new Error("Hardware GPU is unavailable")
				ort.env.webgpu.adapter = adapter
			}
			const timings: Record<string, number | boolean> = {
				threads: ort.env.wasm.numThreads ?? 1,
				crossOriginIsolated: self.crossOriginIsolated,
			}
			const pronunciation = (async () => {
				const began = performance.now()
				phonemizer ??= await createEspeak({
					dataUrl: new URL("espeak-ng-data/", base),
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
					graphOptimizationLevel: "basic",
					extra: { session: { disable_prepacking: "1" } },
				})
				timings.sessionMs = performance.now() - began
			})()
			await Promise.all([pronunciation, modelSession])
			voiceId = data.voice
			timings.workerLoadMs = performance.now() - started
			self.postMessage({ id, ok: true, timings })
		} else if (
			data.type === "synthesize" &&
			"text" in data &&
			typeof data.text === "string" &&
			data.text.length <= 4000 &&
			"speed" in data &&
			typeof data.speed === "number" &&
			data.speed >= 0.5 &&
			data.speed <= 2 &&
			voiceId &&
			session &&
			phonemizer &&
			config
		) {
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
				feeds.sid = new ort.Tensor("int64", new BigInt64Array([BigInt(speaker)]), [1])
			const output = await session.run(feeds)
			const pcm = Float32Array.from(output.output!.data as Float32Array)
			const durations = Array.from(output.read_aloud_durations!.data as Float32Array)
			const alignment = alignWords(tokens, durations, config.audio.sample_rate, config.hop_length ?? 256)
			if (!pcm.length || pcm.some((value) => !Number.isFinite(value)) || Math.abs(pcm.length - alignment.samples) > 256)
				throw new Error("Speech output is invalid")
			self.postMessage({ id, ok: true, pcm, sampleRate: config.audio.sample_rate, words: alignment.timings }, [
				pcm.buffer,
			])
		} else throw new Error("Invalid speech request")
	} catch (error) {
		self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : "Speech could not be generated" })
	} finally {
		busy = false
	}
}
