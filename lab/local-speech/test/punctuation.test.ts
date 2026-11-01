import { createEspeak } from "@spelling-creator/spellophone/browser"
import { expect, test } from "bun:test"

import voice from "../../../src/speech/configs/en_US-ljspeech-medium.json"
import { tokenizeEvents } from "../../../src/speech/phonemes.ts"

test("domain dots remain spoken phonemes while sentence-ending periods remain pauses", async () => {
	const files = new URL("../../../node_modules/@spelling-creator/spellophone/", import.meta.url)
	const allowed = new Set(["/manifest.json", "/core.bin.gz", "/en_dict.gz"])
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const path = new URL(request.url).pathname
			return allowed.has(path)
				? new Response(Bun.file(new URL(`espeak-ng-data${path}`, files)))
				: new Response(null, { status: 404 })
		},
	})
	let phonemizer: Awaited<ReturnType<typeof createEspeak>> | undefined
	try {
		phonemizer = await createEspeak({
			dataUrl: server.url,
			wasmUrl: new URL("wasm/espeak-ng.wasm", files),
			phonemeEvents: "ipa",
		})
		await phonemizer.loadVoice(voice.espeak.voice)
		const tokenize = (text: string) => tokenizeEvents(text, phonemizer!.synthesize(text).events, voice.phoneme_id_map)
		const text = "Use consensus.app. The research continues."
		const domainDot = text.indexOf(".")
		const tokens = tokenize(text)
		const dot = tokenize("dot")
		const spokenDotIds = tokens.ids.filter((_, index) => {
			const word = tokens.words[index]
			return word?.start === domainDot && word.end === domainDot + 1
		})
		expect(spokenDotIds.length).toBeGreaterThan(0)
		expect(spokenDotIds).toEqual(dot.ids.filter((_, index) => dot.words[index] !== null))
		expect(
			tokens.words
				.filter((word) => word && text.slice(word.start, word.end) === ".")
				.every((word) => word!.start === domainDot),
		).toBe(true)

		const sentence = "The workflow. This thesis continues."
		expect(tokenize(sentence).words.some((word) => word && sentence.slice(word.start, word.end) === ".")).toBe(false)
		// Positive control: the missing PDF space really does turn the period into a spoken word.
		const merged = "The workflow.This thesis continues."
		expect(tokenize(merged).words.some((word) => word && merged.slice(word.start, word.end) === ".")).toBe(true)
		for (const sentence of [
			"22",
			"2026",
			"Adrián Rošinec iii",
			"This work was supported by e-INFRA CZ (ID:90254). iv",
			"The “reproducibility crisis” continues.",
			"Modern MD creates a “data deluge”.",
		]) {
			const result = tokenize(sentence)
			const written = [...sentence.matchAll(/[\p{L}\p{M}\p{N}]+(?:[-‐‑'’][\p{L}\p{M}\p{N}]+)*/gu)]
			expect(
				result.words.every(
					(word) => word === null || (word.start >= 0 && word.end <= sentence.length && word.end > word.start),
				),
			).toBe(true)
			for (const word of written)
				expect(
					result.words.some((span) => span?.start === word.index && span.end === word.index + word[0].length),
					`${sentence}: ${word[0]}`,
				).toBe(true)
		}
		const compound = "pre-exascale computing."
		const compoundTokens = tokenize(compound)
		expect(
			compoundTokens.words.filter(Boolean).every((word) => (word!.start === 0 ? word!.end === 12 : word!.start === 13)),
		).toBe(true)
		expect(compoundTokens.words.some((word) => word?.start === 0 && word.end === 12)).toBe(true)
	} finally {
		phonemizer?.dispose()
		server.stop(true)
	}
})
