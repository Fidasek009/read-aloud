import { type SpeechClip, speechRequest, type SpeechResponse } from "./protocol.ts"
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
	private idle: ReturnType<typeof setTimeout> | undefined
	private unsubscribe: () => void
	constructor(private engine: SpeechBackend) {
		this.unsubscribe = onVoicesChanged((id, deleted) => {
			if (deleted && this.engine.diagnostics.voice?.toString().split("#")[0] === id) this.engine.dispose()
		})
	}
	async request(client: string, value: unknown): Promise<SpeechResponse> {
		if (!speechRequest(value)) throw new Error("Invalid speech request")
		clearTimeout(this.idle)
		try {
			if (value.type === "load") {
				if (client !== this.owner) {
					this.engine.clearClips()
					this.owner = client
				}
				await this.engine.load(value.voice)
				if (client !== this.owner) throw new DOMException("Reading stopped", "AbortError")
				return { id: value.id, ok: true, diagnostics: this.engine.diagnostics }
			}
			if (client !== this.owner) throw new DOMException("Reading stopped", "AbortError")
			if (value.type === "cancel") {
				this.engine.cancelQueued()
				return { id: value.id, ok: true }
			}
			const clip = await this.engine.synthesize(value.text, value.speed)
			if (client !== this.owner) throw new DOMException("Reading stopped", "AbortError")
			return {
				id: value.id,
				ok: true,
				diagnostics: this.engine.diagnostics,
				clip: {
					pcm: new Uint8Array(clip.pcm.buffer, clip.pcm.byteOffset, clip.pcm.byteLength).toBase64(),
					sampleRate: clip.sampleRate,
					words: clip.words,
				},
			}
		} catch (error) {
			return { id: value.id, ok: false, error: error instanceof Error ? error.message : "Speech could not continue" }
		}
	}
	release(client: string) {
		if (client !== this.owner) return
		this.owner = ""
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
		this.engine.dispose()
	}
}
