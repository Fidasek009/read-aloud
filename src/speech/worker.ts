import { createEspeak } from "@spelling-creator/spellophone/browser"
import * as ort from "onnxruntime-web"

import { getVoice } from "./catalog.ts"
import { alignWords, tokenizeEvents } from "./phonemes.ts"

declare const SPEECH_BACKEND: "wasm" | "webgpu"
const base = new URL("../", self.location.href)
ort.env.wasm.wasmPaths = new URL(`ort/${SPEECH_BACKEND}/`, base).href
ort.env.wasm.numThreads = 1
ort.env.wasm.proxy = false

let session: ort.InferenceSession | undefined
let phonemizer: Awaited<ReturnType<typeof createEspeak>> | undefined
let voiceId: string | undefined
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
			await session?.release()
			voiceId = undefined
			const voice = getVoice(data.voice)
			if (SPEECH_BACKEND === "webgpu" && !(await navigator.gpu?.requestAdapter())) throw new Error("GPU is unavailable")
			phonemizer ??= await createEspeak({
				dataUrl: new URL("espeak-ng-data/", base),
				wasmUrl: new URL("espeak-ng.wasm", base),
				languages: "all",
				phonemeEvents: "ipa",
			})
			phonemizer.setVoice(voice.config.espeak.voice)
			session = await ort.InferenceSession.create(data.model, {
				executionProviders: [SPEECH_BACKEND],
				graphOptimizationLevel: "basic",
			})
			voiceId = voice.id
			self.postMessage({ id, ok: true })
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
			phonemizer
		) {
			const config = getVoice(voiceId).config
			const tokens = tokenizeEvents(data.text, phonemizer.synthesize(data.text).events, config.phoneme_id_map)
			const ids = BigInt64Array.from(tokens.ids, BigInt)
			const output = await session.run({
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
			})
			const pcm = Float32Array.from(output.output!.data as Float32Array)
			const durations = Array.from(output.read_aloud_durations!.data as Float32Array)
			const alignment = alignWords(tokens, durations, config.audio.sample_rate)
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
