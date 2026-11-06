// Maintainer action only. Pins metadata/config hashes; never downloads model weights or samples.
const revision = "5041a7a49ae5b3a0f30e6837769eb03fdbb231bd"
const repository = "https://huggingface.co/rhasspy/piper-voices"
const base = `${repository}/resolve/${revision}`
async function json(url: string): Promise<any> {
	const response = await fetch(url)
	if (!response.ok) throw new Error(`Metadata request failed: ${response.status} ${url}`)
	return response.json()
}
const catalog = await json(`${base}/voices.json`)
const files = new Map<string, any>()
let next = `https://huggingface.co/api/models/rhasspy/piper-voices/tree/${revision}?recursive=true&expand=false&limit=1000`
while (next) {
	const response = await fetch(next)
	if (!response.ok) throw new Error("Cannot read pinned model file metadata")
	for (const file of (await response.json()) as any[]) files.set(file.path, file)
	next = response.headers.get("link")?.match(/<([^>]+)>; rel="next"/)?.[1] ?? ""
}
const queue: any[] = Object.values(catalog)
const result: any[] = []
await Promise.all(
	Array.from({ length: 8 }, async () => {
		for (;;) {
			const voice = queue.shift()
			if (!voice) return
			const path = Object.keys(voice.files).find((path) => path.endsWith(".onnx"))!
			const file = files.get(path)
			if (!file?.lfs?.oid || !/^[a-f0-9]{64}$/.test(file.lfs.oid)) throw new Error(`Missing SHA-256: ${path}`)
			const configResponse = await fetch(`${base}/${path}.json`)
			if (!configResponse.ok) throw new Error(`Missing configuration: ${voice.key}`)
			const configBytes = await configResponse.arrayBuffer()
			const config = JSON.parse(new TextDecoder().decode(configBytes))
			const phonemeType = config.phoneme_type ?? "espeak"
			const language = voice.language
			result.push({
				id: voice.key,
				name: voice.name === "ljspeech" ? "LJSpeech" : voice.name.replaceAll("_", " "),
				language: `${language.name_english} (${language.country_english})`,
				nativeLanguage: language.name_native,
				locale: language.code.replaceAll("_", "-"),
				quality: voice.quality,
				bytes: file.size,
				sha256: file.lfs.oid,
				path,
				configHash: new Bun.CryptoHasher("sha256").update(configBytes).digest("hex"),
				unsupported: ["espeak", "text"].includes(phonemeType)
					? null
					: `Requires the ${phonemeType} pronunciation engine`,
			})
		}
	}),
)
result.sort(
	(a, b) => a.locale.localeCompare(b.locale) || a.name.localeCompare(b.name) || a.quality.localeCompare(b.quality),
)
await Bun.write("src/speech/voices.json", JSON.stringify({ revision, voices: result }, null, "\t") + "\n")
console.log(
	`Pinned ${result.length} models, ${new Set(result.map((v) => v.locale)).size} locales, ${result.filter((v) => v.unsupported).length} unsupported phonemizers; no models or previews downloaded.`,
)
