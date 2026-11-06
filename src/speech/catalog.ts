import previews from "./previews.json"
import { voiceModelId } from "./protocol.ts"
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
	speakers: number
	speakerNames: Record<string, number> | undefined
}
const base = `https://huggingface.co/rhasspy/piper-voices/resolve/${catalog.revision}`
/** Upstream metadata retained for maintenance and deleting older downloads. */
export const catalogVoices: readonly Voice[] = catalog.voices.map((voice) => ({
	...voice,
	speakerNames: voice.speakerNames as Record<string, number> | undefined,
	url: `${base}/${voice.path}`,
	configUrl: `${base}/${voice.path}.json`,
	previewUrl:
		!voice.unsupported && Object.hasOwn(previews.recordings, voice.id)
			? `https://raw.githubusercontent.com/Fidasek009/read-aloud/${previews.revision}/samples/${encodeURIComponent(voice.id)}.wav`
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
export function qualityLabel(quality: string): string {
	return quality === "x_low" ? "Extra low" : quality.charAt(0).toUpperCase() + quality.slice(1)
}

export function getVoice(id: string): Voice {
	const voice = byId.get(id)
	if (!voice) throw new Error("This voice is not available")
	return voice
}

export function voiceChoice(value: string): { voice: Voice; speaker: number } {
	const id = voiceModelId(value)
	const speakerText = id.length === value.length ? undefined : value.slice(id.length + 1)
	const voice = getVoice(id)
	const speaker = speakerText === undefined ? 0 : /^\d+$/u.test(speakerText) ? Number(speakerText) : NaN
	if (!Number.isSafeInteger(speaker) || speaker < 0 || speaker >= voice.speakers)
		throw new Error("This speaker is not available")
	return { voice, speaker }
}
