import { $ } from "bun"

import type {} from "../src/reading/bridge.ts"

import { observeContextMenu } from "./observe-context-menu.ts"
import { assert, copyProbeExtension, projectRoot, waitFor } from "./probe-helpers.ts"

function selectNativePage() {
	const layer = document.querySelector<HTMLElement>(".page .textLayer")
	const selection = getSelection()
	if (!layer || !selection) throw new Error("Native PDF text layer is unavailable")
	const range = document.createRange()
	range.selectNodeContents(layer)
	selection.removeAllRanges()
	selection.addRange(range)
	return selection.toString()
}

async function checkNativeHighlight() {
	const frame = document.querySelector<HTMLIFrameElement>("iframe")
	const host = window.readAloudHost
	if (!frame || !host) throw new Error("Selection reader is unavailable")
	const session = new URL(frame.src).hash.slice(1)
	const before = await host({ session, command: "document" })
	if (!("text" in before) || typeof before.text !== "string") throw new Error("Selected scope is unavailable")
	const text = before.text
	const words = [...text.matchAll(/\p{L}{4,}/gu)]
	const word = words.find((word) => word.index >= text.length / 2)
	if (!word) throw new Error("Native selection has no test word")
	await host({ session, command: "highlight", start: word.index, end: word.index + word[0].length })
	const highlighted = [...CSS.highlights!.get("read-aloud-current-word")!].map((range) => range.toString()).join("")
	if (highlighted.normalize("NFKC") !== word[0].normalize("NFKC"))
		throw new Error("Native selection word was not highlighted")
	const after = await host({ session, command: "document" })
	if (!("text" in after) || after.text !== before.text) throw new Error("Highlight mapping changed the reading scope")
	return { selectedCharacters: before.text.length, wordHighlighted: true, scopeUnchanged: true }
}
const root = projectRoot
const out = `${root}/.cache/worker-compat-probe`
await copyProbeExtension("firefox", out)
await $`mkdir -p ${root + "/.cache/worker-compat-profiles"}`.quiet()
const manifest = await Bun.file(`${out}/manifest.json`).json()
manifest.host_permissions = ["https://arxiv.org/*"]
await Bun.write(`${out}/manifest.json`, JSON.stringify(manifest))
await observeContextMenu(out)
const workerAsset = (await Array.fromAsync(new Bun.Glob("assets/pdf.worker*.mjs").scan({ cwd: out })))[0]
if (!workerAsset) throw new Error("Built PDF worker asset is missing")
if (Bun.env.PDF_BROKEN_WORKER === "1") await Bun.write(`${out}/${workerAsset}`, "function broken() {")
await Bun.write(
	`${out}/observe-pdf-error.js`,
	`const nativeError=console.error;console.error=(...args)=>{if(args[0]==="Read Aloud: PDF worker startup failed")window.__workerFailure=args[1];nativeError.apply(console,args)};
window.__pdfWorkers=[];const NativeWorker=Worker;window.Worker=class extends NativeWorker {
 constructor(url,options){super(url,options);const record={url:String(url),ready:false,terminated:false};window.__pdfWorkers.push(record);this.addEventListener('message',event=>{if(event.data?.action==='ready')record.ready=true});const terminate=this.terminate.bind(this);this.terminate=()=>{record.terminated=true;terminate()};}
};`,
)
const pdfHtml = Bun.file(`${out}/pdf.html`)
await Bun.write(pdfHtml, (await pdfHtml.text()).replace("<head>", '<head><script src="observe-pdf-error.js"></script>'))

const driver = Bun.spawn(
	[
		Bun.env.GECKODRIVER ?? "/snap/bin/geckodriver",
		"--port",
		"0",
		"--profile-root",
		`${root}/.cache/worker-compat-profiles`,
		"--allow-system-access",
	],
	{ stdin: "ignore", stdout: "pipe", stderr: "pipe" },
)
let log = "",
	endpoint = "",
	session = ""
const consume = async (stream: ReadableStream<Uint8Array>) => {
	const decoder = new TextDecoder()
	for await (const chunk of stream) log += decoder.decode(chunk, { stream: true })
}
const readers = [consume(driver.stdout), consume(driver.stderr)]
async function command<T = any>(path: string, body?: unknown, method = "POST"): Promise<T> {
	const response = await fetch(`${endpoint}${path}`, {
		method,
		headers: { "Content-Type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
		signal: AbortSignal.timeout(180_000),
	})
	const result = (await response.json()) as { value: T }
	if (!response.ok) throw new Error(`WebDriver ${response.status}: ${JSON.stringify(result.value).slice(0, 1000)}`)
	return result.value
}
const run = <T = any>(path: string, body?: unknown) => command<T>(`/session/${session}${path}`, body)
const script = <T = any>(expression: string, args: unknown[] = []): Promise<T> =>
	run("/execute/sync", {
		script: `return (${expression});`,
		args,
	})
try {
	endpoint = await waitFor(
		async () => {
			if (driver.exitCode !== null) throw new Error(log.slice(-1000))
			const match = log.match(/Listening on (127\.0\.0\.1:\d+)/)
			return match ? `http://${match[1]}` : ""
		},
		Boolean,
		30,
	)
	const uuid = "a262307b-99ad-4b6b-a2c0-8d5dff090785"
	const created = await command<{ sessionId: string; capabilities: { browserVersion: string } }>("/session", {
		capabilities: {
			alwaysMatch: {
				browserName: "firefox",
				"moz:firefoxOptions": {
					binary: Bun.env.FIREFOX_BINARY ?? "/snap/firefox/current/usr/lib/firefox/firefox",
					args: ["-headless"],
					prefs: {
						"extensions.webextensions.uuids": JSON.stringify({ "read-aloud@local.invalid": uuid }),
					},
				},
			},
		},
	})
	session = created.sessionId
	await run("/timeouts", { script: 150_000, pageLoad: 30_000 })
	await run("/moz/addon/install", { path: out, temporary: true })

	await run("/url", { url: `moz-extension://${uuid}/voices.html` })
	let nativeSelection: { selectedCharacters: number; wordHighlighted: boolean; scopeUnchanged: boolean } | undefined
	const parsed = await script<{ ok: boolean; error?: string }>(`(async()=>{
		const url=browser.runtime.getURL(${JSON.stringify(workerAsset)});
		return new Promise(resolve=>{
			const worker=new Worker(url,{type:'module'});
			const timer=setTimeout(()=>{worker.terminate();resolve({ok:false,error:'No real worker ready message'})},5000);
			worker.onerror=event=>{clearTimeout(timer);worker.terminate();resolve({ok:false,error:event.message,line:event.lineno,url:event.filename})};
			worker.onmessage=event=>{if(event.data.action==='ready'){clearTimeout(timer);worker.terminate();resolve({ok:true})}};
		});
	})()`)
	console.log("Real module worker:", JSON.stringify(parsed))
	assert(
		Bun.env.PDF_BROKEN_WORKER === "1" ? !parsed.ok : parsed.ok,
		`Unexpected PDF module worker state: ${JSON.stringify(parsed)}`,
	)
	const pdfUrl = `moz-extension://${uuid}/pdf.html?src=${encodeURIComponent("https://arxiv.org/pdf/2404.07981")}`
	await script(`browser.tabs.create({url:${JSON.stringify(pdfUrl)},active:true})`)
	await waitFor(
		async () => {
			for (const handle of await command<string[]>(`/session/${session}/window/handles`, undefined, "GET")) {
				await run("/window", { handle })
				if ((await command<string>(`/session/${session}/url`, undefined, "GET")).startsWith(pdfUrl)) return true
			}
			return false
		},
		Boolean,
		20,
	)
	const status = await waitFor(
		() => script<string>("document.querySelector('#status')?.textContent ?? 'Opening PDF…'"),
		(value) => value === "" || !value.startsWith("Opening PDF"),
		90,
	)
	console.log(
		"arXiv:",
		JSON.stringify({
			version: created.capabilities.browserVersion,
			status,
			pages: await script("document.querySelectorAll('.pdf-page').length"),
		}),
	)
	if (Bun.env.PDF_BROKEN_WORKER === "1") {
		assert(status === "The PDF reader could not start. Reload the extension and reopen this PDF.", status)
		const diagnostic = await script<{ asset: string; reason: string; line?: number }>("window.__workerFailure")
		assert(
			diagnostic?.asset === `/${workerAsset}` && diagnostic.reason.length > 0,
			"Missing packaged worker diagnostics",
		)
		console.log("Malformed worker rejected with actionable status and asset diagnostics:", JSON.stringify(diagnostic))
	} else {
		assert(status === "", status)
		assert(
			(await script<number>("document.querySelectorAll('.pdf-page').length")) === 13,
			"arXiv page count did not match the fixture",
		)
		const workers = await script<{ url: string; ready: boolean; terminated: boolean }[]>("window.__pdfWorkers")
		console.log("PDF.js actual worker lifecycle:", JSON.stringify(workers))
		assert(
			workers.some((worker) => worker.ready && !worker.terminated),
			"PDF.js rendered through a fake worker instead of a live module worker",
		)
		if (Bun.env.PDF_NATIVE_SELECTION === "1") {
			const controller = await command<string>(`/session/${session}/window`, undefined, "GET")
			const native = await script<{ id: number }>(
				`browser.tabs.create({url:'https://arxiv.org/pdf/2404.07981',active:true})`,
			)
			await waitFor(
				async () => {
					for (const handle of await command<string[]>(`/session/${session}/window/handles`, undefined, "GET")) {
						await run("/window", { handle })
						if (
							(await command<string>(`/session/${session}/url`, undefined, "GET")).startsWith(
								"https://arxiv.org/pdf/2404.07981",
							)
						)
							return true
					}
					return false
				},
				Boolean,
				20,
			)
			await waitFor(
				() => script<number>("document.querySelectorAll('.page .textLayer span').length"),
				(count) => count > 20,
				40,
			)
			const text = await script<string>(`(${selectNativePage.toString()})()`)
			await run("/window", { handle: controller })
			const started = await script<{ ok: boolean; error?: string }>(
				`browser.runtime.sendMessage({type:'probe-context-menu',tab:{id:${native.id}},info:{menuItemId:'read-selection',pageUrl:'https://arxiv.org/pdf/2404.07981',selectionText:${JSON.stringify(text)}}})`,
			)
			assert(started.ok, started.error ?? "Native selection did not open")
			await waitFor(
				async () => {
					for (const handle of await command<string[]>(`/session/${session}/window/handles`, undefined, "GET")) {
						await run("/window", { handle })
						const address = await command<string>(`/session/${session}/url`, undefined, "GET")
						if (
							address.startsWith(`moz-extension://${uuid}/pdf.html`) &&
							new URL(address).searchParams.get("source") === String(native.id)
						)
							return true
					}
					return false
				},
				Boolean,
				20,
			)
			const mapped = await waitFor(
				() => script<string>("document.querySelector('#status')?.textContent??'Opening PDF…'"),
				(value) => value === "" || !value.startsWith("Opening PDF"),
				90,
			)
			assert(mapped === "", `Native arXiv selection mapping failed: ${mapped}`)
			nativeSelection = await script(`(${checkNativeHighlight.toString()})()`)
			console.log("Real native PDF selection:", JSON.stringify(nativeSelection))
		}
	}
	await Bun.write(
		`${root}/docs/evidence/pdf-worker-${Bun.env.PDF_BROKEN_WORKER === "1" ? "damaged" : "intact"}-2026-11-03.json`,
		JSON.stringify(
			{
				recordedAt: new Date().toISOString(),
				browserVersion: created.capabilities.browserVersion,
				workerAsset,
				workerSha256: new Bun.CryptoHasher("sha256")
					.update(await Bun.file(`${out}/${workerAsset}`).arrayBuffer())
					.digest("hex"),
				damagedFixture: Bun.env.PDF_BROKEN_WORKER === "1",
				realWorker: parsed,
				...(nativeSelection ? { nativeSelection } : {}),
				status,
				pages: await script<number>("document.querySelectorAll('.pdf-page').length"),
				passed: true,
				limits:
					"Fresh temporary profile, packaged extension copy, explicit arXiv test-origin grant. Damaged fixture deliberately changes only the copied worker. Does not reproduce the user's existing profile or validate native permission prompts.",
			},
			null,
			2,
		) + "\n",
	)
} finally {
	if (session) await command(`/session/${session}`, undefined, "DELETE").catch(() => {})
	driver.kill()
	await driver.exited
	await Promise.all(readers)
	await Bun.write(`${root}/.cache/product-probe/geckodriver.log`, log)
	await $`rm -rf ${root + "/.cache/worker-compat-profiles"}`.quiet()
}
