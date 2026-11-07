/** Persistent keys shared by extension pages; model bytes live separately in IndexedDB. */
export const localKeys = {
	voice: "voice",
	speed: "speed",
	volume: "volume",
	lastSpeechPerformance: "lastSpeechPerformance",
	voiceChange: "voiceChange",
} as const
