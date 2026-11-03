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
	if (
		(config.phoneme_type !== undefined && typeof config.phoneme_type !== "string") ||
		(config.hop_length !== undefined &&
			(!Number.isSafeInteger(config.hop_length) || config.hop_length < 1 || config.hop_length > 8192)) ||
		(config.phoneme_map !== undefined &&
			(!config.phoneme_map ||
				typeof config.phoneme_map !== "object" ||
				Array.isArray(config.phoneme_map) ||
				Object.values(config.phoneme_map).some(
					(mapped) => !Array.isArray(mapped) || mapped.some((symbol) => typeof symbol !== "string"),
				)))
	)
		throw new Error("Invalid voice configuration")
	return config as VoiceConfig
}
