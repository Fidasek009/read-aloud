import { $ } from "bun"

import { getVoice } from "../src/speech/catalog.ts"
import { checkPdfSelection } from "./check-pdf-selection.ts"
import { pdfSpeechCheck } from "./check-pdf-speech.ts"

const accessOnly = Bun.env.PDF_CHECK_ACCESS_ONLY === "1"
if (!accessOnly) {
	const child = Bun.spawn(["bun", import.meta.path], {
		env: { ...Bun.env, PDF_CHECK_ACCESS_ONLY: "1" },
		stdout: "inherit",
		stderr: "inherit",
	})
	if ((await child.exited) !== 0) throw new Error("PDF permission recovery check failed")
}
const speechCheck = Bun.env.PDF_CHECK_SPEECH === "1" && !accessOnly
const root = import.meta.dir.replace(/\/scripts$/, "")
const extension = `${root}/.cache/pdf-probe`
await $`rm -rf ${extension}`.quiet()
await $`mkdir -p ${extension}`.quiet()
await $`cp -R ${root + "/.output/chrome-mv3/."} ${extension}`.quiet()
if (speechCheck) {
	const built = await Bun.build({
		entrypoints: [`${root}/scripts/check-pdf-speech.ts`],
		outdir: extension,
		naming: "check-pdf-speech.js",
		target: "browser",
	})
	if (!built.success) throw new Error(`Speech probe bundle failed: ${built.logs.join("\n")}`)
}
const manifest = await Bun.file(`${extension}/manifest.json`).json()
const pdf = Bun.file(`${root}/.cache/benchmarks/muni-thesis.pdf`)
if (!(await pdf.exists()) || new TextDecoder().decode(new Uint8Array(await pdf.slice(0, 5).arrayBuffer())) !== "%PDF-")
	throw new Error("Provision the actual thesis PDF before running this benchmark")
const modelPath = getVoice("en_US-ljspeech-medium").url.split("/resolve/")[1]!
const model = Bun.file(`${root}/.cache/piper/${modelPath}`)
const config = Bun.file(`${root}/.cache/piper/${modelPath}.json`)
if (speechCheck && (!(await model.exists()) || !(await config.exists())))
	throw new Error("Provision the pinned English model/config in .cache/piper before running the speech probe")
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch: (request) => {
		const path = new URL(request.url).pathname
		if (speechCheck && path === "/model") return new Response(model)
		if (speechCheck && path === "/config") return new Response(config)
		return new Response(pdf, {
			headers: {
				"Content-Type": "application/pdf",
			},
		})
	},
})
const source = Bun.env.PDF_SOURCE_URL ?? server.url.href + "thesis.pdf"
if (!accessOnly) {
	const pdfUrl = new URL(source)
	manifest.host_permissions = [`${pdfUrl.protocol}//${pdfUrl.hostname}/*`]
	await Bun.write(`${extension}/manifest.json`, JSON.stringify(manifest))
}
const candidates = await Array.fromAsync(
	new Bun.Glob("chromium-*/chrome-linux*/chrome").scan({ cwd: `${Bun.env.HOME}/.cache/ms-playwright`, absolute: true }),
)
const executable = Bun.env.BUN_CHROME_PATH ?? candidates.sort().at(-1)
const createView = () =>
	new Bun.WebView({
		backend: {
			type: "chrome",
			url: false,
			...(executable ? { path: executable } : {}),
			argv: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
		},
		dataStore: "ephemeral",
	})
const view = createView()
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
async function probe() {
	try {
		await view.navigate("about:blank")
		const id = [...new Bun.CryptoHasher("sha256").update(extension).digest("hex").slice(0, 32)]
			.map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
			.join("")
		const started = performance.now()
		await view.navigate(`chrome-extension://${id}/pdf.html?src=${encodeURIComponent(source)}`)
		if (accessOnly) {
			await waitFor(
				() => view.evaluate<string>("document.querySelector('#status').textContent"),
				(value) => value.startsWith("Allow access"),
			)
			const control = await view.evaluate<string>("document.querySelector('#status button')?.textContent ?? ''")
			if (control !== "Allow access and open PDF") throw new Error("The PDF access recovery control is missing")
			console.log("PDF without site access offers an explicit permission request.")
			return
		}
		const permissionRecovery = "Verified separately without a host grant"
		console.log("PDF test grant:", JSON.stringify(await view.evaluate("chrome.permissions.getAll()")))
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
		const selection = await view.evaluate(checkPdfSelection)
		const speech = speechCheck ? await view.evaluate(pdfSpeechCheck(server.url.href)) : undefined
		if (speechCheck) console.log("Cross-page neural speech:", JSON.stringify(speech))
		const record = {
			recordedAt: new Date().toISOString(),
			browser: await view.cdp("Browser.getVersion"),
			pdfSha256: new Bun.CryptoHasher("sha256").update(await pdf.arrayBuffer()).digest("hex"),
			...result,
			permissionRecovery,
			source: Bun.env.PDF_SOURCE_URL ? "remote MUNI source" : "cached MUNI bytes served without CORS",
			distant,
			selection,
			speech,
			navigationMs,
			textReadyMs,
			readyMs: performance.now() - started,
			limits: speechCheck
				? "Test-only host grant, cached MUNI PDF and pinned cached English model; actual CPU worker PCM and word timing validation across the acknowledgement/abstract page boundary. Does not validate physical audio quality, hardware GPU behavior, or target-device latency."
				: "First checks missing-permission recovery, then uses a test-only origin grant to verify actual privileged fetch without CORS, rendering, and text mapping. Native permission dialog, PDF action, and speech are not covered.",
		}
		await $`mkdir -p ${root + "/docs/evidence"}`.quiet()
		await Bun.write(
			`${root}/docs/evidence/${speechCheck ? "pdf-cross-page-speech-2026-11-01" : "pdf-rendering-2026-10-30"}.json`,
			JSON.stringify(record, null, 2) + "\n",
		)
		console.log(JSON.stringify(record, null, 2))
	} finally {
		view.close()
		server.stop(true)
	}
}
await probe()
