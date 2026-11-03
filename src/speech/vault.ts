import { browser } from "wxt/browser"

import { getVoice, validateConfig, type VoiceConfig } from "./catalog.ts"
import legacyCzech from "./configs/cs_CZ-jirka-medium.json"
import legacyEnglish from "./configs/en_US-ljspeech-medium.json"
import { cancelVoiceDownloads, voiceDownloadCancellation } from "./download-cancellation.ts"
import { downloadBytes } from "./download.ts"
import { SpeechVoiceError } from "./errors.ts"
import { instrumentInWorker } from "./instrument-client.ts"
import { isVoiceChange } from "./protocol.ts"

interface StoredVoice {
	id: string
	sourceHash: string
	model: ArrayBuffer
	installedAt: number
	formatVersion?: number
	config?: VoiceConfig
}

const voiceFormatVersion = 1

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
	if (!stored || stored.sourceHash !== getVoice(id).sha256)
		throw new SpeechVoiceError("Stored voice is missing or outdated")
	// Existing prototype downloads used this same format before it had a version field.
	if ((stored.formatVersion ?? 1) !== voiceFormatVersion)
		throw new SpeechVoiceError("Stored voice format is incompatible")
	const config =
		stored.config ??
		(id === "en_US-ljspeech-medium" ? legacyEnglish : id === "cs_CZ-jirka-medium" ? legacyCzech : undefined)
	try {
		return { model: stored.model, config: validateConfig(config) }
	} catch {
		throw new SpeechVoiceError("Stored voice configuration is invalid")
	}
}

export function onVoicesChanged(callback: (id: string, deleted: boolean) => void): () => void {
	const listener: Parameters<typeof browser.storage.onChanged.addListener>[0] = (changes, area) => {
		const change: unknown = changes.voiceChange?.newValue
		if (area === "local" && isVoiceChange(change)) callback(change.id, change.deleted)
	}
	browser.storage.onChanged.addListener(listener)
	return () => browser.storage.onChanged.removeListener(listener)
}

export async function deleteVoice(id: string, committed: () => Promise<void>): Promise<void> {
	// Stored voices can outlive their catalog entries. Deletion must still work
	// for those records, using the same lock and notifications as known voices.
	// A deletion request cancels concurrent downloads, but is not a committed
	// change and must not invalidate a model still used by a reader.
	cancelVoiceDownloads(id)
	await navigator.locks.request(`voice:${id}`, async () => {
		await operation("readwrite", (store) => store.delete(id))
		await committed()
	})
}

/** Only a deliberate Download action may call this function. Nothing invokes it on startup. */
export async function downloadVoice(
	id: string,
	signal: AbortSignal,
	progress: (fraction: number) => void,
	committed: () => Promise<void>,
): Promise<void> {
	const voice = getVoice(id)
	if (voice.unsupported) throw new Error(voice.unsupported)
	const cancellation = voiceDownloadCancellation(id, signal)
	const abort = cancellation.signal
	try {
		// Request persistent origin storage only as part of a deliberate download.
		// Some browsers may decline or not expose this API; quota failures still
		// surface through the download action.
		if (navigator.storage?.persist) await navigator.storage.persist().catch(() => false)
		abort.throwIfAborted()
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
			const model = await instrumentInWorker(
				bytes.buffer,
				abort,
				() => new Worker(new URL("runtime/instrument.js", browser.runtime.getURL("/")), { type: "module" }),
			)
			abort.throwIfAborted()
			await operation("readwrite", (store) =>
				store.put({
					id,
					sourceHash: digest,
					model,
					config,
					installedAt: Date.now(),
					formatVersion: voiceFormatVersion,
				} satisfies StoredVoice),
			)
			await committed()
		})
	} finally {
		cancellation.close()
	}
}
