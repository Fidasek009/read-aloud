import type { WorkerTimings } from "../src/speech/diagnostics.ts"
import type { VoiceConfig } from "../src/speech/voice-config.ts"
import type { WorkerCommand, WorkerResponse, WorkerSuccess } from "../src/speech/worker-protocol.ts"

import { SPEECH_REQUEST_TIMEOUT_MS } from "../src/speech/errors.ts"
import { instrumentModel } from "../src/speech/instrument.ts"
import {
	chromeExtensionId,
	closeChromeProbe,
	copyProbeExtension,
	createChromeProbe,
	projectRoot,
} from "./probe-helpers.ts"

interface SessionVariant {
	id: string
	optimization: "basic" | "disabled" | "all"
	disable: "0" | "1"
	threads?: number
}
interface PrefixWorkload {
	id: string
	maximumCharacters: number
	text: string
}
interface PrefixMeasurement {
	id: string
	pair: number
	order: number
	characters: number
	synthesisMs: number
	durationSeconds: number
}
interface SessionMeasurement extends WorkerTimings {
	id: string
	round: number
	loadMs: number
	synthesisMs: number[]
	firstBufferMs: number
	durationSeconds: number
	prefixMeasurements: PrefixMeasurement[]
}
interface WorkerExperiment {
	workerUrl: string
	modelUrl: string
	config: VoiceConfig
	id: string
	round: number
	requestTimeoutMs: number
	prefixes: PrefixWorkload[]
}

// Serialized into the extension page. Keep the browser acceptance code inside a
// typed function, with explicit arguments rather than untyped template strings.
async function measureWorker(options: WorkerExperiment): Promise<SessionMeasurement> {
	const model = await (await fetch(options.modelUrl)).arrayBuffer()
	const worker = new Worker(options.workerUrl, { type: "module" })
	let sequence = 0
	const pending = new Map<
		number,
		{
			resolve(response: WorkerSuccess): void
			reject(error: Error): void
			timer: ReturnType<typeof setTimeout>
		}
	>()
	const fail = (error: Error) => {
		for (const request of pending.values()) {
			clearTimeout(request.timer)
			request.reject(error)
		}
		pending.clear()
	}
	worker.onerror = (event) => fail(new Error(`Speech worker failed: ${event.message}`))
	worker.onmessageerror = () => fail(new Error("Speech worker reply could not be decoded"))
	worker.onmessage = ({ data }: MessageEvent<WorkerResponse>) => {
		const request = pending.get(data.id)
		if (!request) return
		clearTimeout(request.timer)
		pending.delete(data.id)
		if (data.ok) request.resolve(data)
		else request.reject(new Error(data.error))
	}
	const rpc = (command: WorkerCommand, transfer: Transferable[] = []) =>
		new Promise<WorkerSuccess>((resolve, reject) => {
			const id = ++sequence
			const timer = setTimeout(() => {
				pending.delete(id)
				reject(new Error("Session experiment timed out"))
			}, options.requestTimeoutMs)
			pending.set(id, { resolve, reject, timer })
			worker.postMessage({ ...command, id }, transfer)
		})
	const synthesize = async (text: string) => {
		const started = performance.now()
		const clip = await rpc({ type: "synthesize", text, speed: 1, speaker: 0 })
		const synthesisMs = performance.now() - started
		if (clip.type !== "synthesize" || !clip.pcm.length || !clip.pcm.every(Number.isFinite))
			throw new Error("Invalid speech output")
		return { synthesisMs, durationSeconds: clip.pcm.length / clip.sampleRate }
	}
	const started = performance.now()
	try {
		const loaded = await rpc(
			{ type: "load", voice: "en_US-ljspeech-medium", speaker: 0, config: options.config, model },
			[model],
		)
		if (loaded.type !== "load") throw new Error("Invalid model load reply")
		const loadMs = performance.now() - started
		const synthesisMs: number[] = []
		let durationSeconds = 0
		for (const text of [
			"Fresh words start a new selection.",
			"This sentence measures steady state speech generation.",
			"A different passage keeps the inference work representative.",
			"Another sentence tests reading without a cached clip.",
		]) {
			const clip = await synthesize(text)
			synthesisMs.push(clip.synthesisMs)
			durationSeconds = clip.durationSeconds
		}
		const prefixMeasurements: PrefixMeasurement[] = []
		for (let pair = 0; pair < 4 && options.prefixes.length; pair++) {
			const ordered = (options.round + pair) % 2 ? [...options.prefixes].reverse() : options.prefixes
			for (const [order, prefix] of ordered.entries())
				prefixMeasurements.push({
					id: prefix.id,
					pair,
					order,
					characters: prefix.text.length,
					...(await synthesize(prefix.text)),
				})
		}
		return {
			id: options.id,
			round: options.round,
			...loaded.timings,
			loadMs,
			synthesisMs,
			firstBufferMs: loadMs + synthesisMs[0]!,
			durationSeconds,
			prefixMeasurements,
		}
	} finally {
		worker.terminate()
		fail(new Error("Session experiment closed"))
	}
}

const root = projectRoot
const threadsExperiment = Bun.env.SESSION_EXPERIMENT === "threads"
if (Bun.env.SESSION_EXPERIMENT && !threadsExperiment)
	throw new Error("Unknown SESSION_EXPERIMENT; use threads or leave unset")
const out = `${root}/.cache/session-probe`
await copyProbeExtension("chrome", out)
const manifest = await Bun.file(`${out}/manifest.json`).json()
manifest.cross_origin_embedder_policy = { value: "require-corp" }
manifest.cross_origin_opener_policy = { value: "same-origin" }
await Bun.write(`${out}/manifest.json`, JSON.stringify(manifest))
const source = await Bun.file(`${root}/src/speech/worker.ts`).text()
if (!source.includes('graphOptimizationLevel: "all"') || !source.includes('disable_prepacking: "1"'))
	throw new Error("Production session options changed; update the measured variant anchors")
const threadSetting =
	"ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.max(1, Math.min(4, navigator.hardwareConcurrency || 1)) : 1"
if (threadsExperiment && !source.includes(threadSetting))
	throw new Error("Production thread policy changed; update the experiment anchor")
const variants: SessionVariant[] = threadsExperiment
	? [1, 2, 3, 4].map((threads) => ({
			id: `threads-${threads}`,
			optimization: "all",
			disable: "1",
			threads,
		}))
	: [
			{ id: "basic-prepack", optimization: "basic", disable: "0" },
			{ id: "basic-no-prepack", optimization: "basic", disable: "1" },
			{ id: "disabled-no-prepack", optimization: "disabled", disable: "1" },
			{ id: "all-no-prepack", optimization: "all", disable: "1" },
		]
for (const variant of variants) {
	let workerSource = source
		.replace('graphOptimizationLevel: "all"', `graphOptimizationLevel: "${variant.optimization}"`)
		.replace('disable_prepacking: "1"', `disable_prepacking: "${variant.disable}"`)
	if (variant.threads !== undefined)
		workerSource = workerSource.replace(
			threadSetting,
			`ort.env.wasm.numThreads = self.crossOriginIsolated ? ${variant.threads} : 1`,
		)
	const build = await Bun.build({
		entrypoints: [`${root}/src/speech/worker.ts`],
		outdir: `${out}/runtime/cpu`,
		naming: `${variant.id}.js`,
		format: "esm",
		target: "browser",
		define: { SPEECH_BACKEND: '"wasm"' },
		plugins: [
			{
				name: "session-experiment",
				setup(builder) {
					builder.onLoad({ filter: /[/\\]src[/\\]speech[/\\]worker.ts$/u }, () => ({
						contents: workerSource,
						loader: "ts",
						resolveDir: `${root}/src/speech`,
					}))
					builder.onResolve({ filter: /^onnxruntime-web$/u }, () => ({
						path: `${root}/node_modules/onnxruntime-web/dist/ort.wasm.min.mjs`,
					}))
				},
			},
		],
	})
	if (!build.success) throw new AggregateError(build.logs, "Session experiment failed to bundle")
}
const model = Bun.file(
	`${root}/.cache/piper/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx`,
)
if (!(await model.exists())) throw new Error("Provision the pinned LJSpeech model fixture first")
const config = (await Bun.file(`${root}/src/speech/configs/en_US-ljspeech-medium.json`).json()) as VoiceConfig
const bytes = instrumentModel(await model.arrayBuffer())
// Public benchmark text is a fixed experiment input, never user reading content.
const prefixSource =
	"MDDash is an open-source platform for running reproducible molecular dynamics experiments. I built it at CERIT-SC to bring a complicated research workflow into one place."
const prefixes: PrefixWorkload[] = threadsExperiment
	? [48, 100].map((maximumCharacters) => ({
			id: `prefix-${maximumCharacters}`,
			maximumCharacters,
			text: prefixSource.slice(0, prefixSource.lastIndexOf(" ", maximumCharacters)),
		}))
	: []
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch: () =>
		new Response(bytes, {
			headers: { "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin" },
		}),
})
const view = await createChromeProbe(out)
try {
	await view.navigate("about:blank")
	const id = chromeExtensionId(out)
	await view.navigate(`chrome-extension://${id}/voices.html`)
	await view.cdp("Runtime.enable")
	const results: SessionMeasurement[] = []
	// Rotate across fresh workers so the first WASM compilation and variant
	// ordering cannot systematically favor one setting. Prefix pair order also alternates.
	for (let round = 0; round < variants.length; round++)
		for (const variant of [...variants.slice(round), ...variants.slice(0, round)]) {
			const options: WorkerExperiment = {
				workerUrl: `chrome-extension://${id}/runtime/cpu/${variant.id}.js`,
				modelUrl: server.url.href,
				config,
				id: variant.id,
				round,
				requestTimeoutMs: SPEECH_REQUEST_TIMEOUT_MS,
				prefixes,
			}
			const response = await view.cdp<{
				result: { value: SessionMeasurement }
				exceptionDetails?: { exception?: { description?: string }; text?: string }
			}>("Runtime.evaluate", {
				expression: `(${measureWorker.toString()})(${JSON.stringify(options)})`,
				awaitPromise: true,
				returnByValue: true,
			})
			if (response.exceptionDetails)
				throw new Error(
					response.exceptionDetails.exception?.description ??
						response.exceptionDetails.text ??
						"Worker experiment failed",
				)
			const result = response.result.value
			if (threadsExperiment && (!result.crossOriginIsolated || result.threads !== variant.threads))
				throw new Error("Requested isolated thread configuration was not applied")
			results.push(result)
			console.log(JSON.stringify(result))
		}
	const destination = threadsExperiment ? "thread-and-chunk-2026-11-04.json" : "session-loading-2026-11-02.json"
	await Bun.write(
		`${root}/docs/evidence/${destination}`,
		JSON.stringify(
			{
				recordedAt: new Date().toISOString(),
				browser: await view.cdp("Browser.getVersion"),
				...(threadsExperiment
					? {
							experiment: "configured CPU threads and warm first-chunk prefixes",
							environment: {
								logicalCpus: await view.evaluate<number>("navigator.hardwareConcurrency"),
								memoryBytes:
									Number((await Bun.file("/proc/meminfo").text()).match(/^MemTotal:\s+(\d+)\s+kB/mu)?.[1]) * 1024,
								cpuModel: (await Bun.file("/proc/cpuinfo").text()).match(/^model name\s*:\s*(.+)$/mu)?.[1],
								platform: "Linux VM",
							},
							voice: "en_US-ljspeech-medium",
							graphOptimizationLevel: "all",
							prepacking: false,
							prefixes: prefixes.map(({ id: prefixId, maximumCharacters, text }) => ({
								id: prefixId,
								maximumCharacters,
								characters: text.length,
							})),
							prefixSourceHash: new Bun.CryptoHasher("sha256").update(prefixSource).digest("hex"),
						}
					: {}),
				results,
				limits: threadsExperiment
					? "Development Linux VM with 8 vCPUs and about 24 GB RAM; not the target 4-core/8-GB machine. Configured threads only, not independently observed thread use. Chrome extension top-level COOP/COEP page, CPU backend, cached model; no Firefox/GPU/Windows acceptance. Four rotated fresh-worker rounds per setting, four identical steady-state sentences per worker, then four paired 48/100-character caps alternating order. Exact word-boundary prefix lengths are recorded; the longer prefix can span a sentence boundary, so these are controlled synthesis workloads, not a replay of article segmentation. Direct worker RPC bypasses engine clip caching. Timings end at finite PCM delivery and exclude model storage, extraction, browser routing, WAV encoding, decoding, and audible playback; they are not end-to-end cold/warm acceptance. The first worker may also pay initial WASM compilation. No subjective voice/pitch/continuity validation."
					: "Development VM, extension top-level document with experimental COOP/COEP manifest. Does not establish isolation or multicore behavior in embedded production controls or Firefox. Local cached model; variant order rotates and the first measurement still includes initial WASM compilation. Four different sentences are synthesized per worker.",
			},
			null,
			2,
		) + "\n",
	)
	console.log(`Saved docs/evidence/${destination}`)
} finally {
	await closeChromeProbe(view)
	server.stop(true)
}
