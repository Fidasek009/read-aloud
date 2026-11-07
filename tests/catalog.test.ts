import { expect, test } from "bun:test"

import { catalogVoices, getVoice, languageLabel, qualityLabel, qualityRank, voices } from "../src/speech/catalog.ts"
import { tokenizeText } from "../src/speech/phonemes.ts"
import { validateConfig } from "../src/speech/voice-config.ts"

test("catalog assets are pinned and every entry resolves", () => {
	expect(new Set(voices.map((voice) => voice.id)).size).toBe(voices.length)
	expect(voices.length).toBeGreaterThan(0)
	expect(voices.every((voice) => voice.unsupported === null)).toBe(true)
	expect(voices.every((voice) => /^[a-f0-9]{64}$/.test(voice.sha256) && /^[a-f0-9]{64}$/.test(voice.configHash))).toBe(
		true,
	)
	expect(
		voices.every(
			(voice) =>
				!voice.url.includes("/main/") && voice.bytes > 0 && Intl.getCanonicalLocales(voice.locale).length === 1,
		),
	).toBe(true)
	expect(getVoice("he_IL-saspeech-medium").unsupported).toContain("hebrew")
	expect(() => getVoice("missing-voice")).toThrow("not available")
	expect(() => validateConfig({ audio: { sample_rate: 1 } })).toThrow("configuration")
})

test("unsupported catalog entries remain addressable for deletion but are not offered", () => {
	for (const voice of catalogVoices) {
		if (voice.unsupported) {
			expect(voices).not.toContain(voice)
			expect(getVoice(voice.id)).toBe(voice)
			expect(languageLabel(voice)).toBeTruthy()
		} else expect(voices).toContain(voice)
	}
})

test("grapheme voice tokens keep original word spans and reject unreadable characters", () => {
	const map = { "^": [1], _: [0], $: [2], " ": [3], а: [4], б: [5], ".": [6] }
	const tokens = tokenizeText("А б.", map, "uk")
	expect(tokens.symbols).toEqual(["^", "_", "а", "_", " ", "_", "б", "_", ".", "_", "$"])
	expect(tokens.words[2]).toEqual({ start: 0, end: 1 })
	expect(tokens.words[6]).toEqual({ start: 2, end: 3 })
	expect(() => tokenizeText("123", map, "uk")).toThrow("cannot read")
})

test("language labels omit redundant regions and keep catalog dialects distinct", () => {
	expect(languageLabel(getVoice("cs_CZ-jirka-medium"))).toBe("Czech")
	expect(languageLabel(getVoice("en_US-ljspeech-medium"))).toBe("English (United States)")
	expect(languageLabel(getVoice("en_GB-alan-medium"))).toBe("English (Great Britain)")
})

test("quality labels and order stay consistent", () => {
	expect(qualityLabel("x_low")).toBe("Extra low")
	expect(qualityLabel("medium")).toBe("Medium")
	expect(["high", "x_low", "medium", "low"].sort((a, b) => qualityRank(a) - qualityRank(b))).toEqual([
		"x_low",
		"low",
		"medium",
		"high",
	])
})
