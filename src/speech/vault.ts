import { getVoice, validateConfig, type VoiceConfig } from "./catalog.ts"
import legacyCzech from "./configs/cs_CZ-jirka-medium.json"
import legacyEnglish from "./configs/en_US-ljspeech-medium.json"
import { downloadBytes } from "./download.ts"
import { instrumentModel } from "./instrument.ts"

interface StoredVoice {
	id: string
	sourceHash: string
	model: ArrayBuffer
	installedAt: number
	config?: VoiceConfig
}

const channel = new BroadcastChannel("read-aloud-voices")
let database: Promise<IDBDatabase> | undefined
const opening = () =>
	(database ??= new Promise((resolve, reject) => {
		const request = indexedDB.open("read-aloud-voices", 1)
		request.onupgradeneeded = () => request.result.createObjectStore("voices", { keyPath: "id" })
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(request.error)
	}))

async function operation<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
	const db = await opening()
	return new Promise((resolve, reject) => {
		const tx = db.transaction("voices", mode)
		const request = run(tx.objectStore("voices"))
		tx.oncomplete = () => resolve(request.result)
		tx.onabort = tx.onerror = () => reject(tx.error ?? new Error("Voice storage failed"))
	})
}

export async function installedVoices(): Promise<string[]> {
	return (await operation("readonly", (store) => store.getAllKeys())).map(String)
}

export async function readVoice(id: string): Promise<{ model: ArrayBuffer; config: VoiceConfig }> {
	const stored = await operation<StoredVoice | undefined>("readonly", (store) => store.get(id))
	if (!stored || stored.sourceHash !== getVoice(id).sha256) throw new Error("Download this voice before reading")
	const config =
		stored.config ??
		(id === "en_US-ljspeech-medium" ? legacyEnglish : id === "cs_CZ-jirka-medium" ? legacyCzech : undefined)
	return { model: stored.model, config: validateConfig(config) }
}

export function onVoicesChanged(callback: (id: string, deleted: boolean) => void): () => void {
	const listener = (event: MessageEvent<unknown>) => {
		const value = event.data
		if (
			value &&
			typeof value === "object" &&
			"id" in value &&
			typeof value.id === "string" &&
			"deleted" in value &&
			typeof value.deleted === "boolean"
		)
			callback(value.id, value.deleted)
	}
	channel.addEventListener("message", listener)
	return () => channel.removeEventListener("message", listener)
}

export async function deleteVoice(id: string): Promise<void> {
	getVoice(id)
	channel.postMessage({ id, deleted: true })
	await navigator.locks.request(`voice:${id}`, async () => {
		await operation("readwrite", (store) => store.delete(id))
	})
	channel.postMessage({ id, deleted: true })
}

/** Only a deliberate Download action may call this function. Nothing invokes it on startup. */
export async function downloadVoice(
	id: string,
	signal: AbortSignal,
	progress: (fraction: number) => void,
): Promise<void> {
	const voice = getVoice(id)
	if (voice.unsupported) throw new Error(voice.unsupported)
	const controller = new AbortController()
	const stop = onVoicesChanged((changed, deleted) => {
		if (changed === id && deleted)
			controller.abort(new DOMException("Download cancelled because this voice was deleted.", "AbortError"))
	})
	const abort = AbortSignal.any([signal, controller.signal])
	try {
		await navigator.locks.request(`voice:${id}`, { signal: abort }, async () => {
			const configBytes = await downloadBytes(voice.configUrl, {
				signal: abort,
				maxBytes: 1_000_000,
			})
			if (new Uint8Array(await crypto.subtle.digest("SHA-256", configBytes)).toHex() !== voice.configHash)
				throw new Error("Voice configuration integrity check failed")
			const config = validateConfig(JSON.parse(new TextDecoder().decode(configBytes)))
			const bytes = await downloadBytes(voice.url, {
				signal: abort,
				bytes: voice.bytes,
				maxBytes: voice.bytes,
				onProgress: (received) => progress(received / voice.bytes),
			})
			const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)).toHex()
			if (digest !== voice.sha256) throw new Error("Voice integrity check failed. Please try again.")
			abort.throwIfAborted()
			const model = instrumentModel(bytes.buffer)
			abort.throwIfAborted()
			await operation("readwrite", (store) =>
				store.put({
					id,
					sourceHash: digest,
					model: model.buffer,
					config,
					installedAt: Date.now(),
				} satisfies StoredVoice),
			)
			channel.postMessage({ id, deleted: false })
		})
	} finally {
		stop()
	}
}
