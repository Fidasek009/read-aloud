import { catalogVoices as voices } from "../src/speech/catalog.ts"
import { downloadBytes } from "../src/speech/download.ts"
import {
	chromeExtensionId,
	closeChromeProbe,
	copyProbeExtension,
	createChromeProbe,
	projectRoot,
} from "./probe-helpers.ts"
import {
	currentPreview,
	previewLicenseEvidence,
	type PreviewRecord,
	previewText,
	selectPreviewVoices,
} from "./voice-preview-catalog.ts"

// Explicit maintainer command only; never imported by the extension or CI.
const args = process.argv.slice(2)
const planOnly = args.includes("--plan")
const recheck = args.includes("--recheck")
const ids = args.filter((arg) => arg !== "--plan" && arg !== "--recheck")
const selected = selectPreviewVoices(ids.length || !planOnly ? ids : ["--all"])
for (const voice of selected) previewText(voice)
const directory = `${projectRoot}/voice-previews`
const output = `${directory}/catalog.json`
const records: Record<string, PreviewRecord> = (await Bun.file(output).exists()) ? await Bun.file(output).json() : {}
const failures = new Map<string, string>()
async function report() {
	const entries = await Promise.all(
		voices.map(async (voice) => ({
			id: voice.id,
			locale: voice.locale,
			speaker: 0,
			modelSha256: voice.sha256,
			status: voice.unsupported
				? "unsupported-runtime"
				: failures.has(voice.id)
					? "failed"
					: (await currentPreview(voice, records[voice.id], directory))
						? "recorded"
						: "missing-or-stale",
			detail: voice.unsupported ?? failures.get(voice.id) ?? null,
		})),
	)
	const summary = {
		models: entries.length,
		languages: new Set(voices.map((voice) => new Intl.Locale(voice.locale).language)).size,
		recorded: entries.filter((entry) => entry.status === "recorded").length,
		unsupported: entries.filter((entry) => entry.status === "unsupported-runtime").length,
		failed: entries.filter((entry) => entry.status === "failed").length,
		missingOrStale: entries.filter((entry) => entry.status === "missing-or-stale").length,
	}
	const path = `${projectRoot}/.cache/evidence/voice-preview-coverage.json`
	await Bun.write(path, JSON.stringify({ generatedAt: new Date().toISOString(), summary, entries }, null, "\t") + "\n")
	console.log(JSON.stringify(summary))
	console.log(`Coverage: ${path}`)
}
if (planOnly) {
	await report()
	process.exit(0)
}

const extension = `${projectRoot}/.cache/own-preview-renderer`
await copyProbeExtension("chrome", extension)
const build = await Bun.build({
	entrypoints: [`${projectRoot}/scripts/render-voice-preview.ts`],
	outdir: extension,
	naming: "render-voice-preview.js",
	target: "browser",
	format: "esm",
})
if (!build.success) throw new AggregateError(build.logs, "Preview renderer failed to bundle")
const rendererHash = new Bun.CryptoHasher("sha256")
for (const path of [
	"render-voice-preview.js",
	...(await Array.fromAsync(new Bun.Glob("runtime/**/*").scan({ cwd: extension, onlyFiles: true }))).sort(),
]) {
	rendererHash.update(`${path}\0`).update(await Bun.file(`${extension}/${path}`).arrayBuffer())
}
const rendererSha256 = rendererHash.digest("hex")

// One disposable browser for the run; each rendering still disposes its own
// engine/worker. Avoid paying browser startup once for every catalog model.
let view: Bun.WebView | undefined
try {
	for (const [index, voice] of selected.entries()) {
		const { id } = voice
		if (voice.unsupported && !recheck) {
			console.error(`Unsupported ${id}: ${voice.unsupported}`)
			continue
		}
		if (await currentPreview(voice, records[id], directory, rendererSha256)) {
			console.log(`Verified existing preview (${index + 1}/${selected.length}): ${id}`)
			continue
		}
		try {
			const cache = `${projectRoot}/.cache/own-preview-models/${id}`
			for (const [name, url, sha256, bytes] of [
				["model", voice.url, voice.sha256, voice.bytes],
				["config", voice.configUrl, voice.configHash, undefined],
			] as const) {
				const path = `${cache}/${name}`
				if (!(await Bun.file(path).exists())) {
					console.log(`Provisioning (${index + 1}/${selected.length}): ${id} ${name}`)
					const data = await downloadBytes(url, {
						signal: new AbortController().signal,
						...(bytes === undefined ? {} : { bytes }),
						maxBytes: bytes ?? 1_000_000,
					})
					if (new Bun.CryptoHasher("sha256").update(data).digest("hex") !== sha256)
						throw new Error(`Wrong preview source: ${id} ${name}`)
					await Bun.write(path, data)
				}
				if (new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex") !== sha256)
					throw new Error(`Corrupt preview cache: ${id} ${name}`)
			}
			const server = Bun.serve({
				hostname: "127.0.0.1",
				port: 0,
				fetch(request) {
					const path = new URL(request.url).pathname
					return new Response(path === "/model" || path === "/config" ? Bun.file(`${cache}${path}`) : null, {
						status: path === "/model" || path === "/config" ? 200 : 404,
						headers: { "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin" },
					})
				},
			})
			try {
				if (!view) {
					view = await createChromeProbe(extension, ["--headless=new", "--no-sandbox"])
					await view.navigate(`chrome-extension://${chromeExtensionId(extension)}/voices.html`)
				}
				const response = await view.cdp<{
					result: { value: { audio: string; durationSeconds: number; sampleRate: number; peak: number } }
					exceptionDetails?: { text: string; exception?: { description: string } }
				}>("Runtime.evaluate", {
					expression: `import(chrome.runtime.getURL('render-voice-preview.js')).then(m=>m.renderVoicePreview(${JSON.stringify(server.url.href)},${JSON.stringify(id)},${JSON.stringify(previewText(voice))}))`,
					awaitPromise: true,
					returnByValue: true,
				})
				if (response.exceptionDetails)
					throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
				const { audio, durationSeconds, sampleRate, peak } = response.result.value
				if (!Number.isFinite(durationSeconds) || durationSeconds < 2 || durationSeconds > 30 || !(peak > 0.01))
					throw new Error(`Invalid preview audio: ${id}`)
				const data = Uint8Array.fromBase64(audio)
				await Bun.write(`${directory}/${id}.wav`, data)
				const previous = records[id]?.modelSha256 === voice.sha256 ? records[id] : undefined
				records[id] = {
					text: previewText(voice),
					...(previous?.modelTerms ? { modelTerms: previous.modelTerms } : {}),
					...(previous?.grantUrl ? { grantUrl: previous.grantUrl } : {}),
					licenseEvidence: previewLicenseEvidence(voice),
					modelUrl: voice.url,
					modelSha256: voice.sha256,
					configSha256: voice.configHash,
					speaker: 0,
					speed: 1,
					sampleRate,
					durationSeconds,
					audioSha256: new Bun.CryptoHasher("sha256").update(data).digest("hex"),
					rendererSha256,
					generatedAt: new Date().toISOString(),
					renderer: "Read Aloud CPU worker; ONNX graph instrumented for timing; original weights unchanged",
				}
				await Bun.write(output, `${JSON.stringify(records, null, "\t")}\n`)
				console.log(`Created (${index + 1}/${selected.length}): ${id}, ${durationSeconds.toFixed(1)} seconds`)
			} finally {
				server.stop(true)
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error)
			failures.set(id, message)
			console.error(`Failed ${id}: ${message}`)
			if (view) {
				await closeChromeProbe(view)
				view = undefined
			}
		}
	}
} finally {
	if (view) await closeChromeProbe(view)
}
await report()
if (failures.size || (!recheck && selected.some((voice) => voice.unsupported))) process.exitCode = 1
