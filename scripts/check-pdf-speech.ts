import { browser } from "wxt/browser"

import type { SpeechClip } from "../src/speech/protocol.ts"
import type { WorkerCommand } from "../src/speech/worker-protocol.ts"

import { readingChunks } from "../src/reading/document.ts"
import { getVoice } from "../src/speech/catalog.ts"
import { instrumentModel } from "../src/speech/instrument.ts"

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
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open("read-aloud-voices", 1)
		request.onupgradeneeded = () => request.result.createObjectStore("voices", { keyPath: "id" })
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error)
	})
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction("voices", "readwrite")
		tx.objectStore("voices").put({ id: voice.id, sourceHash: digest, config, model, installedAt: Date.now() })
		tx.oncomplete = () => resolve()
		tx.onabort = tx.onerror = () => reject(tx.error)
	})
	db.close()
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
		await request({ type: "load", voice: "en_US-ljspeech-medium", speaker: 0, model, config }, [model])
		let samples = 0,
			words = 0,
			chunks = 0
		for (const part of readingChunks(text)) {
			const input = text.slice(part.start, part.end)
			const result = await request({ type: "synthesize", text: input, speed: 1, speaker: 0 })
			if (!result.pcm.some((sample) => Math.abs(sample) > 0.001) || !result.words.length)
				throw Error("Empty or silent speech")
			if (result.words.some((word) => word.start < 0 || word.end > input.length || word.end <= word.start))
				throw Error("Invalid source mapping")
			samples += result.pcm.length
			words += result.words.length
			chunks++
		}
		const compound = await request({ type: "synthesize", text: "pre-exascale computing.", speed: 1, speaker: 0 })
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

/** Exercise compatibility against the actual extension IndexedDB store. */
export async function checkVoiceFormat() {
	const id = "en_US-ljspeech-medium"
	// The harness imports this file in Bun too; load the browser-only vault
	// lazily so its BroadcastChannel does not keep the harness process alive.
	const { readVoice } = await import("../src/speech/vault.ts")
	// provisionVoice deliberately installs an unversioned prototype record.
	await readVoice(id)
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		const open = indexedDB.open("read-aloud-voices", 1)
		open.onsuccess = () => resolve(open.result)
		open.onerror = () => reject(open.error)
	})
	const setVersion = (version: number | undefined) =>
		new Promise<void>((resolve, reject) => {
			const tx = db.transaction("voices", "readwrite")
			const store = tx.objectStore("voices")
			const get = store.get(id)
			get.onsuccess = () => {
				const voice = get.result
				if (version === undefined) delete voice.formatVersion
				else voice.formatVersion = version
				store.put(voice)
			}
			tx.oncomplete = () => resolve()
			tx.onabort = tx.onerror = () => reject(tx.error)
		})
	try {
		await setVersion(999)
		let rejected = false
		try {
			await readVoice(id)
		} catch (error) {
			rejected = error instanceof Error && error.name === "SpeechVoiceError"
		}
		if (!rejected) throw Error("An incompatible stored voice was accepted")
	} finally {
		await setVersion(undefined)
		db.close()
	}
}

/** Select the actual cross-page range before invoking the bundled production CPU worker. */
export const pdfSpeechCheck = (base: string) => `(async()=>{
 const frame=document.querySelector('iframe'),session=new URL(frame.src).hash.slice(1);
 const full=(await window.readAloudHost({session,command:'document'})).text;
 const start=full.indexOf('This work was supported',full.indexOf('Acknowledgements'));
 const end=full.slice(0,full.indexOf('This thesis',start)).trimEnd().length;
 if(start<0||end<=start)throw Error('Cross-page speech fixture missing');
 await window.readAloudHost({session,command:'highlight',start,end});
 const range=[...CSS.highlights.get('read-aloud-current-word')][0].cloneRange();
 getSelection().removeAllRanges();getSelection().addRange(range);
 await window.readAloudHost({session,command:'selection'});
 const selected=(await window.readAloudHost({session,command:'document'})).text;
 frame.contentDocument.querySelector('#close').click();
 const {checkSpeech}=await import(chrome.runtime.getURL('check-pdf-speech.js'));
 return checkSpeech(selected,${JSON.stringify(base)});
})()`
