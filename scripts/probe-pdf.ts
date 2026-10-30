import { $ } from "bun"

const root = import.meta.dir.replace(/\/scripts$/, "")
const extension = `${root}/.output/chrome-mv3`
const pdf = Bun.file(`${root}/.cache/benchmarks/muni-thesis.pdf`)
if (!(await pdf.exists()) || new TextDecoder().decode(new Uint8Array(await pdf.slice(0, 5).arrayBuffer())) !== "%PDF-")
	throw new Error("Provision the actual thesis PDF before running this benchmark")
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch: (request) =>
		new Response(pdf, {
			headers: {
				"Content-Type": "application/pdf",
				"Access-Control-Allow-Origin": request.headers.get("origin") ?? "null",
				"Access-Control-Allow-Credentials": "true",
			},
		}),
})
const candidates = await Array.fromAsync(
	new Bun.Glob("chromium-*/chrome-linux*/chrome").scan({ cwd: `${Bun.env.HOME}/.cache/ms-playwright`, absolute: true }),
)
const executable = Bun.env.BUN_CHROME_PATH ?? candidates.sort().at(-1)
const view = new Bun.WebView({
	backend: {
		type: "chrome",
		url: false,
		...(executable ? { path: executable } : {}),
		argv: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
	},
	dataStore: "ephemeral",
})
const waitFor = async <T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> => {
	const until = performance.now() + 90_000
	let value: T
	do {
		value = await read()
		if (accept(value)) return value
		await Bun.sleep(100)
	} while (performance.now() < until)
	throw new Error(`PDF benchmark timed out: ${JSON.stringify(value)}`)
}
try {
	await view.navigate("about:blank")
	const id = [...new Bun.CryptoHasher("sha256").update(extension).digest("hex").slice(0, 32)]
		.map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
		.join("")
	const started = performance.now()
	await view.navigate(`chrome-extension://${id}/pdf.html?src=${encodeURIComponent(server.url.href + "thesis.pdf")}`)
	const navigationMs = performance.now() - started
	await view.cdp("Page.bringToFront")
	await waitFor(
		() => view.evaluate<string>("document.querySelector('#status').textContent"),
		(value) => value === "" || !value.startsWith("Opening PDF"),
	)
	const status = await view.evaluate<string>("document.querySelector('#status').textContent")
	if (status) throw new Error(status)
	const textReadyMs = performance.now() - started
	const result = await view.evaluate<{
		pages: number
		characters: number
		highlighted: string
		content: boolean
	}>(`(async()=>{
		const session=new URL(document.querySelector('iframe').src).hash.slice(1);
		const {text}=await window.readAloudHost({session,command:'document'});
		const target='Virtual Research Environment';const start=text.indexOf(target);
		await window.readAloudHost({session,command:'highlight',start,end:start+target.length});
		return {pages:document.querySelectorAll('.pdf-page').length,characters:text.length,highlighted:Array.from(CSS.highlights.get('read-aloud-current-word')??[]).map(range=>range.toString()).join(''),content:text.includes('Molecular Dynamics')&&text.includes('Declaration')};
	})()`)
	if (
		result.pages !== 60 ||
		!result.content ||
		result.characters < 50_000 ||
		result.highlighted !== "Virtual Research Environment"
	)
		throw new Error(`PDF benchmark failed: ${JSON.stringify(result)}`)
	await waitFor(
		() => view.evaluate<number>("document.querySelectorAll('.pdf-page[data-painted]').length"),
		(value) => value > 0,
	)
	const screenshot = await view.cdp<{ data: string }>("Page.captureScreenshot", { format: "png" })
	await Bun.write(`${root}/.cache/product-probe/pdf-reading.png`, Uint8Array.fromBase64(screenshot.data))
	const distant = await view.evaluate<{ highlighted: string; scroll: number; textPages: number }>(`(async()=>{
		const session=new URL(document.querySelector('iframe').src).hash.slice(1);const {text}=await window.readAloudHost({session,command:'document'});
		const target='Bibliography';const start=text.lastIndexOf(target);if(start<10000)throw Error('Distant-page fixture missing');
		await window.readAloudHost({session,command:'highlight',start,end:start+target.length});
		return {highlighted:Array.from(CSS.highlights.get('read-aloud-current-word')??[]).map(range=>range.toString()).join(''),scroll:scrollY,textPages:Array.from(document.querySelectorAll('.textLayer')).filter(layer=>layer.childNodes.length).length};
	})()`)
	if (distant.highlighted !== "Bibliography" || distant.scroll < 1000 || distant.textPages >= 60)
		throw new Error(`Lazy PDF mapping failed: ${JSON.stringify(distant)}`)
	const record = {
		recordedAt: new Date().toISOString(),
		browser: await view.cdp("Browser.getVersion"),
		pdfSha256: new Bun.CryptoHasher("sha256").update(await pdf.arrayBuffer()).digest("hex"),
		...result,
		distant,
		navigationMs,
		textReadyMs,
		readyMs: performance.now() - started,
		limits:
			"Cached original benchmark bytes served locally with CORS. Proves rendering/text mapping, not native PDF action, speech, GPU, or latency acceptance.",
	}
	await $`mkdir -p ${root + "/docs/evidence"}`.quiet()
	await Bun.write(`${root}/docs/evidence/pdf-rendering-2026-10-30.json`, JSON.stringify(record, null, 2) + "\n")
	console.log(JSON.stringify(record, null, 2))
} finally {
	view.close()
	server.stop(true)
}
