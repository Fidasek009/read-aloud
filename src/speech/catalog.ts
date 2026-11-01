import catalog from "./voices.json"

export interface VoiceConfig {
	audio: { sample_rate: number }
	espeak: { voice: string }
	inference: { noise_scale: number; length_scale: number; noise_w: number }
	phoneme_id_map: Record<string, number[]>
	phoneme_type?: string
	num_speakers?: number
	default_speaker_id?: number
	hop_length?: number
	phoneme_map?: Record<string, string[]>
}
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
export function getVoice(id: string): Voice {
	const voice = byId.get(id)
	if (!voice) throw new Error("This voice is not available")
	return voice
}

export function validateConfig(value: unknown): VoiceConfig {
	if (!value || typeof value !== "object") throw new Error("Invalid voice configuration")
	const config = value as Partial<VoiceConfig>
	if (
		!config.audio ||
		!Number.isInteger(config.audio.sample_rate) ||
		config.audio.sample_rate < 8000 ||
		config.audio.sample_rate > 48000 ||
		!config.espeak ||
		typeof config.espeak.voice !== "string" ||
		!config.inference ||
		![config.inference.noise_scale, config.inference.length_scale, config.inference.noise_w].every(
			(value) => Number.isFinite(value) && value >= 0 && value <= 10,
		) ||
		!config.phoneme_id_map ||
		typeof config.phoneme_id_map !== "object" ||
		!["_", "^", "$", " "].every((key) => Array.isArray(config.phoneme_id_map![key])) ||
		Object.values(config.phoneme_id_map).some(
			(ids) =>
				!Array.isArray(ids) || !ids.length || ids.some((id) => !Number.isSafeInteger(id) || id < 0 || id > 65535),
		)
	)
		throw new Error("Invalid voice configuration")
	if (config.num_speakers !== undefined && (!Number.isInteger(config.num_speakers) || config.num_speakers < 1))
		throw new Error("Invalid speaker count")
	return config as VoiceConfig
}

export function voiceChoice(value: string): { voice: Voice; speaker: number } {
	const [id, speakerText] = value.split("#")
	const voice = getVoice(id ?? "")
	const speaker = speakerText === undefined ? 0 : Number(speakerText)
	if (!Number.isInteger(speaker) || speaker < 0 || speaker >= voice.speakers)
		throw new Error("This speaker is not available")
	return { voice, speaker }
}
