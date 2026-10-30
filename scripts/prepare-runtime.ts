import { $ } from "bun"

const root = import.meta.dir.replace(/\/scripts$/, "")
const out = `${root}/public/runtime`
await $`rm -rf ${out}`.quiet()
await $`mkdir -p ${out}`.quiet()
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
	const name = `ort-wasm-simd-threaded${backend === "wasm" ? "" : ".asyncify"}`
	for (const suffix of ["mjs", "wasm"])
		await Bun.write(
			`${out}/ort/${backend}/${name}.${suffix}`,
			Bun.file(`${root}/node_modules/onnxruntime-web/dist/${name}.${suffix}`),
		)
}
const phonemizer = `${root}/node_modules/@spelling-creator/spellophone`
await $`cp -R ${phonemizer + "/espeak-ng-data"} ${out + "/espeak-ng-data"}`.quiet()
await Bun.write(`${out}/espeak-ng.wasm`, Bun.file(`${phonemizer}/wasm/espeak-ng.wasm`))
for (const [source, target] of [
	[`${phonemizer}/LICENSE`, "spellophone-GPL-3.0.txt"],
	[`${root}/vendor/onnxruntime/LICENSE`, "onnxruntime-MIT.txt"],
	[`${root}/vendor/onnxruntime/ThirdPartyNotices.txt`, "onnxruntime-third-party.txt"],
	[`${root}/vendor/onnx/LICENSE`, "onnx-Apache-2.0.txt"],
] as const)
	await Bun.write(`${out}/licenses/${target}`, Bun.file(source))
console.log("Prepared bundled local speech runtimes. No voice models were downloaded.")
const pdf = `${root}/node_modules/pdfjs-dist`
const pdfOut = `${root}/public/pdf-runtime`
await $`rm -rf ${pdfOut}`.quiet()
await $`mkdir -p ${pdfOut}`.quiet()
await Bun.write(`${pdfOut}/pdf.worker.mjs`, Bun.file(`${pdf}/build/pdf.worker.mjs`))
await Bun.write(`${pdfOut}/LICENSE`, Bun.file(`${pdf}/LICENSE`))
for (const folder of ["cmaps", "standard_fonts", "wasm", "iccs"])
	await $`cp -R ${pdf + "/" + folder} ${pdfOut + "/" + folder}`.quiet()
