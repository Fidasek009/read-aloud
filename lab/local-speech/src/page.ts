import type { ComputeMode, ProbeResult, WorkerResult } from "./contracts.ts"

import { encodeWav } from "./wav.ts"

declare global {
	interface Window {
		runLab(options?: { provider?: ComputeMode; optimization?: "disabled" | "basic" | "all" }): Promise<ProbeResult>
	}
}
const status = document.querySelector<HTMLPreElement>("#status")!
const button = document.querySelector<HTMLButtonElement>("#run")!
const audio = document.querySelector<HTMLAudioElement>("audio")!
let active: Promise<ProbeResult> | undefined
window.runLab = (options = {}) => {
	if (active) return active
	button.disabled = true
	status.textContent = "Generating locally…"
	const worker = new Worker(new URL("worker.js", location.href), { type: "module" })
	active = new Promise<ProbeResult>((resolve) => {
		const timeout = setTimeout(() => finish({ ok: false, error: "Probe timed out after 180 seconds" }), 180_000)
		const finish = (result: ProbeResult) => {
			clearTimeout(timeout)
			worker.terminate()
			status.textContent = JSON.stringify(result.report ?? result, null, 2)
			resolve(result)
		}
		worker.onerror = (event) => finish({ ok: false, error: event.message })
		worker.onmessage = ({ data }: MessageEvent<WorkerResult>) => {
			const waves = (data.clips ?? []).map((clip) => {
				const wav = encodeWav(clip.samples, clip.sampleRate)
				let binary = ""
				for (let index = 0; index < wav.length; index += 8192)
					binary += String.fromCharCode(...wav.subarray(index, index + 8192))
				return btoa(binary)
			})
			if (waves.length) {
				const clip = data.clips![0]!
				audio.src = URL.createObjectURL(new Blob([encodeWav(clip.samples, clip.sampleRate)], { type: "audio/wav" }))
				audio.hidden = false
			}
			finish({ ok: data.ok, error: data.error, report: data.report, waves })
		}
		worker.postMessage({ ...options, provider: options.provider ?? "auto" })
	})
	return active
}
button.addEventListener("click", () => window.runLab())
