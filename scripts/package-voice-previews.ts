import { productName } from "../src/extension/brand.ts"
import { voices } from "../src/speech/catalog.ts"
import { currentPreview, type PreviewRecord } from "./voice-preview-catalog.ts"

/** Maintainer-only delivery; recordings never enter WXT's public directory. */
export async function packageVoicePreviews(root = process.cwd()) {
	const records = (await Bun.file(`${root}/voice-previews/catalog.json`).json()) as Record<string, PreviewRecord>
	for (const voice of voices) {
		if (!(await currentPreview(voice, records[voice.id], `${root}/voice-previews`)))
			throw new Error(`Missing or stale original preview: ${voice.id}; regenerate before publishing`)
	}
	const destination = `${root}/.cache/preview-delivery`
	await Bun.$`rm -rf ${destination + "/samples"}`.quiet()
	await Bun.$`mkdir -p ${destination + "/samples"}`.quiet()
	const hashes: Record<string, string> = {}
	for (const voice of voices) {
		await Bun.write(`${destination}/samples/${voice.id}.wav`, Bun.file(`${root}/voice-previews/${voice.id}.wav`))
		hashes[voice.id] = records[voice.id]!.audioSha256
	}
	await Bun.write(`${destination}/catalog.json`, JSON.stringify(records, null, "\t") + "\n")
	await Bun.write(`${destination}/texts.json`, Bun.file(`${root}/voice-previews/texts.json`))
	await Bun.write(`${destination}/LICENSE`, Bun.file(`${root}/LICENSE`))
	await Bun.write(
		`${destination}/README.md`,
		`# ${productName} original voice previews\n\n${voices.length} locally synthesized recordings of original ${productName} texts.\n\nThese files are delivered separately from the extension and fetched only when you press a voice's play icon. Each released extension pins a specific commit of this branch. No upstream sample recordings or Wikipedia text are copied. No model weights or executable code are hosted here.\n\nOriginal texts and ${productName} contributions are MIT; see LICENSE. Model terms remain separate: catalog.json preserves the exact model/config/audio hashes, speaker zero, speed, original text, renderer and available model-card evidence for each recording. It does not declare every model or output unrestricted. Kasandra medium credits Ondřej Šimek under CC BY 4.0 (https://huggingface.co/rhasspy/piper-voices/discussions/93). Full model/source details: https://github.com/Fidasek009/syllune/blob/main/docs/licensing.md.\n`,
	)
	return { destination, hashes }
}

if (import.meta.main) {
	const revision = process.argv[2]
	if (process.argv.length > 3 || (revision && !/^[a-f0-9]{40}$/.test(revision)))
		throw new Error("Use no arguments to package recordings, or a full published Git commit to pin delivery")
	const { destination, hashes } = await packageVoicePreviews()
	if (revision) {
		// Verify public delivery before changing production URLs. Maintainer traffic
		// is explicit; the extension itself fetches only on a preview action.
		const entries = Object.entries(hashes)
		let next = 0
		await Promise.all(
			Array.from({ length: 6 }, async () => {
				while (next < entries.length) {
					const [id, expected] = entries[next++]!
					const response = await fetch(
						`https://raw.githubusercontent.com/Fidasek009/syllune/${revision}/samples/${id}.wav`,
						{ signal: AbortSignal.timeout(30_000) },
					)
					if (!response.ok || response.headers.get("access-control-allow-origin") !== "*")
						throw new Error(`Original preview not publicly playable: ${id} (${response.status})`)
					if (new Bun.CryptoHasher("sha256").update(await response.arrayBuffer()).digest("hex") !== expected)
						throw new Error(`Published recording differs from verified original: ${id}`)
				}
			}),
		)
		await Bun.write("src/speech/previews.json", JSON.stringify({ revision, recordings: hashes }, null, "\t") + "\n")
		console.log(`Verified and pinned all ${entries.length} original previews to ${revision}`)
	} else console.log(`Packaged ${Object.keys(hashes).length} original previews in ${destination}`)
}
