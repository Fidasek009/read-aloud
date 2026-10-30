import * as ort from "onnxruntime-web"

import type { Clip, ComputeMode, ProbeReport } from "./contracts.ts"

import { loadTextToSpeech, loadVoiceStyle } from "../vendor/helper.mjs"

const base = new URL("./", self.location.href)
const nativeFetch = globalThis.fetch.bind(globalThis)
const requests: string[] = []
const denied: string[] = []
globalThis.fetch = (input, options) => {
	const source = typeof input === "string" || input instanceof URL ? String(input) : input.url
	const url = new URL(source, base)
	if (url.origin !== base.origin) {
		denied.push(url.href)
		return Promise.reject(new Error("Remote fetch rejected by local-only lab"))
	}
	requests.push(url.pathname)
	return nativeFetch(url.href, options)
}
ort.env.wasm.wasmPaths = new URL("runtime/", base).href
ort.env.wasm.proxy = false
ort.env.wasm.numThreads = 1

let started = false
self.onmessage = async ({ data }: MessageEvent<{ provider: ComputeMode }>) => {
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
		steps: 5,
		requests,
		denied,
		samples: [],
		fallback: null,
		limitation: "Synthesis in an extension tab only; background audio lifecycle and word timing are not implemented.",
	}
	const sessions: ort.InferenceSession[] = []
	const release = async () => {
		for (const session of sessions.splice(0)) await session.release().catch(() => {})
	}
	try {
		const startedAt = performance.now()
		if (data.provider !== "cpu") {
			try {
				const adapter = await navigator.gpu?.requestAdapter()
				report.gpu.adapter = Boolean(adapter)
				if (adapter) report.selected = "webgpu"
				else report.fallback = "No usable WebGPU adapter"
			} catch (error) {
				report.fallback = `GPU adapter request failed: ${error instanceof Error ? error.message : String(error)}`
			}
			if (data.provider === "gpu" && report.selected !== "webgpu")
				throw new Error("GPU-only probe has no usable adapter")
		}
		// Loading is deliberately local-only. Provisioning is a separate explicit CLI
		// command, not a side effect of opening the extension or starting speech.
		const { textToSpeech: tts } = await loadTextToSpeech(new URL("models/onnx", base).href, {
			executionProviders: [report.selected],
		})
		sessions.push(tts.dpOrt, tts.textEncOrt, tts.vectorEstOrt, tts.vocoderOrt)
		const style = await loadVoiceStyle([new URL("models/voice_styles/F1.json", base).href])
		report.initializationMs = performance.now() - startedAt
		const clips: Clip[] = []
		const fixtures = [
			{
				lang: "en",
				speed: 1,
				text: "A good reading experience should feel effortless. Your words stay on your device.",
			},
			{ lang: "cs", speed: 1, text: "Dobrý den. Čtení běží přímo ve vašem počítači a váš text zůstává v soukromí." },
			{ lang: "cs", speed: 1.5, text: "Dobrý den. Čtení běží přímo ve vašem počítači a váš text zůstává v soukromí." },
		]
		for (const fixture of fixtures) {
			const before = performance.now()
			const audio = await tts.call(fixture.text, fixture.lang, style, report.steps, fixture.speed, 0)
			const synthesisMs = performance.now() - before
			const pcm = Float32Array.from(audio.wav)
			let sum = 0
			let peak = 0
			for (const value of pcm) {
				if (!Number.isFinite(value)) throw new Error("Non-finite audio sample")
				sum += value * value
				peak = Math.max(peak, Math.abs(value))
			}
			const durationSeconds = pcm.length / tts.sampleRate
			if (!(durationSeconds > 0) || !(sum > 0)) throw new Error("Empty or silent synthesis")
			report.samples.push({
				...fixture,
				synthesisMs,
				durationSeconds,
				predictedDurationSeconds: audio.duration[0]!,
				realTimeFactor: synthesisMs / 1000 / durationSeconds,
				peak,
				rms: Math.sqrt(sum / pcm.length),
			})
			clips.push({ samples: pcm, sampleRate: tts.sampleRate })
		}
		report.firstClipReadyMs = report.initializationMs + report.samples[0]!.synthesisMs
		report.speedDurationRatio = report.samples[1]!.durationSeconds / report.samples[2]!.durationSeconds
		await release()
		self.postMessage(
			{ ok: true, report, clips },
			clips.map((clip) => clip.samples.buffer),
		)
	} catch (error) {
		await release()
		self.postMessage({ ok: false, report, error: error instanceof Error ? error.message : String(error) })
	}
}
