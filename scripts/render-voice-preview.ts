import { browser } from "wxt/browser"

import { speechWav } from "../src/playback/wav.ts"
import { getVoice } from "../src/speech/catalog.ts"
import { SpeechEngine } from "../src/speech/engine.ts"
import { instrumentModel } from "../src/speech/instrument.ts"
import { validateConfig } from "../src/speech/voice-config.ts"

/** Maintainer-only rendering in an isolated extension, using the real CPU worker. */
export async function renderVoicePreview(base: string, id: string, text: string) {
	const voice = getVoice(id)
	async function verified(path: string, hash: string) {
		const response = await fetch(`${base}${path}`)
		if (!response.ok) throw new Error("Preview fixture unavailable")
		const bytes = await response.arrayBuffer()
		if (new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)).toHex() !== hash)
			throw new Error("Preview source integrity mismatch")
		return bytes
	}
	const model = instrumentModel(await verified("model", voice.sha256)).buffer
	const config = validateConfig(JSON.parse(new TextDecoder().decode(await verified("config", voice.configHash))))
	const engine = new SpeechEngine({
		readVoice: async () => ({ model, config }),
		createWorker: () => new Worker(browser.runtime.getURL("/runtime/cpu/speech.js"), { type: "module" }),
		gpuAvailable: async () => false,
		disableGpu() {},
	})
	try {
		await engine.load(id)
		const clip = await engine.synthesize(text, 1)
		const recording = speechWav(clip.pcm, clip.sampleRate)
		return {
			audio: new Uint8Array(await recording.arrayBuffer()).toBase64(),
			sampleRate: clip.sampleRate,
			durationSeconds: clip.pcm.length / clip.sampleRate,
			peak: clip.pcm.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0),
		}
	} finally {
		engine.dispose()
	}
}
