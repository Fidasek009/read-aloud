import type { browser } from "wxt/browser"

import { localKeys } from "../src/extension/storage.ts"
import { type StoredVoice, voiceOperation, voiceStore } from "../src/speech/voice-store.ts"

/** Browser-only fixture access uses the production schema and transaction boundary. */
export const readStoredVoice = (id: string) =>
	voiceOperation<StoredVoice | undefined>("readonly", (store) => store.get(id))

export const writeStoredVoice = (voice: StoredVoice) =>
	voiceOperation("readwrite", (store) => store.put({ formatVersion: voiceStore.formatVersion, ...voice }))

export async function setStoredVoiceFormat(id: string, formatVersion: number | undefined) {
	const record = await readStoredVoice(id)
	if (!record) throw new Error("Voice fixture is missing")
	if (formatVersion === undefined) delete record.formatVersion
	else record.formatVersion = formatVersion
	await voiceOperation("readwrite", (store) => store.put(record))
}

export async function addOrphanVoice(id: string) {
	await writeStoredVoice({ id, sourceHash: "", model: new ArrayBuffer(0), installedAt: Date.now() })
	const api =
		(globalThis as typeof globalThis & { browser?: typeof browser; chrome?: typeof import("wxt/browser").browser })
			.browser ?? (globalThis as typeof globalThis & { chrome?: typeof import("wxt/browser").browser }).chrome
	if (!api) throw new Error("Extension API is unavailable")
	await api.storage.local.set({ [localKeys.voiceChange]: { id, deleted: false, revision: crypto.randomUUID() } })
}
