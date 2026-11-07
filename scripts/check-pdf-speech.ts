import { browser } from "wxt/browser"

import type {} from "../src/reading/bridge.ts"
import type { SpeechClip } from "../src/speech/protocol.ts"
import type { WorkerCommand } from "../src/speech/worker-protocol.ts"

import { readingChunks } from "../src/reading/chunks.ts"
import { getVoice } from "../src/speech/catalog.ts"
import { instrumentModel } from "../src/speech/instrument.ts"
import { writeStoredVoice } from "./voice-fixtures.ts"

interface WorkerReply extends SpeechClip {
	id: number
	ok: boolean
	error?: string
}

/** Install the verified fixture in the same extension-owned store as a normal download. */
export async function provisionVoice(base: string) {
	const bytes = await (await fetch(base + "model")).arrayBuffer()
	const voice = getVoice("en_US-ljspeech-medium")
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)).toHex()
	if (digest !== voice.sha256) throw Error("Wrong model fixture")
	const config = await (await fetch(base + "config")).json()
	const model = instrumentModel(bytes).buffer
	await writeStoredVoice({ id: voice.id, sourceHash: digest, config, model })
	await browser.storage.local.set({ voice: voice.id })
}

export async function checkSpeech(text: string, base: string) {
	const worker = new Worker(new URL("runtime/cpu/speech.js", location.href), { type: "module" })
	let id = 0
	const request = (value: WorkerCommand, transfer: Transferable[] = []) =>
		new Promise<WorkerReply>((resolve, reject) => {
			const requestId = ++id
			const timeout = setTimeout(() => reject(Error("Test worker timed out")), 90000)
			worker.onerror = (event) => {
				clearTimeout(timeout)
				reject(Error(event.message))
			}
			worker.onmessage = (event: MessageEvent<WorkerReply>) => {
				if (event.data.id !== requestId) return
				clearTimeout(timeout)
				event.data.ok ? resolve(event.data) : reject(Error(event.data.error))
			}
			worker.postMessage({ ...value, id: requestId }, transfer)
		})
	try {
		const bytes = await (await fetch(base + "model")).arrayBuffer()
		if (
			new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)).toHex() !== getVoice("en_US-ljspeech-medium").sha256
		)
			throw Error("Wrong model fixture")
		const config = await (await fetch(base + "config")).json()
		const model = instrumentModel(bytes).buffer
		await request({ type: "load", voice: "en_US-ljspeech-medium", model, config }, [model])
		let samples = 0,
			words = 0,
			chunks = 0
		for (const part of readingChunks(text)) {
			const input = text.slice(part.start, part.end)
			const result = await request({ type: "synthesize", text: input, speed: 1 })
			if (!result.pcm.some((sample) => Math.abs(sample) > 0.001) || !result.words.length)
				throw Error("Empty or silent speech")
			if (result.words.some((word) => word.start < 0 || word.end > input.length || word.end <= word.start))
				throw Error("Invalid source mapping")
			samples += result.pcm.length
			words += result.words.length
			chunks++
		}
		const compound = await request({ type: "synthesize", text: "pre-exascale computing.", speed: 1 })
		const aligned = compound.words.find((word) => word.start === 0)
		if (!aligned || aligned.end !== 12) throw Error("Neural compound highlight did not cover the full word")
		return {
			characters: text.length,
			chunks,
			words,
			samples,
			audioSeconds: samples / config.audio.sample_rate,
			compoundAligned: true,
			backend: "CPU",
			model: "en_US-ljspeech-medium",
		}
	} finally {
		worker.terminate()
	}
}

/** Select the actual cross-page range before invoking the bundled production CPU worker. */
async function checkPdfSpeechInBrowser(base: string) {
	const frame = document.querySelector<HTMLIFrameElement>("iframe")
	if (!frame) throw Error("PDF player is missing")
	const session = new URL(frame.src).hash.slice(1)
	const host = window.readAloudHost
	if (!host) throw Error("PDF reading host is unavailable")
	const documentResponse = await host({ session, command: "document" })
	if (!("text" in documentResponse) || typeof documentResponse.text !== "string")
		throw Error("PDF document text is unavailable")
	const full = documentResponse.text
	const start = full.indexOf("This work was supported", full.indexOf("Acknowledgements"))
	const end = full.slice(0, full.indexOf("This thesis", start)).trimEnd().length
	if (start < 0 || end <= start) throw Error("Cross-page speech fixture missing")
	await host({ session, command: "highlight", start, end })
	const range = CSS.highlights?.get("read-aloud-current-word")?.values().next().value
	if (!(range instanceof Range)) throw Error("Cross-page range could not be highlighted")
	const selection = getSelection()
	selection?.removeAllRanges()
	selection?.addRange(range)
	await host({ session, command: "selection" })
	const selectedResponse = await host({ session, command: "document" })
	if (!("text" in selectedResponse) || typeof selectedResponse.text !== "string")
		throw Error("PDF selection text is unavailable")
	const selected = selectedResponse.text
	frame.contentDocument?.querySelector<HTMLButtonElement>("#close")?.click()
	const extension = (globalThis as unknown as { chrome: typeof browser }).chrome
	const scriptUrl = new URL("check-pdf-speech.js", extension.runtime.getURL("/")).href
	const module = (await import(/* @vite-ignore */ scriptUrl)) as {
		checkSpeech: (text: string, base: string) => Promise<unknown>
	}
	return module.checkSpeech(selected, base)
}

export const pdfSpeechCheck = (base: string) => `(${checkPdfSpeechInBrowser.toString()})(${JSON.stringify(base)})`
