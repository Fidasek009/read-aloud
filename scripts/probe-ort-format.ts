/** Maintainer experiment only. Native N-API conversion runs in Bun, never in the extension. */
import { $ } from "bun"

import { instrumentModel } from "../src/speech/instrument.ts"
import { chromeExecutable, chromeExtensionId, chromeTestProfileArguments, projectRoot } from "./probe-helpers.ts"

const directory = `${projectRoot}/.cache/ort-converter`
const packageUrl = "https://registry.npmjs.org/onnxruntime-node/-/onnxruntime-node-1.31.1.tgz"
const integrity = "sha512-ijnSghbDHVWaQ2nDPmVccPlCHI8kH1Mx1aJ4a/qzRP16bBcVs4E3EqZQKZCkhWnbqN1tuQWxagimFtDpbPYYQw=="
const archivePath = `${directory}/onnxruntime-node-1.31.1.tgz`
if (!(await Bun.file(archivePath).exists())) {
	const response = await fetch(packageUrl)
	if (!response.ok) throw new Error(`Native fixture package download failed: ${response.status}`)
	await Bun.write(archivePath, await response.arrayBuffer())
}
for (const name of ["LICENSE", "ThirdPartyNotices.txt"]) {
	await Bun.write(`${directory}/notices/${name}`, Bun.file(`${projectRoot}/vendor/onnxruntime/${name}`))
}
await Bun.write(
	`${directory}/provenance.json`,
	JSON.stringify(
		{
			package: "onnxruntime-node",
			version: "1.31.1",
			packageUrl,
			integrity,
			upstream: "https://github.com/microsoft/onnxruntime/tree/v1.31.1/js/node",
			license: "MIT with separate third-party notices",
			runtime: `Bun ${Bun.version}`,
			installScriptsExecuted: false,
			distribution: "Ignored maintainer experiment only; never bundled in extension",
		},
		null,
		2,
	) + "\n",
)
const archiveBytes = await Bun.file(archivePath).arrayBuffer()
if (`sha512-${new Bun.CryptoHasher("sha512").update(archiveBytes).digest("base64")}` !== integrity)
	throw new Error("Native package fixture integrity mismatch")
if (process.platform !== "linux" || process.arch !== "x64") throw new Error("This experiment supports Linux x64 only")
const archive = new Bun.Archive(archiveBytes)
await archive.extract(directory, {
	glob: ["package/dist/**", "package/package.json", "package/bin/napi-v6/linux/x64/**"],
})
// Reuse the existing pinned common package. Never execute upstream install scripts.
const commonEntry = Bun.resolveSync("onnxruntime-common", Bun.fileURLToPath(import.meta.resolve("onnxruntime-web")))
const common = Bun.fileURLToPath(new URL("../../", Bun.pathToFileURL(commonEntry)))
await $`mkdir -p ${directory + "/package/node_modules"}`.quiet()
if (!(await Bun.file(`${directory}/package/node_modules/onnxruntime-common/package.json`).exists()))
	await $`ln -s ${common} ${directory + "/package/node_modules/onnxruntime-common"}`.quiet()
const nativeEntry = `${directory}/package/dist/index.js`
const native = await import(nativeEntry)
const fixture = `${projectRoot}/.cache/piper/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx`
const raw = await Bun.file(fixture).arrayBuffer()
const model = instrumentModel(raw)
const convertedPath = `${directory}/voice.ort`
const conversionStarted = performance.now()
const session = await native.InferenceSession.create(model, {
	executionProviders: ["cpu"],
	graphOptimizationLevel: "basic",
	optimizedModelFilePath: convertedPath,
	intraOpNumThreads: 1,
	interOpNumThreads: 1,
	extra: { session: { disable_prepacking: "1", save_model_format: "ORT" } },
})
const nativeConvertMs = performance.now() - conversionStarted
await session.release()
const converted = await Bun.file(convertedPath).bytes()
const config = await Bun.file(`${fixture}.json`).json()
config.inference.noise_scale = 0
config.inference.noise_w = 0
const extension = `${projectRoot}/.cache/cold-phases-probe`
if (!(await Bun.file(`${extension}/runtime/cpu/baseline.js`).exists()))
	throw new Error("Run the cold-phase probe first to prepare its isolated browser package")
const workerSource = await Bun.file(`${projectRoot}/src/speech/worker.ts`).text()
const variants = [
	{ id: "onnx", format: "onnx", optimization: "basic", prepack: "1" },
	{ id: "ort", format: "ort", optimization: "basic", prepack: "1" },
	{ id: "ort-disabled-prepack", format: "ort", optimization: "disabled", prepack: "0" },
	{ id: "ort-disabled-no-prepack", format: "ort", optimization: "disabled", prepack: "1" },
] as const
for (const variant of variants) {
	const contents = workerSource
		.replace('graphOptimizationLevel: "basic"', `graphOptimizationLevel: "${variant.optimization}"`)
		.replace('disable_prepacking: "1"', `disable_prepacking: "${variant.prepack}"`)
	const build = await Bun.build({
		entrypoints: [`${projectRoot}/src/speech/worker.ts`],
		outdir: `${extension}/runtime/cpu`,
		naming: `${variant.id}.js`,
		target: "browser",
		format: "esm",
		define: { SPEECH_BACKEND: JSON.stringify("wasm") },
		plugins: [
			{
				name: "ort-format-experiment",
				setup(builder) {
					builder.onLoad({ filter: /[\\/]src[\\/]speech[\\/]worker.ts$/ }, () => ({
						contents,
						loader: "ts",
						resolveDir: `${projectRoot}/src/speech`,
					}))
					builder.onResolve({ filter: /^onnxruntime-web$/ }, () => ({
						path: `${projectRoot}/node_modules/onnxruntime-web/dist/ort.wasm.min.mjs`,
					}))
				},
			},
		],
	})
	if (!build.success) throw new AggregateError(build.logs, "ORT format experiment worker failed to bundle")
}
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch: (request) =>
		new Response(new URL(request.url).pathname === "/ort" ? converted : model, {
			headers: { "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin" },
		}),
})
const executable = await chromeExecutable()
const view = new Bun.WebView({
	backend: {
		type: "chrome",
		url: false,
		...(executable ? { path: executable } : {}),
		argv: [...chromeTestProfileArguments, `--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
	},
	dataStore: "ephemeral",
})
interface Sample {
	variant: string
	round: number
	pcm: string
	words: unknown
	loadMs: number
	firstBufferMs: number
	[key: string]: unknown
}
interface Evaluation {
	result: { value: Sample }
	exceptionDetails?: { text: string; exception?: { description?: string } }
}
try {
	await view.navigate(`chrome-extension://${chromeExtensionId(extension)}/voices.html`)
	const results: Omit<Sample, "pcm">[] = []
	let reference: Float32Array | undefined
	let referenceWords: string | undefined
	for (let round = 0; round < 2; round++)
		for (const variant of round ? [...variants].reverse() : variants) {
			const result = await view.cdp<Evaluation>("Runtime.evaluate", {
				expression: `(async()=>{
				const model=await(await fetch(${JSON.stringify(server.url.href)}+'${variant.format}')).arrayBuffer();
				const started=performance.now();
				const worker=new Worker(chrome.runtime.getURL('runtime/cpu/${variant.id}.js'),{type:'module'});
				let sequence=0;const pending=new Map();
				worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.ok?p.resolve(data):p.reject(Error(data.error))};
				worker.onerror=event=>{for(const p of pending.values())p.reject(Error(event.message));pending.clear()};
				const rpc=(message,transfer=[])=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});worker.postMessage({...message,id},transfer)});
				try {
					const loaded=await rpc({type:'load',voice:'en_US-ljspeech-medium',speaker:0,config:${JSON.stringify(config)},model},[model]);
					const loadMs=performance.now()-started;
					const clip=await rpc({type:'synthesize',text:'Fresh words start a new selection.',speed:1,speaker:0});
					const firstBufferMs=performance.now()-started;
					if(!clip.pcm.every(Number.isFinite))throw Error('Non-finite output');
					return {variant:'${variant.id}',round:${round},...loaded.timings,loadMs,firstBufferMs,samples:clip.pcm.length,sampleRate:clip.sampleRate,pcm:new Uint8Array(clip.pcm.buffer).toBase64(),words:clip.words};
				}finally{worker.terminate()}
			})()`,
				awaitPromise: true,
				returnByValue: true,
			})
			if (result.exceptionDetails)
				throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
			const { pcm: encoded, ...sample } = result.result.value
			const bytes = Uint8Array.fromBase64(encoded)
			const pcm = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)
			reference ??= pcm
			referenceWords ??= JSON.stringify(sample.words)
			let maxAbsoluteDifference = 0
			if (pcm.length !== reference.length) throw new Error("Prepared voice changed output length")
			for (let index = 0; index < pcm.length; index++)
				maxAbsoluteDifference = Math.max(maxAbsoluteDifference, Math.abs(pcm[index]! - reference[index]!))
			const wordsIdentical = JSON.stringify(sample.words) === referenceWords
			const pcmHash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
			results.push({ ...sample, pcmHash, maxAbsoluteDifference, wordsIdentical })
			console.log(JSON.stringify({ ...sample, pcmHash, maxAbsoluteDifference, wordsIdentical }))
		}
	await Bun.write(
		`${projectRoot}/docs/evidence/ort-format-2026-11-03.json`,
		JSON.stringify(
			{
				recordedAt: new Date().toISOString(),
				browser: await view.cdp("Browser.getVersion"),
				voice: "en_US-ljspeech-medium",
				bunVersion: Bun.version,
				nativeVersion: "1.31.1",
				packageUrl,
				packageIntegrity: integrity,
				packageLicense: "MIT",
				nativeConvertMs,
				onnxBytes: model.byteLength,
				ortBytes: converted.byteLength,
				sourceSha256: new Bun.CryptoHasher("sha256").update(raw).digest("hex"),
				ortSha256: new Bun.CryptoHasher("sha256").update(converted).digest("hex"),
				parityVerified: results.every((sample) => sample.wordsIdentical === true && sample.maxAbsoluteDifference === 0),
				results,
				limits:
					"Maintainer experiment in a Linux x64 VM, never an extension dependency. Upstream prebuilt N-API6 binding loaded directly by Bun; no Node/Python executable, install scripts, root dependency or lock changes. Portable basic graph optimization, CPU provider, instrumented duration output retained. ORT read variants compare basic versus disabled runtime optimization and explicit prepacking enabled (0) versus disabled (1); enabled is equivalent to the runtime default. CPU browser samples use fresh workers and the copied production manifest; two rotated rounds. Fixture fetch and maintainer conversion excluded from firstBufferMs, which includes worker startup, ORT initialization, real session creation, phonemizer and first synthesis. Noise disabled only to compare deterministic PCM and aligned word records. This does not establish audible quality, physical GPU, Firefox, Windows, full catalog, storage-read or target-device acceptance. MIT runtime and separate third-party notices are retained in vendor/onnxruntime; model obligations remain separate. No prepared artifact is published by this script.",
			},
			null,
			2,
		) + "\n",
	)
	if (!results.every((sample) => sample.wordsIdentical === true && sample.maxAbsoluteDifference === 0))
		throw new Error("Prepared voice changed deterministic PCM or word alignment; inspect the recorded evidence")
} finally {
	view.close()
	server.stop(true)
}
