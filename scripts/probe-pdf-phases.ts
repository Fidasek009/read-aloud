import { type FixtureRequest, startFixtureServer } from "./probe-fixture-server.ts"
/** Development-only phase timing of the production PDF pipeline, with/without visible rendering. */
import {
	chromeExecutable,
	chromeExtensionId,
	chromeTestProfileArguments,
	copyProbeExtension,
	projectRoot,
	waitFor,
} from "./probe-helpers.ts"

const extension = `${projectRoot}/.cache/pdf-phases-probe`
await copyProbeExtension("chrome", extension)
let source = await Bun.file(`${projectRoot}/src/entrypoints/pdf/main.ts`).text()
const edits: [string, string][] = [
	[
		"async function load() {",
		"async function load() {\n pdfMetrics.started=performance.now(); pdfMetrics.startedAt=Date.now()",
	],
	[
		"const response = await fetchPdf(url, lifecycle.signal)",
		"const fetchStarted=performance.now(); const response = await fetchPdf(url, lifecycle.signal); const headersReady=performance.now(); pdfMetrics.headersMs+=headersReady-fetchStarted",
	],
	[
		"const candidate = new Uint8Array(await response.arrayBuffer())",
		"const candidate = new Uint8Array(await response.arrayBuffer()); pdfMetrics.fetchMs+=performance.now()-fetchStarted; pdfMetrics.bodyMs+=performance.now()-headersReady",
	],
	[
		"const task = getDocument({",
		"const documentStarted=performance.now(); pdfMetrics.pdfBytes=bytes.byteLength; const task = getDocument({",
	],
	[
		"const pdf = await task.promise",
		"const pdf = await task.promise; pdfMetrics.documentMs=performance.now()-documentStarted",
	],
	[
		"const page = await pdf.getPage(n)",
		"const pageStarted=performance.now(); const page = await pdf.getPage(n); const pageReady=performance.now()",
	],
	[
		"const content = await page.getTextContent()",
		"const domReady=performance.now(); const content = await page.getTextContent(); const textReady=performance.now()",
	],
	[
		"observer.observe(section)",
		`pdfMetrics.pages.push({page:n,getPageMs:pageReady-pageStarted,domMs:domReady-pageReady,getTextContentMs:textReady-domReady,buildRunsMs:performance.now()-textReady,at:performance.now()-pdfMetrics.started}); if(new URLSearchParams(location.search).get('probe')!=='extraction-only')observer.observe(section)`,
	],
	[
		"complete = normalizeDocument(result, true)",
		"const normalizeStarted=performance.now(); complete = normalizeDocument(result, true); pdfMetrics.normalizeMs=performance.now()-normalizeStarted; pdfMetrics.characters=complete.text.length; pdfMetrics.runs=complete.runs.length",
	],
	[
		'if (!initial && allowStart && alive) await start("article")',
		'if (!initial && allowStart && alive) await start("article"); pdfMetrics.readyMs=performance.now()-pdfMetrics.started; pdfMetrics.done=true',
	],
	["state.container.replaceChildren()", "const textLayerStarted=performance.now(); state.container.replaceChildren()"],
	[
		"invalidateSelectionIndex(complete)\n\t})().catch",
		"invalidateSelectionIndex(complete); pdfMetrics.textLayers.push({page:state.page.pageNumber,ms:performance.now()-textLayerStarted,at:performance.now()-pdfMetrics.started})\n\t})().catch",
	],
	["item.task = item.page.render({", "const renderStarted=performance.now(); item.task = item.page.render({"],
	[
		"await item.task.promise",
		"await item.task.promise; pdfMetrics.renders.push({page:item.page.pageNumber,ms:performance.now()-renderStarted,at:performance.now()-pdfMetrics.started})",
	],
	[
		"void load().catch((error) => {",
		"void load().catch((error) => { pdfMetrics.error=String(error); pdfMetrics.done=true",
	],
]
for (const [before, after] of edits) {
	if (source.split(before).length !== 2) throw new Error(`PDF timing boundary changed: ${before}`)
	source = source.replace(before, after)
}
source =
	`const pdfMetrics={started:0,startedAt:0,fetchMs:0,headersMs:0,bodyMs:0,documentMs:0,normalizeMs:0,pdfBytes:0,characters:0,runs:0,readyMs:0,done:false,error:'',pages:[] as {page:number;getPageMs:number;domMs:number;getTextContentMs:number;buildRunsMs:number;at:number}[],textLayers:[] as {page:number;ms:number;at:number}[],renders:[] as {page:number;ms:number;at:number}[],longTasks:[] as {start:number;ms:number}[]};Object.assign(globalThis,{pdfMetrics}); new PerformanceObserver(list=>{for(const e of list.getEntries())pdfMetrics.longTasks.push({start:e.startTime,ms:e.duration})}).observe({type:'longtask'});\n` +
	source
const build = await Bun.build({
	entrypoints: [`${projectRoot}/src/entrypoints/pdf/main.ts`],
	outdir: extension,
	naming: "pdf-phases.[ext]",
	target: "browser",
	format: "esm",
	plugins: [
		{
			name: "pdf-phase-measurement",
			setup(builder) {
				builder.onLoad({ filter: /[\\/]entrypoints[\\/]pdf[\\/]main.ts$/ }, () => ({
					contents: source,
					loader: "ts",
					resolveDir: `${projectRoot}/src/entrypoints/pdf`,
				}))
			},
		},
	],
})
if (!build.success) throw new AggregateError(build.logs, "PDF phase probe failed to bundle")
const html = await Bun.file(`${extension}/pdf.html`).text()
await Bun.write(`${extension}/pdf.html`, html.replace(/src="\/chunks\/pdf-[^"]+"/u, 'src="/pdf-phases.js"'))
const fixture = Bun.file(`${projectRoot}/.cache/benchmarks/muni-thesis.pdf`)
const bytes = await fixture.arrayBuffer()
const sha256 = new Bun.CryptoHasher("sha256").update(bytes).digest("hex")
if (sha256 !== "30b7977a1a52b029a691ad75b4b425162cf3570f5c94de9858ece7464f494c32")
	throw new Error("Unexpected PDF fixture")
const serverMode = Bun.env.PDF_PHASE_SERVER === "child" ? "child" : "inline"
const serverRequests: FixtureRequest[] = []
const server =
	serverMode === "child"
		? await startFixtureServer(`${projectRoot}/.cache/benchmarks/muni-thesis.pdf`, (request) =>
				serverRequests.push(request),
			)
		: Bun.serve({
				hostname: "127.0.0.1",
				port: 0,
				fetch(request) {
					serverRequests.push({ receivedAt: Date.now(), path: new URL(request.url).pathname })
					return new Response(bytes, {
						headers: {
							"Content-Type": "application/pdf",
							"Access-Control-Allow-Origin": "*",
							"Cross-Origin-Resource-Policy": "cross-origin",
						},
					})
				},
			})

const manifest = await Bun.file(`${extension}/manifest.json`).json()
manifest.host_permissions = ["http://127.0.0.1/*"]
await Bun.write(`${extension}/manifest.json`, JSON.stringify(manifest))
const executable = await chromeExecutable()
const passwordStore = Bun.env.PDF_PHASE_BASIC_KEYRING === "1" ? "basic" : "default"
const view = new Bun.WebView({
	backend: {
		type: "chrome",
		url: false,
		...(executable ? { path: executable } : {}),
		argv: [
			`--disable-extensions-except=${extension}`,
			`--load-extension=${extension}`,
			`--log-net-log=${projectRoot}/.cache/pdf-phases-netlog.json`,
			...(passwordStore === "basic" ? chromeTestProfileArguments : []),
		],
	},
	dataStore: "ephemeral",
})
interface Metrics {
	done: boolean
	error: string
	readyMs: number
	[key: string]: unknown
}
try {
	const results = []
	for (const variant of ["production", "extraction-only"]) {
		await view.navigate(
			`chrome-extension://${chromeExtensionId(extension)}/pdf.html?src=${encodeURIComponent(server.url.href + "thesis.pdf")}&probe=${variant}`,
		)
		await view.cdp("Page.bringToFront")

		const result = await waitFor(
			() => view.evaluate<Metrics | undefined>("window.pdfMetrics"),
			(value) => value?.done === true,
			90,
		)
		if (!result || result.error) throw new Error(result?.error ?? "PDF phase metrics missing")
		results.push({ variant, ...result })
		console.log(
			JSON.stringify({
				variant,
				readyMs: result.readyMs,
				fetchMs: result.fetchMs,
				documentMs: result.documentMs,
				normalizeMs: result.normalizeMs,
				headersMs: result.headersMs,
				bodyMs: result.bodyMs,
				pages: Array.isArray(result.pages) ? result.pages.length : 0,
				textLayers: result.textLayers,
				renders: result.renders,
				longTasks: result.longTasks,
			}),
		)
	}
	await Bun.write(
		`${projectRoot}/docs/evidence/pdf-phases-${serverMode}-${passwordStore}-2026-11-03.json`,
		JSON.stringify(
			{
				recordedAt: new Date().toISOString(),
				browser: await view.cdp("Browser.getVersion"),
				pdfSha256: sha256,
				serverMode,
				passwordStore,
				serverRequests,
				results,
				limits:
					"Development VM, locally cached MUNI thesis served on loopback with an explicit test-only host grant. Instrumented current production PDF entrypoint, same packaged PDF.js worker/assets and existing production manifest. One normal pipeline then one pipeline without IntersectionObserver-triggered text layers or canvas rendering. Sequential page extraction is unchanged. Per-page timings are wall time, not worker CPU time; asynchronous renderer jobs overlap extraction. No network, Firefox, Windows, target-device, first-audio or alignment acceptance. No reading text is persisted in these phase metrics.",
			},
			null,
			2,
		) + "\n",
	)
} finally {
	view.close()
	server.stop()
}
