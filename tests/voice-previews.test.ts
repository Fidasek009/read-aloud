import { $ } from "bun"
import { afterEach, expect, test } from "bun:test"

import {
	currentPreview,
	previewLicenseEvidence,
	type PreviewRecord,
	previewText,
	selectPreviewVoices,
} from "../scripts/voice-preview-catalog.ts"
import { catalogVoices as voices } from "../src/speech/catalog.ts"
import delivery from "../src/speech/previews.json"
import originals from "../voice-previews/catalog.json"

const roots: string[] = []
afterEach(async () => {
	for (const root of roots.splice(0)) await $`rm -rf ${root}`.quiet()
})

test("every available model streams its matching original recording from the pinned Syllune collection", () => {
	expect(delivery.revision).toMatch(/^[a-f0-9]{40}$/)
	expect(Object.keys(delivery.recordings).sort()).toEqual(
		voices
			.filter((voice) => !voice.unsupported)
			.map((voice) => voice.id)
			.sort(),
	)
	for (const voice of voices) {
		if (voice.unsupported) {
			expect(voice.previewUrl).toBeNull()
			continue
		}
		const recording = originals[voice.id as keyof typeof originals]
		expect(recording.modelSha256).toBe(voice.sha256)
		expect(recording.configSha256).toBe(voice.configHash)
		expect(recording.text).toBe(previewText(voice))
		expect(recording.speaker).toBe(0)
		expect(recording.speed).toBe(1)
		expect(delivery.recordings[voice.id as keyof typeof delivery.recordings]).toBe(recording.audioSha256)
		expect(voice.previewUrl).toBe(
			`https://raw.githubusercontent.com/Fidasek009/syllune/${delivery.revision}/samples/${encodeURIComponent(voice.id)}.wav`,
		)
	}
})

test("preview production covers every catalog model, language and quality without a voice allowlist", () => {
	const selected = selectPreviewVoices(["--all"])
	expect(selected).toEqual(voices)
	expect(selected.length).toBeGreaterThan(170)
	for (const voice of selected) {
		expect(previewText(voice).length).toBeGreaterThan(20)
		expect(previewLicenseEvidence(voice).cardSha256).toMatch(/^[a-f0-9]{64}$/)
	}
	const english = previewText(voices.find((voice) => voice.locale === "en-US")!)
	for (const voice of selected.filter((voice) => !voice.locale.startsWith("en-")))
		expect(previewText(voice)).not.toBe(english)
	expect(() => previewText({ ...voices[0]!, locale: "zu-ZA" })).toThrow("Missing original preview text")
})

test("explicit subsets include multispeaker and unsupported models without changing catalog truth", () => {
	const ids = ["de_DE-mls-medium", "he_IL-saspeech-medium", "fr_FR-siwis-low"]
	expect(selectPreviewVoices([...ids, ids[0]!]).map((voice) => voice.id)).toEqual(ids)
	expect(() => selectPreviewVoices([])).toThrow("Select --all")
	expect(() => selectPreviewVoices(["--all", ids[0]!])).toThrow("Select --all")
	expect(() => selectPreviewVoices(["not-a-model"])).toThrow("Unknown preview model")
	expect(() => selectPreviewVoices([`${ids[0]}#2`])).toThrow("Unknown preview model")
	expect(previewLicenseEvidence(voices[0]!).note).toContain("not publication clearance")
})

test("resume verifies actual recording bytes and exact recipe before skipping work", async () => {
	const voice = voices[0]!
	const root = `${Bun.env.TMPDIR ?? "/tmp"}/read-aloud-preview-${crypto.randomUUID()}`
	roots.push(root)
	const bytes = new TextEncoder().encode("recording fixture")
	await Bun.write(`${root}/${voice.id}.wav`, bytes)
	const record: PreviewRecord = {
		text: previewText(voice),
		modelUrl: voice.url,
		modelSha256: voice.sha256,
		configSha256: voice.configHash,
		speaker: 0,
		speed: 1,
		sampleRate: 22050,
		durationSeconds: 5,
		audioSha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
		rendererSha256: "renderer",
		generatedAt: new Date().toISOString(),
		renderer: "test",
	}
	expect(await currentPreview(voice, record, root, "renderer")).toBe(true)
	// Delivery and unrelated bundle changes preserve already verified recordings.
	expect(await currentPreview(voice, record, root)).toBe(true)
	for (const change of [
		{ text: "old text" },
		{ modelSha256: "changed" },
		{ configSha256: "changed" },
		{ speaker: 1 },
		{ speed: 1.5 },
		{ rendererSha256: "changed" },
	])
		expect(await currentPreview(voice, { ...record, ...change }, root, "renderer")).toBe(false)
	expect(await currentPreview(voice, undefined, root)).toBe(false)
	await Bun.write(`${root}/${voice.id}.wav`, "damaged recording")
	expect(await currentPreview(voice, record, root)).toBe(false)
	expect(await currentPreview({ ...voice, id: "missing" }, record, root)).toBe(false)
})
