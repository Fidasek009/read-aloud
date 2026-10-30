import czech from "./configs/cs_CZ-jirka-medium.json"
import english from "./configs/en_US-ljspeech-medium.json"

export interface VoiceConfig {
	audio: { sample_rate: number }
	espeak: { voice: string }
	inference: { noise_scale: number; length_scale: number; noise_w: number }
	phoneme_id_map: Record<string, number[]>
}

export interface Voice {
	id: string
	name: string
	language: string
	bytes: number
	sha256: string
	url: string
	previewUrl: string
	config: VoiceConfig
}

const revision = "5041a7a49ae5b3a0f30e6837769eb03fdbb231bd"
const base = `https://huggingface.co/rhasspy/piper-voices/resolve/${revision}`
const samples =
	"https://raw.githubusercontent.com/rhasspy/piper-samples/da672d1157136d07365790f51da3357a17cf9650/samples"

// Curated prototype catalog. Do not import an unreviewed remote catalog at runtime.
export const voices: readonly Voice[] = [
	{
		id: "en_US-ljspeech-medium",
		name: "LJSpeech",
		language: "English (US)",
		bytes: 63531379,
		sha256: "6f52a751e2349abe7a76735eb09dc1875298c77ea2342ffd2fef79ff81b87f22",
		url: `${base}/en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx`,
		previewUrl: `${samples}/en/en_US/ljspeech/medium/speaker_0.mp3`,
		config: english,
	},
	{
		id: "cs_CZ-jirka-medium",
		name: "Jirka",
		language: "Čeština",
		bytes: 63201294,
		sha256: "cbd5c900acacc8e8cbecd64347abb8de39c00a9d3104bed06fee92e4f319efc8",
		url: `${base}/cs/cs_CZ/jirka/medium/cs_CZ-jirka-medium.onnx`,
		previewUrl: `${samples}/cs/cs_CZ/jirka/medium/speaker_0.mp3`,
		config: czech,
	},
]

export function getVoice(id: string): Voice {
	const voice = voices.find((voice) => voice.id === id)
	if (!voice) throw new Error("This voice is not available")
	return voice
}
