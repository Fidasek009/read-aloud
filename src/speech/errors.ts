/** Only source-specific failures may be skipped; runtime and connection failures must surface. */
export class SpeechTextError extends Error {
	override name = "SpeechTextError"
}
