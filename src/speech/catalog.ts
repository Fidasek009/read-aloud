import { voiceModelId } from "./protocol.ts"
import catalog from "./voices.json"

export { validateConfig, type VoiceConfig } from "./voice-config.ts"

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
	license: string
	termsUrl: string
	inheritedTerms: boolean
	unsupported: string | null
	phonemeType: string
	speakers: number
	speakerNames: Record<string, number> | undefined
}
const base = `https://huggingface.co/rhasspy/piper-voices/resolve/${catalog.revision}`
export const voices: readonly Voice[] = catalog.voices.map((voice) => ({
	...voice,
	speakerNames: voice.speakerNames as Record<string, number> | undefined,
	url: `${base}/${voice.path}`,
	configUrl: `${base}/${voice.path}.json`,
	previewUrl: voice.previewPath
		? `https://raw.githubusercontent.com/rhasspy/piper-samples/${catalog.samplesRevision}/${voice.previewPath}`
		: null,
	termsUrl: `https://huggingface.co/rhasspy/piper-voices/blob/${catalog.revision}/${voice.path.replace(/[^/]+$/, "MODEL_CARD")}`,
}))
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
	return locales.get(language)!.size > 1 ? voice.language : (languageNames.of(language) ?? voice.language)
}

const byId = new Map(voices.map((voice) => [voice.id, voice]))
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
