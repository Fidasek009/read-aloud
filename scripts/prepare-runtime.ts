const root = Bun.fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/u, "")
const out = `${root}/public/runtime`
const expected = new Map<string, Set<string>>()
let copied = 0
let reused = 0

// Runtime binaries are large. Preserve identical files across dev and release
// builds rather than deleting and copying the entire runtime on every rebuild.
async function copyAsset(source: string, target: string, directory: string) {
	const files = expected.get(directory) ?? new Set<string>()
	expected.set(directory, files)
	files.add(target.slice(directory.length + 1))
	const input = Bun.file(source)
	const output = Bun.file(target)
	if (await output.exists()) {
		if (input.size === output.size && Bun.hash(await input.arrayBuffer()) === Bun.hash(await output.arrayBuffer())) {
			reused++
			return
		}
	}
	await Bun.write(target, input)
	copied++
}

async function copyDirectory(source: string, target: string, directory: string) {
	for await (const file of new Bun.Glob("**/*").scan({ cwd: source, onlyFiles: true, dot: true }))
		await copyAsset(`${source}/${file}`, `${target}/${file}`, directory)
}

async function removeStaleAssets(directory: string) {
	const files = expected.get(directory)!
	for await (const file of new Bun.Glob("**/*").scan({ cwd: directory, onlyFiles: true, dot: true }))
		if (!files.has(file)) await Bun.file(`${directory}/${file}`).delete()
}
const instrumentation = await Bun.build({
	entrypoints: [`${root}/src/speech/instrument-worker.ts`],
	outdir: out,
	naming: "instrument.js",
	target: "browser",
	format: "esm",
})
if (!instrumentation.success) throw new AggregateError(instrumentation.logs, "Voice preparation worker bundling failed")
expected.set(out, new Set(["instrument.js"]))
for (const [directory, backend, runtime] of [
	["cpu", "wasm", "wasm"],
	["gpu", "webgpu", "webgpu"],
] as const) {
	const result = await Bun.build({
		entrypoints: [`${root}/src/speech/worker.ts`],
		outdir: `${out}/${directory}`,
		naming: "speech.js",
		target: "browser",
		format: "esm",
		define: { SPEECH_BACKEND: JSON.stringify(backend) },
		plugins: [
			{
				name: "speech-runtime",
				setup(build) {
					build.onResolve({ filter: /^onnxruntime-web$/ }, () => ({
						path: `${root}/node_modules/onnxruntime-web/dist/ort.${runtime}.min.mjs`,
					}))
				},
			},
		],
	})
	if (!result.success) throw new AggregateError(result.logs, "Speech worker bundling failed")
	expected.get(out)!.add(`${directory}/speech.js`)
	const name = `ort-wasm-simd-threaded${backend === "wasm" ? "" : ".asyncify"}`
	for (const suffix of ["mjs", "wasm"])
		await copyAsset(
			`${root}/node_modules/onnxruntime-web/dist/${name}.${suffix}`,
			`${out}/ort/${backend}/${name}.${suffix}`,
			out,
		)
}
const phonemizer = `${root}/node_modules/@spelling-creator/spellophone`
await copyDirectory(`${phonemizer}/espeak-ng-data`, `${out}/espeak-ng-data`, out)
await copyAsset(`${phonemizer}/wasm/espeak-ng.wasm`, `${out}/espeak-ng.wasm`, out)
for (const [source, target] of [
	[`${phonemizer}/LICENSE`, "spellophone-GPL-3.0.txt"],
	[`${root}/vendor/onnxruntime/LICENSE`, "onnxruntime-MIT.txt"],
	[`${root}/vendor/onnxruntime/ThirdPartyNotices.txt`, "onnxruntime-third-party.txt"],
	[`${root}/vendor/onnx/LICENSE`, "onnx-Apache-2.0.txt"],
] as const)
	await copyAsset(source, `${out}/licenses/${target}`, out)
const pdf = `${root}/node_modules/pdfjs-dist`
const pdfOut = `${root}/public/pdf-runtime`
await copyAsset(`${pdf}/LICENSE`, `${pdfOut}/LICENSE`, pdfOut)
for (const folder of ["cmaps", "standard_fonts", "wasm", "iccs"])
	await copyDirectory(`${pdf}/${folder}`, `${pdfOut}/${folder}`, pdfOut)
await removeStaleAssets(out)
await removeStaleAssets(pdfOut)
console.log(`Prepared local runtimes: ${copied} assets copied, ${reused} unchanged. No voice models were downloaded.`)
