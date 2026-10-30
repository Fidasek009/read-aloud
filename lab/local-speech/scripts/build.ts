import { $ } from "bun"

import { assetRoot, engine, lock, outputRoot, resolve, root, verify } from "./assets.ts"

const output = outputRoot
for (const asset of lock.files) {
	if (!(await verify(resolve(assetRoot, asset.path), asset))) {
		throw new Error(`Missing or invalid ${asset.path}; run bun run assets explicitly`)
	}
}
await $`rm -rf ${output}`.quiet()
await $`mkdir -p ${output}`.quiet()
const bundled = await Bun.build({
	entrypoints: [
		resolve(root, "src/page.ts"),
		resolve(root, engine === "piper" ? "src/piper/worker.ts" : "src/worker.ts"),
	],
	outdir: output,
	naming: "[name].js",
	format: "esm",
	target: "browser",
	conditions: ["onnxruntime-web-use-extern-wasm"],
	plugins: [
		{
			name: "packaged-onnx-runtime",
			setup(build) {
				build.onResolve({ filter: /^onnxruntime-web$/ }, () => ({
					path: Bun.resolveSync(
						resolve(root, `node_modules/onnxruntime-web/dist/ort.${Bun.env.BUN_LAB_RUNTIME ?? "webgpu"}.min.mjs`),
						root,
					),
				}))
			},
		},
		{
			name: "browser-only-phonemizer",
			setup(build) {
				build.onResolve({ filter: /^(fs|path|url)$/ }, ({ path }) => ({ path, namespace: "unused-runtime" }))
				build.onLoad({ filter: /.*/, namespace: "unused-runtime" }, () => ({
					contents: "export default undefined",
					loader: "js",
				}))
			},
		},
	],
})
if (!bundled.success) throw new AggregateError(bundled.logs, "Lab bundling failed")
await Bun.write(resolve(output, "probe.html"), Bun.file(resolve(root, "src/probe.html")))
for (const asset of lock.files) {
	const destination = resolve(output, "models", asset.path)
	await $`mkdir -p ${destination.slice(0, destination.lastIndexOf("/"))}`.quiet()
	await Bun.write(destination, Bun.file(resolve(assetRoot, asset.path)))
}
if (engine === "piper") {
	await $`cp -R ${resolve(assetRoot, "timed")} ${resolve(output, "models/timed")}`.quiet()
	const spellophone = resolve(root, "node_modules/@spelling-creator/spellophone")
	await $`cp -R ${resolve(spellophone, "espeak-ng-data")} ${resolve(output, "espeak-ng-data")}`.quiet()
	await Bun.write(resolve(output, "espeak-ng.wasm"), Bun.file(resolve(spellophone, "wasm/espeak-ng.wasm")))
}
const runtimeSource = resolve(root, "node_modules/onnxruntime-web/dist")
await $`mkdir -p ${resolve(output, "runtime")}`.quiet()
for await (const file of new Bun.Glob("ort-wasm-simd-threaded*.{mjs,wasm}").scan(runtimeSource)) {
	await Bun.write(resolve(output, "runtime", file), Bun.file(resolve(runtimeSource, file)))
}
const manifest = {
	manifest_version: 3,
	name: "Local speech feasibility lab",
	version: "0.0.0",
	description: "Developer experiment; no page access, analytics, or cloud speech.",
	content_security_policy: {
		extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; connect-src 'self'; worker-src 'self'",
	},
	cross_origin_embedder_policy: { value: "require-corp" },
	cross_origin_opener_policy: { value: "same-origin" },
}
await Bun.write(resolve(output, "background.js"), "chrome.runtime.onInstalled.addListener(() => {});\n")
await Bun.write(
	resolve(output, "background-firefox.js"),
	'browser.runtime.onInstalled.addListener(() => browser.tabs.create({url: browser.runtime.getURL("probe.html")}));\n',
)
for (const browser of ["chromium", "firefox"]) {
	const directory = resolve(output, browser)
	await $`mkdir -p ${directory}`.quiet()
	for (const file of [
		"page.js",
		"worker.js",
		"probe.html",
		"background.js",
		"background-firefox.js",
		"runtime",
		"models",
		...(engine === "piper" ? ["espeak-ng-data", "espeak-ng.wasm"] : []),
	]) {
		await $`cp -R ${resolve(output, file)} ${resolve(directory, file)}`.quiet()
	}
	const licenses = resolve(directory, "licenses")
	await $`mkdir -p ${licenses}`.quiet()
	for (const [source, target] of [
		[resolve(root, "vendor/LICENSE"), "supertonic-code.txt"],
		[resolve(assetRoot, "LICENSE"), "supertonic-weights.txt"],
		[resolve(root, "vendor/onnxruntime-LICENSE"), "onnxruntime.txt"],
		[resolve(root, "vendor/onnxruntime-ThirdPartyNotices.txt"), "onnxruntime-third-party.txt"],
	] as const)
		if (engine !== "piper" || !target.startsWith("supertonic"))
			await Bun.write(resolve(licenses, target), Bun.file(source))
	if (engine === "piper") await $`cp -R ${resolve(root, "vendor/piper")} ${resolve(licenses, "piper")}`.quiet()
	const specific =
		browser === "chromium"
			? { background: { service_worker: "background.js" } }
			: {
					background: { scripts: ["background-firefox.js"] },
					browser_specific_settings: {
						gecko: {
							id: "local-inference-lab@example.invalid",
							strict_min_version: "140.0",
							data_collection_permissions: { required: ["none"] },
						},
					},
				}
	await Bun.write(resolve(directory, "manifest.json"), JSON.stringify({ ...manifest, ...specific }, null, 2) + "\n")
}
const runtime = await Bun.file(resolve(root, "node_modules/onnxruntime-web/package.json")).json()
await Bun.write(
	resolve(output, "build-info.json"),
	JSON.stringify(
		{
			toolchain: `Bun ${Bun.version}`,
			engine,
			runtime: Bun.env.BUN_LAB_RUNTIME ?? "webgpu",
			versions: { "onnxruntime-web": runtime.version },
			model: lock.model,
			revision: lock.revision,
			voice: lock.voice,
			assets: lock.files,
		},
		null,
		2,
	) + "\n",
)
console.log(`Built isolated lab extensions: ${output}/{chromium,firefox}`)
