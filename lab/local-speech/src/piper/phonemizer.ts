import createPiperPhonemize from "../../vendor/piper/piper_phonemize.cjs"

export interface Phonemes {
	phoneme_ids: number[]
	phonemes: string[]
}
export async function createPhonemizer(base: URL) {
	let output: string | undefined
	const errors: string[] = []
	const module = await createPiperPhonemize({
		print(value) {
			output = value
		},
		printErr(value) {
			errors.push(value)
		},
		locateFile(path) {
			return new URL(`models/phonemizer/${path.split("/").at(-1)}`, base).href
		},
		noInitialRun: true,
		noExitRuntime: true,
	})
	return (text: string, language: string): Phonemes => {
		output = undefined
		errors.length = 0
		module.callMain(["-l", language, "--input", JSON.stringify([{ text }]), "--espeak_data", "/espeak-ng-data"])
		if (!output) throw new Error(`Phonemization produced no result: ${errors.join("; ").slice(0, 300)}`)
		const value: unknown = JSON.parse(output)
		if (
			!value ||
			typeof value !== "object" ||
			!("phoneme_ids" in value) ||
			!Array.isArray(value.phoneme_ids) ||
			!value.phoneme_ids.every((id) => Number.isInteger(id) && id >= 0)
		)
			throw new Error("Invalid phoneme IDs")
		if (
			!("phonemes" in value) ||
			!Array.isArray(value.phonemes) ||
			!value.phonemes.every((phoneme) => typeof phoneme === "string")
		)
			throw new Error("Invalid phoneme symbols")
		return value as Phonemes
	}
}
