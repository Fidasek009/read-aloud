import { createEspeak } from "@spelling-creator/spellophone/browser"
import * as ort from "onnxruntime-web"

import type { Clip, ComputeMode, ProbeReport } from "../contracts.ts"

import { alignWords, tokenizeEvents } from "../../../../src/speech/phonemes.ts"
import { createPhonemizer } from "./phonemizer.ts"

const base = new URL("./", self.location.href)
const nativeFetch = globalThis.fetch.bind(globalThis)
const requests: string[] = [],
	denied: string[] = []
globalThis.fetch = (input, options) => {
	const source = typeof input === "string" || input instanceof URL ? String(input) : input.url
	const url = new URL(source, base)
	if (url.origin !== base.origin) {
		denied.push(url.href)
		return Promise.reject(new Error("Remote fetch rejected"))
	}
	requests.push(url.pathname)
	return nativeFetch(url.href, options)
}
ort.env.wasm.wasmPaths = new URL("runtime/", base).href
ort.env.wasm.proxy = false
ort.env.wasm.numThreads = 1

interface VoiceConfig {
	audio: { sample_rate: number }
	espeak: { voice: string }
	inference: { noise_scale: number; length_scale: number; noise_w: number }
	phoneme_id_map: Record<string, number[]>
}
let started = false
self.onmessage = async ({
	data,
}: MessageEvent<{ provider: ComputeMode; optimization?: "disabled" | "basic" | "all" }>) => {
	if (started) return
	started = true
	const report: ProbeReport = {
		userAgent: navigator.userAgent,
		crossOriginIsolated: self.crossOriginIsolated,
		hardwareConcurrency: navigator.hardwareConcurrency,
		requested: data.provider,
		selected: "wasm",
		gpu: { api: Boolean(navigator.gpu), adapter: false },
		threads: 1,
		steps: 0,
		requests,
		denied,
		samples: [],
		fallback: null,
		limitation:
			"Private Piper experiment. Word mapping and production phonemizer source/build provenance still require validation.",
	}
	const sessions: ort.InferenceSession[] = []
	const durationEvidence: unknown[] = []
	const phonemizerEvidence: unknown[] = []
	const startupEvidence: Record<string, number> = {}
	try {
		const startedAt = performance.now()
		if (data.provider !== "cpu") {
			const adapter = await navigator.gpu?.requestAdapter().catch(() => null)
			report.gpu.adapter = Boolean(adapter)
			if (adapter) report.selected = "webgpu"
			else report.fallback = "No usable WebGPU adapter"
			if (data.provider === "gpu" && !adapter) throw new Error("GPU-only probe has no adapter")
		}
		let clock = performance.now()
		const phonemize = await createPhonemizer(base)
		startupEvidence.legacyPhonemizerMs = performance.now() - clock
		clock = performance.now()
		const espeak = await createEspeak({
			dataUrl: new URL("espeak-ng-data/", base),
			wasmUrl: new URL("espeak-ng.wasm", base),
			languages: ["en", "cs"],
			phonemeEvents: "ipa",
		})
		startupEvidence.spellophoneMs = performance.now() - clock
		const voices = new Map<string, { session: ort.InferenceSession; config: VoiceConfig }>()
		const definitions = [
			{ id: "en_US-ljspeech-medium", path: "en/en_US/ljspeech/medium" },
			{ id: "cs_CZ-jirka-medium", path: "cs/cs_CZ/jirka/medium" },
		]
		async function loadVoice(id: string) {
			const existing = voices.get(id)
			if (existing) return existing
			const voice = definitions.find((voice) => voice.id === id)!
			const before = performance.now()
			const config = (await (
				await fetch(new URL(`models/${voice.path}/${voice.id}.onnx.json`, base))
			).json()) as VoiceConfig
			const session = await ort.InferenceSession.create(new URL(`models/timed/${voice.id}.onnx`, base).href, {
				executionProviders: [report.selected],
				graphOptimizationLevel: data.optimization ?? "basic",
			})
			voices.set(voice.id, { session, config })
			sessions.push(session)
			startupEvidence[`${id}Ms`] = performance.now() - before
			return { session, config }
		}
		const fixtures = [
			{
				lang: "en",
				voice: "en_US-ljspeech-medium",
				speed: 1,
				text: "A good reading experience should feel effortless. Your words stay on your device.",
			},
			{
				lang: "cs",
				voice: "cs_CZ-jirka-medium",
				speed: 1,
				text: "Dobrý den. Čtení běží přímo ve vašem počítači a váš text zůstává v soukromí.",
			},
			{
				lang: "cs",
				voice: "cs_CZ-jirka-medium",
				speed: 1.5,
				text: "Dobrý den. Čtení běží přímo ve vašem počítači a váš text zůstává v soukromí.",
			},
		]
		const clips: Clip[] = []
		for (const fixture of fixtures) {
			const { session, config } = await loadVoice(fixture.voice)
			if (!report.initializationMs) report.initializationMs = performance.now() - startedAt
			const before = performance.now()
			const phones = phonemize(fixture.text, config.espeak.voice)
			espeak.setVoice(config.espeak.voice)
			const transcription = espeak.phonemes(fixture.text)
			const events = espeak.synthesize(fixture.text).events
			const tokens = tokenizeEvents(fixture.text, events, config.phoneme_id_map)
			phonemizerEvidence.push({
				text: fixture.text,
				legacy: phones.phonemes.join(""),
				transcription,
				reconstructed: tokens.symbols.filter((s) => !["^", "$", "_"].includes(s)).join(""),
				events,
			})
			const ids = BigInt64Array.from(tokens.ids, BigInt)
			const feeds: Record<string, ort.Tensor> = {
				input: new ort.Tensor("int64", ids, [1, ids.length]),
				input_lengths: new ort.Tensor("int64", new BigInt64Array([BigInt(ids.length)]), [1]),
				scales: new ort.Tensor(
					"float32",
					new Float32Array([config.inference.noise_scale, config.inference.length_scale / fixture.speed, 0]),
					[3],
				),
			}
			const outputs = await session.run(feeds)
			const synthesisMs = performance.now() - before
			const pcm = Float32Array.from(outputs.output!.data as Float32Array)
			const durations = Array.from(outputs.durations!.data as Float32Array)
			if (durations.length !== ids.length || durations.some((value) => !Number.isFinite(value) || value < 0))
				throw new Error("Invalid predicted token durations")
			const frames = durations.reduce((sum, value) => sum + value, 0)
			if (Math.abs(frames * 256 - pcm.length) > 256) throw new Error("Token durations do not cover generated audio")
			const alignment = alignWords(tokens, durations, config.audio.sample_rate)
			durationEvidence.push({
				voice: fixture.voice,
				speed: fixture.speed,
				phonemes: phones.phonemes,
				ids: tokens.ids,
				timings: alignment.timings,
				durations,
				frames,
				samples: pcm.length,
			})
			let sum = 0,
				peak = 0
			for (const value of pcm) {
				if (!Number.isFinite(value)) throw new Error("Non-finite audio")
				sum += value * value
				peak = Math.max(peak, Math.abs(value))
			}
			const durationSeconds = pcm.length / config.audio.sample_rate
			if (!(durationSeconds > 0) || !(sum > 0)) throw new Error("Empty/silent speech")
			report.samples.push({
				...fixture,
				synthesisMs,
				durationSeconds,
				predictedDurationSeconds: (frames * 256) / config.audio.sample_rate,
				realTimeFactor: synthesisMs / 1000 / durationSeconds,
				peak,
				rms: Math.sqrt(sum / pcm.length),
			})
			clips.push({ samples: pcm, sampleRate: config.audio.sample_rate })
			if (!report.firstClipReadyMs) report.firstClipReadyMs = performance.now() - startedAt
		}
		report.speedDurationRatio = report.samples[1]!.durationSeconds / report.samples[2]!.durationSeconds
		for (const session of sessions) await session.release()
		self.postMessage(
			{
				ok: true,
				report: {
					...report,
					durationEvidence,
					phonemizerEvidence,
					startupEvidence,
					optimization: data.optimization ?? "basic",
				},
				clips,
			},
			clips.map((clip) => clip.samples.buffer),
		)
	} catch (error) {
		for (const session of sessions) await session.release().catch(() => {})
		self.postMessage({ ok: false, report, error: error instanceof Error ? error.message : String(error) })
	}
}
