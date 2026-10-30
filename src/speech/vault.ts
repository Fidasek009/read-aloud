import { getVoice } from "./catalog.ts"
import { instrumentModel } from "./instrument.ts"

interface StoredVoice {
	id: string
	sourceHash: string
	model: ArrayBuffer
	installedAt: number
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

export async function readModel(id: string): Promise<ArrayBuffer> {
	const stored = await operation<StoredVoice | undefined>("readonly", (store) => store.get(id))
	if (!stored || stored.sourceHash !== getVoice(id).sha256) throw new Error("Download this voice before reading")
	return stored.model
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
	const controller = new AbortController()
	const stop = onVoicesChanged((changed, deleted) => {
		if (changed === id && deleted) controller.abort()
	})
	const abort = AbortSignal.any([signal, controller.signal, AbortSignal.timeout(300_000)])
	try {
		await navigator.locks.request(`voice:${id}`, { signal: abort }, async () => {
			const response = await fetch(voice.url, { signal: abort, credentials: "omit", referrerPolicy: "no-referrer" })
			if (!response.ok || !response.body) throw new Error("Voice download failed. Please try again.")
			const reader = response.body.getReader()
			const bytes = new Uint8Array(voice.bytes)
			let offset = 0
			try {
				for (;;) {
					const { done, value } = await reader.read()
					if (done) break
					if (offset + value.length > bytes.length) throw new Error("Voice download has an unexpected size")
					bytes.set(value, offset)
					offset += value.length
					progress(offset / bytes.length)
				}
			} finally {
				await reader.cancel().catch(() => {})
			}
			if (offset !== voice.bytes) throw new Error("Voice download was interrupted")
			const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)).toHex()
			if (digest !== voice.sha256) throw new Error("Voice integrity check failed. Please try again.")
			abort.throwIfAborted()
			const model = instrumentModel(bytes.buffer)
			abort.throwIfAborted()
			await operation("readwrite", (store) =>
				store.put({ id, sourceHash: digest, model: model.buffer, installedAt: Date.now() } satisfies StoredVoice),
			)
			channel.postMessage({ id, deleted: false })
		})
	} finally {
		stop()
	}
}
