import previews from "./previews.json"
import catalog from "./voices.json"

export interface Voice {
	id: string
	name: string
	language: string
	nativeLanguage: string
	locale: string
	quality: string
	bytes: number
	sha256: string
	url: string
	configUrl: string
	configHash: string
	previewUrl: string | null
	termsUrl: string
	unsupported: string | null
}
const base = `https://huggingface.co/rhasspy/piper-voices/resolve/${catalog.revision}`
/** Upstream metadata retained for maintenance and deleting older downloads. */
export const catalogVoices: readonly Voice[] = catalog.voices.map((voice) => ({
	...voice,
	url: `${base}/${voice.path}`,
	configUrl: `${base}/${voice.path}.json`,
	previewUrl:
		!voice.unsupported && Object.hasOwn(previews.recordings, voice.id)
			? `https://raw.githubusercontent.com/Fidasek009/syllune/${previews.revision}/samples/${encodeURIComponent(voice.id)}.wav`
			: null,
	termsUrl: `https://huggingface.co/rhasspy/piper-voices/blob/${catalog.revision}/${voice.path.replace(/[^/]+$/, "MODEL_CARD")}`,
}))
/** Only compatible models are offered for download and reading. */
export const voices: readonly Voice[] = catalogVoices.filter((voice) => !voice.unsupported)
const languageNames = new Intl.DisplayNames(["en"], { type: "language" })
const locales = new Map<string, Set<string>>()
for (const voice of voices) {
	const language = new Intl.Locale(voice.locale.replaceAll("_", "-")).language
	if (!locales.has(language)) locales.set(language, new Set())
	locales.get(language)!.add(voice.locale)
}

/** Keep regional names only when they distinguish available catalog locales. */
export function languageLabel(voice: Voice): string {
	const language = new Intl.Locale(voice.locale.replaceAll("_", "-")).language
	return (locales.get(language)?.size ?? 0) > 1 ? voice.language : (languageNames.of(language) ?? voice.language)
}

const byId = new Map(catalogVoices.map((voice) => [voice.id, voice]))
const qualityOrder = ["x_low", "low", "medium", "high"]
export function qualityLabel(quality: string): string {
	return quality === "x_low" ? "Extra low" : quality.charAt(0).toUpperCase() + quality.slice(1)
}

/** Orders qualities by speech quality rather than by label text. */
export function qualityRank(quality: string): number {
	const rank = qualityOrder.indexOf(quality)
	return rank === -1 ? qualityOrder.length : rank
}

export function compareVoices(a: Voice, b: Voice): number {
	return (
		languageLabel(a).localeCompare(languageLabel(b)) ||
		a.name.localeCompare(b.name) ||
		qualityRank(a.quality) - qualityRank(b.quality)
	)
}

export function getVoice(id: string): Voice {
	const voice = byId.get(id)
	if (!voice) throw new Error("This voice is not available")
	return voice
}
