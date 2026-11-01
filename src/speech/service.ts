import { type SpeechClip, speechRequest, type SpeechResponse } from "./protocol.ts"
import { synthesizeWithRecovery } from "./recovery.ts"
import { onVoicesChanged } from "./vault.ts"

interface SpeechBackend {
	diagnostics: Record<string, unknown>
	load(voice: string): Promise<void>
	synthesize(text: string, speed: number): Promise<SpeechClip>
	cancelQueued(): void
	clearClips(): void
	dispose(): void
}

/** One model session per browser; audio and page ownership stay in the reading tab. */
export class SpeechService {
	private owner = ""
	private generation = 0
	private requestedVoice = ""
	private idle: ReturnType<typeof setTimeout> | undefined
	private unsubscribe: () => void
	constructor(private engine: SpeechBackend) {
		this.unsubscribe = onVoicesChanged((id, deleted) => {
			if (deleted) this.voiceDeleted(id)
		})
	}
	voiceDeleted(id: string) {
		if (this.requestedVoice.split("#")[0] === id) {
			this.generation++
			this.engine.dispose()
		}
	}
	async request(client: string, value: unknown): Promise<SpeechResponse> {
		if (!speechRequest(value)) throw new Error("Invalid speech request")
		clearTimeout(this.idle)
		try {
			if (value.type === "load") {
				this.requestedVoice = value.voice
				if (client !== this.owner) {
					this.engine.clearClips()
					this.generation++
					this.owner = client
				}
				await this.engine.load(value.voice)
				if (client !== this.owner) throw new DOMException("Reading stopped", "AbortError")
				return { id: value.id, ok: true, diagnostics: this.engine.diagnostics }
			}
			if (client !== this.owner) throw new DOMException("Reading stopped", "AbortError")
			if (value.type === "cancel") {
				this.generation++
				this.engine.cancelQueued()
				return { id: value.id, ok: true }
			}
			const generation = this.generation
			const clip = await synthesizeWithRecovery(value.text, (text) => {
				if (client !== this.owner || generation !== this.generation)
					throw new DOMException("Reading stopped", "AbortError")
				return this.engine.synthesize(text, value.speed)
			})
			if (client !== this.owner || generation !== this.generation)
				throw new DOMException("Reading stopped", "AbortError")
			return {
				id: value.id,
				ok: true,
				diagnostics: this.engine.diagnostics,
				clip: {
					pcm: new Uint8Array(clip.pcm.buffer, clip.pcm.byteOffset, clip.pcm.byteLength).toBase64(),
					sampleRate: clip.sampleRate,
					words: clip.words,
					skippedText: clip.skippedText === true,
				},
			}
		} catch (error) {
			return { id: value.id, ok: false, error: error instanceof Error ? error.message : "Speech could not continue" }
		}
	}
	release(client: string) {
		if (client !== this.owner) return
		this.owner = ""
		this.generation++
		this.engine.clearClips()
		// Retain only model/runtime state briefly. Never retain source text after closing.
		this.idle = setTimeout(() => this.engine.dispose(), 120_000)
	}
	releaseCurrent() {
		this.release(this.owner)
	}
	dispose() {
		clearTimeout(this.idle)
		this.unsubscribe()
		this.owner = ""
		this.requestedVoice = ""
		this.engine.dispose()
	}
}
