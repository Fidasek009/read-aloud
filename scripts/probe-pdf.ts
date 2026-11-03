import { $ } from "bun"

import { getVoice } from "../src/speech/catalog.ts"
import { checkPdfSelection } from "./check-pdf-selection.ts"
import { pdfSpeechCheck } from "./check-pdf-speech.ts"
import { observePlayerAudio } from "./check-player-controls.ts"
import { observeContextMenu } from "./observe-context-menu.ts"
import {
	chromeExecutable,
	chromeExtensionId,
	chromeTestProfileArguments,
	projectRoot,
	waitFor,
} from "./probe-helpers.ts"

const accessOnly = Bun.env.PDF_CHECK_ACCESS_ONLY === "1"
if (!accessOnly && Bun.env.PDF_SKIP_ACCESS_CHECK !== "1") {
	const child = Bun.spawn(["bun", import.meta.path], {
		env: { ...Bun.env, PDF_CHECK_ACCESS_ONLY: "1" },
		stdout: "inherit",
		stderr: "inherit",
	})
	if ((await child.exited) !== 0) throw new Error("PDF permission recovery check failed")
}
const speechCheck = Bun.env.PDF_CHECK_SPEECH === "1" && !accessOnly
const root = projectRoot
const extension = `${root}/.cache/pdf-probe`
await $`rm -rf ${extension}`.quiet()
await $`mkdir -p ${extension}`.quiet()
await $`cp -R ${root + "/.output/chrome-mv3/."} ${extension}`.quiet()
await observeContextMenu(extension)
if (speechCheck) {
	await observePlayerAudio(extension)
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
const executable = await chromeExecutable()
const createView = () =>
	new Bun.WebView({
		backend: {
			type: "chrome",
			url: false,
			...(executable ? { path: executable } : {}),
			argv: [
				...chromeTestProfileArguments,
				`--disable-extensions-except=${extension}`,
				`--load-extension=${extension}`,
			],
		},
		dataStore: "ephemeral",
	})
const view = createView()
const waitForPdf = <T>(read: () => Promise<T>, accept: (value: T) => boolean) => waitFor(read, accept, 90)
async function probe() {
	try {
		await view.navigate("about:blank")
		const id = chromeExtensionId(extension)
		const started = performance.now()
		await view.navigate(`chrome-extension://${id}/pdf.html?src=${encodeURIComponent(source)}`)
		if (accessOnly) {
			await waitForPdf(
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
		await waitForPdf(
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
		await waitForPdf(
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
		const crossPage = speechCheck
			? await view.evaluate<string>(`(async()=>{
				const frame=document.querySelector('iframe'),session=new URL(frame.src).hash.slice(1);
				const {text}=await window.readAloudHost({session,command:'document'});
				const start=text.indexOf('This work was supported',text.indexOf('Acknowledgements'));
				const end=text.slice(0,text.indexOf('This thesis',start)).trimEnd().length;
				if(start<0||end<=start)throw Error('Cross-page fixture missing');
				return text.slice(start,end);
			})()`)
			: undefined
		const speech = speechCheck ? await view.evaluate(pdfSpeechCheck(server.url.href)) : undefined
		if (speechCheck) console.log("Cross-page neural speech:", JSON.stringify(speech))
		if (speechCheck)
			await view.evaluate(
				`import(chrome.runtime.getURL('check-pdf-speech.js')).then(async m=>{await m.provisionVoice(${JSON.stringify(server.url.href)});await m.checkVoiceFormat()})`,
			)
		const finishedReadyMs = performance.now() - started
		const initialText = crossPage ?? "Their day-to-day use is nev-\nertheless constrained by four limitations"
		await view.evaluate(`(async()=>{
			const tab=await chrome.tabs.getCurrent();
			await chrome.storage.session.set({['pdfSelection:'+tab.id]:${JSON.stringify(initialText)}});
		})()`)
		const selectionStarted = performance.now()
		await view.navigate(`chrome-extension://${id}/pdf.html?src=${encodeURIComponent(source)}&mode=selection`)
		const earlySelection = await waitFor(
			() =>
				view.evaluate<string>(`(async()=>{
				const frame=document.querySelector('iframe');
				if(!frame)return '';
				return (await window.readAloudHost({session:new URL(frame.src).hash.slice(1),command:'document'})).text;
			})()`),
			(value) => value.length > 0,
		)
		const selectionReadyMs = performance.now() - selectionStarted
		if (earlySelection !== (crossPage ?? "Their day-to-day use is nevertheless constrained by four limitations"))
			throw new Error(`Early PDF selection changed its scope: ${JSON.stringify(earlySelection)}`)
		let firstBufferMs: number | undefined
		if (speechCheck) {
			await waitFor(
				() => view.evaluate<number>("document.querySelector('iframe')?.contentWindow?.__probeAudio?.sources ?? 0"),
				(value) => value > 0,
			)
			firstBufferMs = performance.now() - selectionStarted
		}
		await waitFor(
			() => view.evaluate<string>("document.querySelector('#status').textContent"),
			(value) => value === "" || !value.startsWith("Opening PDF"),
		)
		const mapped = await view.evaluate<string>(`(async()=>{
			const frame=document.querySelector('iframe'),session=new URL(frame.src).hash.slice(1);
			const text=(await window.readAloudHost({session,command:'document'})).text;
			const from=text.indexOf(${JSON.stringify(speechCheck ? "This work was supported" : "nevertheless")});
			await window.readAloudHost({session,command:'highlight',start:from,end:from+${speechCheck ? 4 : 12}});
			return [...(CSS.highlights.get('read-aloud-current-word')??[])].map(range=>range.toString()).join('');
		})()`)
		if (mapped.replace(/[-\s]/gu, "") !== (speechCheck ? "This" : "nevertheless"))
			throw new Error(`Early selection did not acquire an exact highlight mapping: ${JSON.stringify(mapped)}`)
		const record = {
			recordedAt: new Date().toISOString(),
			browser: await view.cdp("Browser.getVersion"),
			pdfSha256: new Bun.CryptoHasher("sha256").update(await pdf.arrayBuffer()).digest("hex"),
			...result,
			permissionRecovery,
			source: Bun.env.PDF_SOURCE_URL ? "remote MUNI source" : "cached MUNI bytes served without CORS",
			distant,
			selection,
			selectionReadyMs,
			firstBufferMs,
			speech,
			navigationMs,
			textReadyMs,
			readyMs: finishedReadyMs,
			limits: speechCheck
				? "Test-only host grant, cached MUNI PDF and pinned cached English model; actual CPU worker PCM and word timing validation across the acknowledgement/abstract page boundary. Does not validate physical audio quality, hardware GPU behavior, or target-device latency."
				: "Checks missing-permission recovery, privileged fetch without CORS, rendering, text mapping, and the installed context-menu handler's close/reopen path with Tab.url omitted. Uses a test-only origin grant; native menu UI, activeTab grant, permission dialog, and speech are not covered.",
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
