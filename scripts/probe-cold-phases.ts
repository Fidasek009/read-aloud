/** Development-only: distinguish ORT runtime initialization from a large voice session. */
import protobuf from "protobufjs"

import { instrumentModel } from "../src/speech/instrument.ts"
import {
	chromeExtensionId,
	closeChromeProbe,
	copyProbeExtension,
	createChromeProbe,
	projectRoot,
} from "./probe-helpers.ts"

const extension = `${projectRoot}/.cache/cold-phases-probe`
await copyProbeExtension("chrome", extension)

const schema = protobuf.parse(await Bun.file(`${projectRoot}/vendor/onnx/onnx.proto3`).text()).root
const Model = schema.lookupType("onnx.ModelProto")
const tiny = Model.encode(
	Model.create({
		irVersion: 7,
		opsetImport: [{ domain: "", version: 13 }],
		graph: {
			name: "cold-phase-identity",
			node: [{ name: "identity", opType: "Identity", input: ["x"], output: ["y"] }],
			input: [{ name: "x", type: { tensorType: { elemType: 1, shape: { dim: [{ dimValue: 1 }] } } } }],
			output: [{ name: "y", type: { tensorType: { elemType: 1, shape: { dim: [{ dimValue: 1 }] } } } }],
		},
	}),
)
	.finish()
	.toBase64()
const source = await Bun.file(`${projectRoot}/src/speech/worker.ts`).text()
const anchor = `const modelSession = (async () => {\n\t\t\t\tconst began = performance.now()`
if (!source.includes(anchor)) throw new Error("Worker session timing boundary changed; update this development probe")
const split = source.replace(
	anchor,
	`const modelSession = (async () => {
				const runtimeStarted = performance.now()
				const tiny = await ort.InferenceSession.create(Uint8Array.fromBase64(${JSON.stringify(tiny)}), {
					executionProviders: [SPEECH_BACKEND], graphOptimizationLevel: "basic",
					extra: { session: { disable_prepacking: "1" } },
				})
				await tiny.release()
				timings.runtimeAndTinySessionMs = performance.now() - runtimeStarted
				const began = performance.now()`,
)
for (const [variant, contents] of [
	["baseline", source],
	["split", split],
] as const) {
	const build = await Bun.build({
		entrypoints: [`${projectRoot}/src/speech/worker.ts`],
		outdir: `${extension}/runtime/cpu`,
		naming: `${variant}.js`,
		format: "esm",
		target: "browser",
		define: { SPEECH_BACKEND: '"wasm"' },
		plugins: [
			{
				name: "cold-phase-experiment",
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
	if (!build.success) throw new AggregateError(build.logs, "Cold-phase probe failed to bundle")
}
const fixture = `${projectRoot}/.cache/piper/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx`
const raw = await Bun.file(fixture).arrayBuffer()
const model = instrumentModel(raw)
const config = await Bun.file(`${fixture}.json`).json()
// Compare deterministic CPU outputs; this is not an audible quality test.
config.inference.noise_scale = 0
config.inference.noise_w = 0
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch: () =>
		new Response(model, {
			headers: { "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin" },
		}),
})
const view = await createChromeProbe(extension)
interface Evaluation {
	result: {
		value: {
			variant: string
			round: number
			loadMs: number
			firstBufferMs: number
			pcmHash: string
			[key: string]: unknown
		}
	}
	exceptionDetails?: { text: string; exception?: { description?: string } }
}
try {
	await view.navigate(`chrome-extension://${chromeExtensionId(extension)}/voices.html`)
	const results: Evaluation["result"]["value"][] = []
	for (let round = 0; round < 2; round++)
		for (const variant of round ? ["split", "baseline"] : ["baseline", "split"]) {
			const result = await view.cdp<Evaluation>("Runtime.evaluate", {
				expression: `(async()=>{
				const model=await(await fetch(${JSON.stringify(server.url.href)})).arrayBuffer();
				const started=performance.now();
				const worker=new Worker(chrome.runtime.getURL('runtime/cpu/${variant}.js'),{type:'module'});
				let sequence=0;const pending=new Map();
				worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.ok?p.resolve(data):p.reject(Error(data.error))};
				worker.onerror=event=>{for(const p of pending.values())p.reject(Error(event.message));pending.clear()};
				const rpc=(message,transfer=[])=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});worker.postMessage({...message,id},transfer)});
				try {
					const loaded=await rpc({type:'load',voice:'en_US-ljspeech-medium',speaker:0,config:${JSON.stringify(config)},model},[model]);
					const loadMs=performance.now()-started;
					const speechStarted=performance.now();
					const clip=await rpc({type:'synthesize',text:'Fresh words start a new selection.',speed:1,speaker:0});
					const firstBufferMs=performance.now()-started;
					if(!clip.pcm.every(Number.isFinite))throw Error('Non-finite output');
					const digest=await crypto.subtle.digest('SHA-256',clip.pcm.buffer);
					const pcmHash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
					return {variant:'${variant}',round:${round},...loaded.timings,loadMs,firstBufferMs,synthesisMs:firstBufferMs-(speechStarted-started),pcmHash,samples:clip.pcm.length,words:clip.words.length};
				}finally{worker.terminate()}
			})()`,
				awaitPromise: true,
				returnByValue: true,
			})
			if (result.exceptionDetails)
				throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
			results.push(result.result.value)
			console.log(JSON.stringify(result.result.value))
		}
	if (new Set(results.map((result) => result.pcmHash)).size !== 1)
		throw new Error("Deterministic baseline and split outputs differ")
	await Bun.write(
		`${projectRoot}/docs/evidence/cold-phases-2026-11-03.json`,
		JSON.stringify(
			{
				recordedAt: new Date().toISOString(),
				browser: await view.cdp("Browser.getVersion"),
				voice: "en_US-ljspeech-medium",
				modelSha256: new Bun.CryptoHasher("sha256").update(raw).digest("hex"),
				results,
				limits:
					"Development VM, fresh CPU worker per sample, two rotated rounds. Existing production extension manifest; no experimental isolation or hardware changes. Fixture fetch and model instrumentation occur before worker load timing, while worker construction, all tiny-session initialization, phonemizer initialization, real model session creation and first synthesis remain in firstBufferMs. runtimeAndTinySessionMs includes ORT/WASM initialization plus creation/release of a tiny Identity session; it is an upper bound on runtime-only initialization, not a pure WASM-compilation measure. sessionMs in split samples measures the real model session after runtime initialization; baseline sessionMs includes both. Noise disabled to check exact CPU output equivalence. No audible quality, physical GPU, Firefox, Windows or target-device acceptance established.",
			},
			null,
			2,
		) + "\n",
	)
} finally {
	await closeChromeProbe(view)
	server.stop(true)
}
