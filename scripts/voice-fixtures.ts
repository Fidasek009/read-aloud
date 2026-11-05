import { type StoredVoice, voiceOperation } from "../src/speech/voice-store.ts"

/** Browser-only fixture access uses the production schema and transaction boundary. */
export const readStoredVoice = (id: string) =>
	voiceOperation<StoredVoice | undefined>("readonly", (store) => store.get(id))

export const writeStoredVoice = (voice: StoredVoice) => voiceOperation("readwrite", (store) => store.put(voice))
