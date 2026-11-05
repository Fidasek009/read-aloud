import catalog from "../src/speech/voices.json"

// Developer audit only: retrieve pinned cards and sample TEXT, never models or audio.
// This records statements and provenance; it does not infer a copyright grant.
function fields(text: string, name: string) {
	const pattern = new RegExp(`^\\s*[-*]?\\s*${name}\\s*:`, "i")
	return text
		.split(/\r?\n/)
		.filter((line) => pattern.test(line))
		.map((line) => line.replace(/^\s*[-*]?\s*/, ""))
}
async function document(url: string) {
	const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
	if (!response.ok) throw new Error(`Audit metadata unavailable: ${response.status} ${url}`)
	const bytes = await response.arrayBuffer()
	return { text: new TextDecoder().decode(bytes), hash: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") }
}
async function inspect(voice: (typeof catalog.voices)[number]) {
	const cardPath = voice.path.replace(/[^/]+$/, "MODEL_CARD")
	const cardUrl = `https://huggingface.co/rhasspy/piper-voices/raw/${catalog.revision}/${cardPath}`
	const card = await document(cardUrl)
	if (voice.previewPath && !/\/speaker_\d+\.mp3$/.test(voice.previewPath))
		throw new Error(`Unsupported preview path; refusing to fetch audio: ${voice.id}`)
	const sampleTextUrl = voice.previewPath
		? `https://raw.githubusercontent.com/rhasspy/piper-samples/${catalog.samplesRevision}/${voice.previewPath.replace(/speaker_\d+\.mp3$/, "sample.txt")}`
		: null
	const sample = sampleTextUrl ? await document(sampleTextUrl) : null
	return {
		id: voice.id,
		locale: voice.locale,
		modelSha256: voice.sha256,
		modelPath: voice.path,
		cardUrl,
		cardHttpStatus: 200,
		cardSha256: card.hash,
		sampleTextUrl,
		sampleTextHttpStatus: sample ? 200 : null,
		sampleTextSha256: sample?.hash ?? null,
		declaredLicenseFields: fields(card.text, "License"),
		licenseSectionExcerpt: (card.text.match(/## License\s*([\s\S]*?)(?:\n## |$)/i)?.[1] ?? "").trim().slice(0, 800),
		authorFields: fields(card.text, "Author"),
		trainingSummary: (card.text.match(/## Training\s*([\s\S]*?)(?:\n## |$)/i)?.[1] ?? "")
			.trim()
			.split("\n")
			.filter((line) => /fine.?tun|scratch|rights|original recordings|license/i.test(line))
			.map((line) => line.trim()),
	}
}
const entries: Awaited<ReturnType<typeof inspect>>[] = []
let next = 0
await Promise.all(
	Array.from({ length: 8 }, async () => {
		while (next < catalog.voices.length) entries.push(await inspect(catalog.voices[next++]!))
	}),
)
entries.sort((left, right) => left.id.localeCompare(right.id))
const result = {
	reviewedAt: new Date().toISOString().slice(0, 10),
	modelRevision: catalog.revision,
	sampleRevision: catalog.samplesRevision,
	scope:
		"All pinned model cards and per-voice sample text references audited as metadata only; no weights or audio fetched. Dataset labels do not independently establish model/audio grants. Source-host downloads and local graph modifications remain separate from redistributing weights.",
	previewTextSource: {
		indexUrl: `https://github.com/rhasspy/piper-samples/blob/${catalog.samplesRevision}/index.html`,
		declaration:
			"Upstream identifies Wikipedia Rainbow articles as spoken source text; no original per-sample article revision is supplied.",
		englishArticle: "https://en.wikipedia.org/wiki/Rainbow",
		czechArticle: "https://cs.wikipedia.org/wiki/Duha",
		terms: "https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use",
		textLicense: "https://creativecommons.org/licenses/by-sa/4.0/",
		note: "Text attribution does not independently clear audio/voice/performance/transcript use or infer redistribution rights.",
	},
	entries,
}
const output = `docs/evidence/catalog-license-inventory-${result.reviewedAt}.json`
await Bun.write(output, `${JSON.stringify(result, null, "\t")}\n`)
console.log(
	`Recorded ${entries.length} model cards and ${entries.filter((entry) => entry.sampleTextUrl).length} sample texts in ${output}. No models/audio fetched; no release findings approved.`,
)
