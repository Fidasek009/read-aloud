import { getVoice, validateConfig } from "../src/speech/catalog.ts"
import { SpeechEngine } from "../src/speech/engine.ts"
import { instrumentModel } from "../src/speech/instrument.ts"

/** Use a pinned, explicitly provisioned test voice in an isolated browser profile. */
export async function checkSpeakers(base: string) {
	const voice = getVoice("en_GB-aru-medium")
	const bytes = await (await fetch(`${base}model`)).arrayBuffer()
	const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)).toHex()
	if (hash !== voice.sha256 || bytes.byteLength !== voice.bytes) throw new Error("Wrong speaker fixture")
	const configBytes = await (await fetch(`${base}config`)).arrayBuffer()
	if (new Uint8Array(await crypto.subtle.digest("SHA-256", configBytes)).toHex() !== voice.configHash)
		throw new Error("Wrong speaker configuration")
	const config = validateConfig(JSON.parse(new TextDecoder().decode(configBytes)))
	// Remove model noise so a changed waveform demonstrates speaker choice,
	// rather than ordinary stochastic variation between two runs.
	config.inference.noise_scale = 0
	config.inference.noise_w = 0
	const model = instrumentModel(bytes).buffer
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		const open = indexedDB.open("read-aloud-voices", 1)
		open.onupgradeneeded = () => open.result.createObjectStore("voices", { keyPath: "id" })
		open.onsuccess = () => resolve(open.result)
		open.onerror = () => reject(open.error)
	})
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction("voices", "readwrite")
		tx.objectStore("voices").put({
			id: voice.id,
			sourceHash: hash,
			config,
			model,
			installedAt: Date.now(),
			formatVersion: 1,
		})
		tx.oncomplete = () => resolve()
		tx.onabort = tx.onerror = () => reject(tx.error)
	})
	db.close()
	const engine = new SpeechEngine()
	try {
		await engine.load(voice.id)
		const first = await engine.synthesize("A short sentence for a speaker test.", 1)
		engine.clearClips()
		const repeated = await engine.synthesize("A short sentence for a speaker test.", 1)
		if (
			first.pcm.length !== repeated.pcm.length ||
			first.pcm.some((sample, i) => Math.abs(sample - repeated.pcm[i]!) > 0.0001)
		)
			throw new Error("Speaker fixture is not reproducible with noise disabled")
		const started = performance.now()
		await engine.load(`${voice.id}#1`)
		const switchMs = performance.now() - started
		if (engine.diagnostics.reusedSession !== true) throw new Error("Speaker switch reloaded the model")
		const second = await engine.synthesize("A short sentence for a speaker test.", 1)
		if (!first.pcm.length || !second.pcm.length || !first.words.length || !second.words.length)
			throw new Error("Speaker fixture did not generate aligned speech")
		if (first.pcm.length === second.pcm.length && first.pcm.every((sample, i) => sample === second.pcm[i]))
			throw new Error("Both speaker choices produced identical audio")
		return { switchMs, firstSamples: first.pcm.length, secondSamples: second.pcm.length, reusedSession: true }
	} finally {
		engine.dispose()
	}
}
