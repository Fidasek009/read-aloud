// Narrow, fail-closed adaptations of the pinned upstream distributions.
// Keep upstream files in node_modules intact; package only local executable URLs.
export function replaceOnce(source: string, before: string, after: string): string {
	if (source.split(before).length !== 2) throw new Error(`Runtime adapter no longer matches: ${before.slice(0, 90)}`)
	return source.replace(before, after)
}

export function adaptOrtImports(source: string, backend: "wasm" | "webgpu") {
	const filename = `ort-wasm-simd-threaded${backend === "wasm" ? "" : ".asyncify"}.mjs`
	const path = `../ort/${backend}/${filename}`
	const match = /await import\(([a-zA-Z_$][\w$]*)\)/u.exec(source)
	if (!match) throw new Error("ONNX module import no longer matches")
	return replaceOnce(
		source,
		match[0],
		`await (${match[1]} === new URL(${JSON.stringify(path)}, import.meta.url).href ? import(${JSON.stringify(path)}) : Promise.reject(new Error("Unpackaged ONNX runtime URL")))`,
	)
}

// Equivalent to Emscripten's Emval method caller without compiling JS strings.
// Names refer to the pinned 1.31.1 asyncify distribution, not first-party globals.
export const emvalCaller = `function Pb(a,b,c) {
  var [d,...e]=Xg(a,b>>>0);
  var toWire=d.kd.bind(d), fromWire=e.map(t=>t.jd.bind(t));
  var caller=function(handle,methodName,destructorsRef,args) {
    var receiver, target;
    if(c===0 || c===2) target=R(handle);
    else if(c===1) { receiver=R(handle); target=receiver[$g(methodName)]; }
    var values=fromWire.map((convert,index)=>convert(args+8*index));
    var result;
    switch(c) {
      case 0: result=Reflect.apply(target,undefined,values); break;
      case 1: result=Reflect.apply(target,receiver,values); break;
      case 2: result=Reflect.construct(target,values); break;
      case 3: result=values[values.length-1]; break;
      default: throw new Error("Unknown Emval call kind");
    }
    if(!d.Ee) return Yg(toWire,destructorsRef,result);
  };
  return Wg(Object.defineProperty(caller,"name",{value:\`methodCaller<($\{e.map(t=>t.name)}) => $\{d.name}>\` }));
}`

export function adaptOrtBindings(source: string) {
	const start = source.indexOf("function Pb(a,b,c){")
	const end = source.indexOf("function Rb(a,b)", start)
	if (start < 0 || end < 0 || !source.slice(start, end).includes("new Function"))
		throw new Error("ONNX Emval adapter no longer matches")
	if (
		new Bun.CryptoHasher("sha256").update(source.slice(start, end)).digest("hex") !==
		"96934589e853208c2899920357621e9e998bb449dc2a0f7dea9db2d01dc02e48"
	)
		throw new Error("ONNX Emval source changed; review the adapter before building")
	return source.slice(0, start) + emvalCaller + source.slice(end)
}

export function adaptPdfMain(source: string) {
	return replaceOnce(
		source,
		"/*@vite-ignore*/\n      this.workerSrc",
		'/*@vite-ignore*/\n      "/pdf-runtime/pdf.worker.mjs"',
	)
}

export function adaptPdfWorker(source: string) {
	return replaceOnce(
		source,
		"await import(\n    /*webpackIgnore: true*/\n    /*@vite-ignore*/\n    `${WasmImage.#wasmUrl}${this._noWasmFilename}`)",
		`(this._noWasmFilename === "jbig2_nowasm_fallback.js"
        ? await import("./wasm/jbig2_nowasm_fallback.js")
        : this._noWasmFilename === "openjpeg_nowasm_fallback.js"
          ? await import("./wasm/openjpeg_nowasm_fallback.js")
          : (() => { throw new Error("Unknown PDF decoder"); })())`,
	)
}
