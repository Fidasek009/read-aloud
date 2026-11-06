import inventory from "../docs/evidence/catalog-license-inventory-2026-11-05.json"
import { catalogVoices as voices, type Voice } from "../src/speech/catalog.ts"
import texts from "../voice-previews/texts.json"

export interface PreviewRecord {
	text: string
	modelUrl: string
	modelSha256: string
	configSha256: string
	speaker: number
	speed: number
	sampleRate: number
	durationSeconds: number
	audioSha256: string
	rendererSha256: string
	generatedAt: string
	renderer: string
	modelTerms?: string
	grantUrl?: string
	licenseEvidence?: ReturnType<typeof previewLicenseEvidence>
}

export function previewText(voice: Voice): string {
	const language = new Intl.Locale(voice.locale).language
	const text = (texts as Record<string, string>)[language]
	if (!text?.trim()) throw new Error(`Missing original preview text: ${voice.id} (${language})`)
	return text
}

/** Every model uses speaker zero, matching the model-card Listen button. */
export function selectPreviewVoices(ids: string[]): readonly Voice[] {
	if (ids.length === 1 && ids[0] === "--all") return voices
	if (!ids.length || ids.some((id) => id.startsWith("--")))
		throw new Error("Select --all or explicit catalog model IDs; use --plan for coverage without downloads")
	return [...new Set(ids)].map((id) => {
		const voice = voices.find((entry) => entry.id === id)
		if (!voice) throw new Error(`Unknown preview model: ${id}`)
		return voice
	})
}

/** Model-card statements are evidence, never an inferred recording license. */
export function previewLicenseEvidence(voice: Voice) {
	const entry = inventory.entries.find((entry) => entry.id === voice.id && entry.modelSha256 === voice.sha256)
	return {
		cardUrl: entry?.cardUrl ?? voice.termsUrl,
		cardSha256: entry?.cardSha256 ?? null,
		declaredLicenseFields: entry?.declaredLicenseFields ?? [],
		licenseSectionExcerpt: entry?.licenseSectionExcerpt ?? "",
		trainingSummary: entry?.trainingSummary ?? [],
		note: "Pinned card evidence; dataset terms do not independently establish model/output rights. Local generation is not publication clearance.",
	}
}

/** Do not silently reuse recordings after text, model, config or renderer changes. */
export async function currentPreview(
	voice: Voice,
	record: PreviewRecord | undefined,
	root: string,
	rendererSha256?: string,
): Promise<boolean> {
	if (
		!record ||
		record.text !== previewText(voice) ||
		record.modelSha256 !== voice.sha256 ||
		record.configSha256 !== voice.configHash ||
		record.speaker !== 0 ||
		record.speed !== 1 ||
		(rendererSha256 !== undefined && record.rendererSha256 !== rendererSha256)
	)
		return false
	const file = Bun.file(`${root}/${voice.id}.wav`)
	return (
		(await file.exists()) &&
		new Bun.CryptoHasher("sha256").update(await file.arrayBuffer()).digest("hex") === record.audioSha256
	)
}
