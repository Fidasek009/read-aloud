import { speechFailureCode } from "./errors.ts"
import { type SpeechClip, speechRequest, type SpeechResponse, voiceModelId } from "./protocol.ts"
import { synthesizeWithRecovery } from "./recovery.ts"

interface SpeechBackend {
	diagnostics: SpeechDiagnostics
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
	constructor(
		private engine: SpeechBackend,
		private encoding: "base64" | "structured" = "base64",
	) {}
	voiceDeleted(id: string) {
		if (voiceModelId(this.requestedVoice) === id) {
			this.generation++
			this.engine.dispose()
		}
	}
	async request(client: string, value: unknown): Promise<SpeechResponse> {
		if (!speechRequest(value)) throw new Error("Invalid speech request")
		clearTimeout(this.idle)
		try {
			if (value.type === "load") {
				if (client === this.owner && this.requestedVoice && this.requestedVoice !== value.voice) {
					this.generation++
					this.engine.cancelQueued()
				}
				this.requestedVoice = value.voice
				if (client !== this.owner) {
					this.engine.clearClips()
					this.generation++
					this.owner = client
				}
				await this.engine.load(value.voice)
				if (client !== this.owner) throw new DOMException("Reading stopped", "AbortError")
				return { id: value.id, ok: true, diagnostics: speechDiagnostics(this.engine.diagnostics) }
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
				diagnostics: speechDiagnostics(this.engine.diagnostics),
				clip: {
					pcm:
						this.encoding === "structured"
							? clip.pcm
							: new Uint8Array(clip.pcm.buffer, clip.pcm.byteOffset, clip.pcm.byteLength).toBase64(),
					sampleRate: clip.sampleRate,
					words: clip.words,
					skippedText: clip.skippedText === true,
				},
			}
		} catch (error) {
			return { id: value.id, ok: false, code: speechFailureCode(error) }
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
	dispose() {
		clearTimeout(this.idle)
		this.owner = ""
		this.requestedVoice = ""
		this.engine.dispose()
	}
}
import type { SpeechDiagnostics } from "./diagnostics.ts"

import { speechDiagnostics } from "./diagnostics.ts"
