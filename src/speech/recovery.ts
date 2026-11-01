import type { SpeechClip } from "./protocol.ts"

import { SpeechTextError } from "./errors.ts"

/** Bisect a source-specific failure at word boundaries; keep all usable audio in order. */
export async function synthesizeWithRecovery(
	text: string,
	synthesize: (text: string) => Promise<SpeechClip>,
): Promise<SpeechClip> {
	const parts: { clip: SpeechClip; offset: number }[] = []
	let skipped = false
	const visit = async (input: string, offset: number, depth: number): Promise<void> => {
		try {
			parts.push({ clip: await synthesize(input), offset })
		} catch (error) {
			if (!(error instanceof SpeechTextError)) throw error
			// At most 15 attempts per normal reading chunk; never retry indefinitely.
			const spaces = [...input.matchAll(/\s+/gu)].filter(
				(space) => space.index > 0 && space.index + space[0].length < input.length,
			)
			const middle = spaces.sort(
				(a, b) => Math.abs(a.index - input.length / 2) - Math.abs(b.index - input.length / 2),
			)[0]
			if (!middle || depth === 3) {
				skipped = true
				return
			}
			const right = middle.index + middle[0].length
			if (middle.index) await visit(input.slice(0, middle.index), offset, depth + 1)
			if (right < input.length) await visit(input.slice(right), offset + right, depth + 1)
		}
	}
	await visit(text, 0, 0)
	if (parts.length === 1 && !skipped) return parts[0]!.clip
	const sampleRate = parts[0]?.clip.sampleRate ?? 22050
	const pcm = new Float32Array(
		Math.max(
			1,
			parts.reduce((sum, part) => sum + part.clip.pcm.length, 0),
		),
	)
	const words: SpeechClip["words"] = []
	let samples = 0
	for (const { clip, offset } of parts) {
		if (clip.sampleRate !== sampleRate) throw new Error("Speech sample rate changed during recovery")
		pcm.set(clip.pcm, samples)
		for (const word of clip.words)
			words.push({
				start: word.start + offset,
				end: word.end + offset,
				from: word.from + samples / sampleRate,
				to: word.to + samples / sampleRate,
			})
		samples += clip.pcm.length
	}
	return { pcm, sampleRate, words, skippedText: skipped }
}
