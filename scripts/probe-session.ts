import { $ } from "bun"

import type { VoiceConfig } from "../src/speech/catalog.ts"

import { instrumentModel } from "../src/speech/instrument.ts"

const root = import.meta.dir.replace(/\/scripts$/, "")
const out = `${root}/.cache/session-probe`
await $`rm -rf ${out}`.quiet()
await $`mkdir -p ${out}`.quiet()
await $`cp -R ${root + "/.output/chrome-mv3/."} ${out}`.quiet()
const manifest = await Bun.file(`${out}/manifest.json`).json()
manifest.cross_origin_embedder_policy = { value: "require-corp" }
manifest.cross_origin_opener_policy = { value: "same-origin" }
await Bun.write(`${out}/manifest.json`, JSON.stringify(manifest))
const source = await Bun.file(`${root}/src/speech/worker.ts`).text()
const variants = [
	{ id: "basic-prepack", optimization: "basic", disable: "0" },
	{ id: "basic-no-prepack", optimization: "basic", disable: "1" },
	{ id: "disabled-no-prepack", optimization: "disabled", disable: "1" },
	{ id: "all-no-prepack", optimization: "all", disable: "1" },
] as const
for (const variant of variants) {
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
					builder.onLoad({ filter: /\/src\/speech\/worker.ts$/ }, () => ({
						contents: source
							.replace('graphOptimizationLevel: "basic"', `graphOptimizationLevel: "${variant.optimization}"`)
							.replace('disable_prepacking: "1"', `disable_prepacking: "${variant.disable}"`),
						loader: "ts",
						resolveDir: `${root}/src/speech`,
					}))
					builder.onResolve({ filter: /^onnxruntime-web$/ }, () => ({
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
if (!(await model.exists())) throw new Error("Provision the instrumented LJSpeech fixture first")
const config = (await Bun.file(`${root}/src/speech/configs/en_US-ljspeech-medium.json`).json()) as VoiceConfig
const bytes = instrumentModel(await model.arrayBuffer())
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch: () =>
		new Response(bytes, {
			headers: { "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin" },
		}),
})
const candidates = await Array.fromAsync(
	new Bun.Glob("chromium-*/chrome-linux*/chrome").scan({ cwd: `${Bun.env.HOME}/.cache/ms-playwright`, absolute: true }),
)
const view = new Bun.WebView({
	backend: {
		type: "chrome",
		url: false,
		path: Bun.env.BUN_CHROME_PATH ?? candidates.sort().at(-1)!,
		argv: [`--disable-extensions-except=${out}`, `--load-extension=${out}`],
	},
	dataStore: "ephemeral",
})
try {
	await view.navigate("about:blank")
	const id = [...new Bun.CryptoHasher("sha256").update(out).digest("hex").slice(0, 32)]
		.map((d) => String.fromCharCode(97 + parseInt(d, 16)))
		.join("")
	await view.navigate(`chrome-extension://${id}/voices.html`)
	await view.cdp("Runtime.enable")
	const results = []
	for (const variant of variants) {
		const expression = `(async()=>{
   const model=await(await fetch(${JSON.stringify(server.url.href)})).arrayBuffer();
   const worker=new Worker(chrome.runtime.getURL('runtime/cpu/${variant.id}.js'),{type:'module'});
   let sequence=0;const pending=new Map();worker.onmessage=({data})=>{const p=pending.get(data.id);if(!p)return;pending.delete(data.id);data.ok?p.resolve(data):p.reject(Error(data.error))};
   const rpc=(message,transfer=[])=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});worker.postMessage({...message,id},transfer)});
   const started=performance.now();try {
    const loaded=await rpc({type:'load',voice:'en_US-ljspeech-medium',config:${JSON.stringify(config)},model},[model]);
    const loadMs=performance.now()-started;const speechStarted=performance.now();const clip=await rpc({type:'synthesize',text:'Fresh words start a new selection.',speed:1});
    return {id:'${variant.id}',...loaded.timings,loadMs,synthesisMs:performance.now()-speechStarted,firstBufferMs:performance.now()-started,durationSeconds:clip.pcm.length/clip.sampleRate,finite:clip.pcm.every(Number.isFinite)};
   }finally{worker.terminate()}
  })()`
		const result = await view.cdp<any>("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
		if (result.exceptionDetails)
			throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
		results.push(result.result.value)
		console.log(JSON.stringify(result.result.value))
	}
	await Bun.write(
		`${root}/docs/evidence/session-loading-2026-10-30.json`,
		JSON.stringify(
			{
				recordedAt: new Date().toISOString(),
				browser: await view.cdp("Browser.getVersion"),
				results,
				limits:
					"Development VM, extension top-level document with experimental COOP/COEP manifest. Does not establish isolation or multicore behavior in embedded production controls or Firefox. Local cached model; first variant includes first ORT WASM compilation.",
			},
			null,
			2,
		) + "\n",
	)
} finally {
	view.close()
	server.stop(true)
}
