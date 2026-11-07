import { expect, test } from "bun:test"
import { runInNewContext } from "node:vm"

import { adaptOrtBindings, adaptOrtImports, adaptPdfMain, adaptPdfWorker } from "../scripts/runtime-adapters"

const ort = await Bun.file("node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs").text()
const original = ort.slice(ort.indexOf("function Pb(a,b,c){"), ort.indexOf("function Rb(a,b)"))
const adapted = adaptOrtBindings(ort)
const replacement = adapted.slice(adapted.indexOf("function Pb("), adapted.indexOf("function Rb(a,b)"))

function invoke(source: string, kind: number, voidReturn: boolean, throws: boolean) {
	const events: unknown[] = []
	const receiver = {
		factor: 3,
		method(this: { factor: number }, a: number, b: number) {
			events.push(["call", this?.factor, a, b])
			if (throws) throw new Error("binding failure")
			return (this?.factor ?? 1) * (a + b)
		},
	}
	function Constructor(this: { value: number }, a: number, b: number) {
		this.value = a + b
	}
	const context = {
		Xg: () => [
			{ name: "result", Ee: voidReturn, kd: (value: unknown) => value },
			...[0, 1].map((i) => ({
				name: `arg${i}`,
				jd: (pointer: number) => {
					events.push(["convert", i, pointer])
					return pointer
				},
			})),
		],
		R: () => (kind === 1 ? receiver : kind === 2 ? Constructor : receiver.method),
		$g: () => "method",
		Yg: (convert: (v: unknown) => unknown, ref: number, value: unknown) => {
			events.push(["return", ref])
			return convert(value)
		},
		Wg: (fn: (...args: number[]) => unknown) => fn,
	}
	try {
		const fn = runInNewContext(`${source}; Pb(3,0,${kind})`, context)
		return { value: JSON.stringify(fn(1, 2, 3, 16)), events, name: fn.name }
	} catch (error) {
		return { error: (error as Error).message, events }
	}
}

for (const kind of [0, 1, 2, 3])
	for (const voidReturn of [false, true])
		for (const throws of [false, true])
			test(`eval-free Emval matches upstream: kind ${kind}, void ${voidReturn}, throw ${throws}`, () => {
				expect(invoke(replacement, kind, voidReturn, throws)).toEqual(invoke(original, kind, voidReturn, throws))
			})

test("runtime adaptations fail closed on changed upstream and remove variable imports", async () => {
	expect(adapted).not.toContain("new Function")
	expect(() => adaptOrtBindings("changed upstream")).toThrow()
	for (const backend of ["wasm", "webgpu"] as const) {
		const source = await Bun.file(`public/runtime/${backend === "wasm" ? "cpu" : "gpu"}/speech.js`).text()
		expect(source).not.toContain("await import(e)")
		expect(() => adaptOrtImports("changed upstream", backend)).toThrow()
	}
	const worker = adaptPdfWorker(await Bun.file("node_modules/pdfjs-dist/build/pdf.worker.mjs").text())
	expect(worker).toContain('await import("./wasm/jbig2_nowasm_fallback.js")')
	expect(worker).not.toContain("${this._noWasmFilename}")
	const pdf = adaptPdfMain(await Bun.file("node_modules/pdfjs-dist/build/pdf.mjs").text())
	expect(pdf).not.toContain("/*@vite-ignore*/\n      this.workerSrc")
})
