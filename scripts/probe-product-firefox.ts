import { $ } from "bun"

import { checkPdfSelection } from "./check-pdf-selection.ts"
import { checkSpeedPanel, checkVolume, observePlayerAudio } from "./check-player-controls.ts"
import { checkAbortedVoiceDeletion } from "./check-voice-deletion.ts"
import { observeContextMenu } from "./observe-context-menu.ts"
import { assert, projectRoot, waitFor } from "./probe-helpers.ts"
import {
	recoverSelectionAfterFailure,
	recoverSelectionFromMenu,
	type RecoveryDriver,
	verifySelectionReplay,
} from "./reader-scenarios.ts"

const root = projectRoot
const out = `${root}/.cache/product-probe/firefox`
await $`rm -rf ${out}`.quiet()
await $`mkdir -p ${out} ${root + "/.cache/product-probe/profiles"}`.quiet()
await $`cp -R ${root + "/.output/firefox-mv3/."} ${out}`.quiet()
await observePlayerAudio(out)
await observeContextMenu(out)
if (Bun.env.DIRECT_READER_PROBE === "1") {
	const audio = Bun.file(`${out}/probe-audio.js`)
	await Bun.write(
		audio,
		`${await audio.text()}\n(globalThis.browser??chrome).runtime.onConnect?.addListener(port=>{if(port.name==='direct-reader-probe')port.onMessage.addListener(()=>{document.body.dataset.directReaderProbe='connected'})});`,
	)
	const reader = Bun.file(`${out}/content-scripts/reader.js`)
	await Bun.write(
		reader,
		`${await reader.text()}\n;(globalThis.browser??chrome).runtime.onMessage.addListener(message=>{if(message?.type==='probe-direct-reader'){const port=(globalThis.browser??chrome).runtime.connect({name:'direct-reader-probe'});port.postMessage({probe:true});return Promise.resolve({ok:true})}});`,
	)
}
const speakerModel = Bun.file(`${root}/.cache/speaker-fixture/model.onnx`)
const speakerConfig = Bun.file(`${root}/.cache/speaker-fixture/config.json`)
const hasSpeakerFixture = (await speakerModel.exists()) && (await speakerConfig.exists())
const cachedPdf = Bun.env.PDF_CACHED === "1" ? Bun.file(`${root}/.cache/benchmarks/muni-thesis.pdf`) : undefined
if (
	cachedPdf &&
	(!(await cachedPdf.exists()) ||
		new Bun.CryptoHasher("sha256").update(await cachedPdf.arrayBuffer()).digest("hex") !==
			"30b7977a1a52b029a691ad75b4b425162cf3570f5c94de9858ece7464f494c32")
)
	throw new Error("Provision the pinned original MUNI thesis before using PDF_CACHED=1")
if (hasSpeakerFixture) {
	const built = await Bun.build({
		entrypoints: [`${root}/scripts/check-speakers.ts`],
		outdir: out,
		naming: "check-speakers.js",
		target: "browser",
		format: "esm",
	})
	if (!built.success) throw new AggregateError(built.logs, "Speaker fixture failed to bundle")
}
const manifest = await Bun.file(`${out}/manifest.json`).json()
// Test-only grant for scripted entry; native Firefox action activation is a separate gate.
manifest.host_permissions = ["http://127.0.0.1/*", "https://is.muni.cz/*"]
await Bun.write(`${out}/manifest.json`, JSON.stringify(manifest))
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch: (request) => {
		const path = new URL(request.url).pathname
		if (cachedPdf && path === "/thesis.pdf")
			return new Response(cachedPdf, { headers: { "Content-Type": "application/pdf" } })
		if (hasSpeakerFixture && (path === "/model" || path === "/config"))
			return new Response(path === "/model" ? speakerModel : speakerConfig, {
				headers: { "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin" },
			})
		return new Response(
			'<!doctype html><main><h1>Čtení na vašem zařízení</h1><p id="selection">Dobrý den. Čtení běží přímo ve vašem počítači a váš text zůstává v soukromí, zatímco přirozený hlas pokračuje ve čtení této delší věty, abychom mohli ověřit ovládání přehrávání.</p><p id="warm-selection">Jenom tento výběr.</p><p>Další věta pro ověření přehrávání.</p></main>',
			{ headers: { "Content-Type": "text/html;charset=utf-8" } },
		)
	},
})
const pdfSource = cachedPdf ? new URL("thesis.pdf", server.url).href : "https://is.muni.cz/th/wdhgd/bc.pdf"
const driver = Bun.spawn(
	[
		Bun.env.GECKODRIVER ?? "/snap/bin/geckodriver",
		"--port",
		"0",
		"--profile-root",
		`${root}/.cache/product-probe/profiles`,
		"--allow-system-access",
	],
	{ stdin: "ignore", stdout: "pipe", stderr: "pipe" },
)
let log = "",
	endpoint = "",
	session = ""
let directReaderProbe: { connected: boolean; onConnectAvailable: boolean; directAttempt: unknown } | undefined
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
						// Enables Firefox's test-only OS-key injection API, not media eligibility.
						"media.mediacontrol.testingevents.enabled": true,
						"extensions.webextensions.uuids": JSON.stringify({ "read-aloud@local.invalid": uuid }),
					},
				},
			},
		},
	})
	session = created.sessionId
	await run("/timeouts", { script: 150_000, pageLoad: 30_000 })
	await run("/moz/addon/install", { path: out, temporary: true })
	let voicesHandle = ""
	await waitFor(
		async () => {
			for (const handle of await command<string[]>(`/session/${session}/window/handles`, undefined, "GET")) {
				await run("/window", { handle })
				if (
					(await command<string>(`/session/${session}/url`, undefined, "GET")) === `moz-extension://${uuid}/voices.html`
				) {
					voicesHandle = handle
					return true
				}
			}
			return false
		},
		Boolean,
		15,
	)
	await waitFor(
		() => script<number>("document.querySelectorAll('section').length"),
		(value) => value === 178,
	)
	await script("browser.storage.local.set({voice:'cs_CZ-jirka-medium#999'})")
	const tab = await script<{ id: number }>(`browser.tabs.create({url:${JSON.stringify(server.url.href)},active:true})`)
	let sourceHandle = ""
	await waitFor(
		async () => {
			for (const handle of await command<string[]>(`/session/${session}/window/handles`, undefined, "GET")) {
				await run("/window", { handle })
				if ((await command<string>(`/session/${session}/url`, undefined, "GET")).startsWith(server.url.href)) {
					sourceHandle = handle
					return true
				}
			}
			return false
		},
		Boolean,
		15,
	)
	await waitFor(
		() => script("document.readyState"),
		(value) => value === "complete",
	)
	await script("window.getSelection().selectAllChildren(document.querySelector('#selection'))")
	await run("/window", { handle: voicesHandle })
	await script(`browser.scripting.executeScript({target:{tabId:${tab.id}},files:['content-scripts/reader.js']})`)
	const started = await script(
		`browser.tabs.sendMessage(${tab.id},{type:'start-reading',mode:'selection'},{frameId:0})`,
	)
	assert(started.ok, started.error ?? "Reader did not start")
	await run("/window", { handle: sourceHandle })
	const frame = await waitFor(
		() => script("document.querySelector('[data-read-aloud]')?.shadowRoot?.querySelector('iframe')"),
		Boolean,
		15,
	)
	await run("/frame", { id: frame })
	try {
		await waitFor(
			() => script("document.querySelector('#bar')?.dataset.view"),
			(value) => value === "setup",
		)
	} catch (error) {
		console.error(
			"Firefox player initialization:",
			await script(
				"({view:document.querySelector('#bar')?.dataset.view,status:document.querySelector('#status').textContent,error:document.documentElement.dataset.probeError,rejection:document.documentElement.dataset.probeRejection,hasTabs:!!browser.tabs})",
			),
		)
		throw error
	}
	if (Bun.env.DIRECT_READER_PROBE === "1") {
		await run("/window", { handle: voicesHandle })
		const directAttempt = await script(`browser.tabs.sendMessage(${tab.id},{type:'probe-direct-reader'},{frameId:0})`)
		await run("/window", { handle: sourceHandle })
		await run("/frame", { id: frame })
		let connected = false
		try {
			connected = await waitFor(
				() => script<boolean>("document.body.dataset.directReaderProbe==='connected'"),
				Boolean,
				5,
			)
		} catch {}
		const onConnectAvailable = await script<boolean>("!!browser.runtime.onConnect")
		directReaderProbe = { connected, onConnectAvailable, directAttempt }
		console.log("Firefox direct content-to-player port:", JSON.stringify(directReaderProbe))
	}
	assert(
		await script("document.querySelector('#playback').hidden && !document.querySelector('#setup').hidden"),
		"Firefox exposed empty playback controls",
	)
	await script("document.querySelector('#setup').focus()")
	await run("/actions", {
		actions: [
			{
				type: "key",
				id: "setup-keyboard",
				actions: [
					{ type: "keyDown", value: "\uE004" },
					{ type: "keyUp", value: "\uE004" },
				],
			},
		],
	})
	assert(await script("document.activeElement.id==='close'"), "Firefox setup keyboard order is incorrect")
	await script("indexedDB.open=()=>{throw Error('Embedded frame storage is unavailable')}")
	await run("/frame", { id: null })
	await script("window.getSelection().selectAllChildren(document.querySelector('#selection'))")
	await run("/frame", { id: frame })
	const initialMenu = await script(
		`browser.runtime.sendMessage({type:'probe-context-menu',tab:{id:${tab.id}},info:{menuItemId:'read-selection',pageUrl:${JSON.stringify(server.url.href)}}})`,
	)
	assert(initialMenu?.ok, `Firefox initial context-menu route failed: ${JSON.stringify(initialMenu)}`)
	await waitFor(
		() => script("document.body.dataset.probeControlChange"),
		(value) => value === "local:true",
		5,
	)
	await run("/frame", { id: null })
	await run("/window", { handle: voicesHandle })
	await script(`document.querySelector('[data-voice="cs_CZ-jirka-medium"] .primary').click()`)
	await waitFor(
		() => script<boolean>("!!document.querySelector('[data-voice=\"cs_CZ-jirka-medium\"] .danger')"),
		Boolean,
		120,
	)
	assert(
		await script("document.querySelector('#status').textContent===''"),
		"Download added a page-level success notice",
	)
	console.log("Firefox Czech voice download, integrity check, and persistence passed.")
	console.log(
		"Firefox origin storage persistence:",
		await script("navigator.storage?.persisted ? navigator.storage.persisted() : 'unavailable'"),
	)

	await run("/window", { handle: sourceHandle })
	await run("/frame", { id: frame })
	await waitFor(
		() => script("document.querySelector('#bar')?.dataset.view"),
		(value) => value === "playback",
	)
	assert(
		await script("document.querySelector('#voice').value==='cs_CZ-jirka-medium'"),
		"Firefox stale preference left an empty voice picker",
	)
	const directReader = await script<any>(`(async()=>{
		const session=location.hash.slice(1);
		return {document:await browser.runtime.sendMessage({type:'reader',session,command:'document'}),stale:await browser.runtime.sendMessage({type:'reader',session:'stale',command:'close'})};
	})()`)
	assert(
		typeof directReader.document?.text === "string" && directReader.stale?.error,
		`Firefox reader contract failed: ${JSON.stringify(directReader)}`,
	)
	let status = await waitFor(
		() => script<string>("document.querySelector('#status')?.textContent"),
		(value) => typeof value === "string" && !/Getting|Preparing/.test(value),
		120,
	)
	assert(/Reading|Press Play/.test(status), status)
	await Bun.sleep(400)
	status = await script("document.querySelector('#status').textContent")
	console.log("Firefox player status:", status)
	await script(
		"document.addEventListener('click',event=>document.body.setAttribute('data-probe-target',event.target.id+':'+event.isTrusted),true)",
	)
	if (
		status.includes("Press Play") ||
		(await script("document.querySelector('#play').getAttribute('aria-label')")) === "Play"
	) {
		// Gecko's pointer coordinates are wrong for this transformed shadow iframe.
		// Focus + trusted keyboard input also verifies keyboard activation.
		await script("document.querySelector('#play').focus()")
		await run("/actions", {
			actions: [
				{
					type: "key",
					id: "keyboard",
					actions: [
						{ type: "keyDown", value: "\uE007" },
						{ type: "keyUp", value: "\uE007" },
					],
				},
			],
		})
		console.log("Firefox click target:", await script("document.body.getAttribute('data-probe-target')"))
		assert(
			await script("document.body.getAttribute('data-probe-target') === 'play:true'"),
			"Keyboard did not activate Play",
		)
	}
	await run("/frame", { id: null })
	const highlight = await waitFor(
		() =>
			script<string>(
				"Array.from(CSS.highlights.get('read-aloud-current-word')??[]).map(range=>range.toString()).join('')",
			),
		Boolean,
		15,
	).catch(async (error) => {
		console.log(
			"Firefox page highlights:",
			await script("({keys:Array.from(CSS.highlights.keys()),text:document.querySelector('#selection').textContent})"),
		)
		await run("/frame", { id: frame })
		console.log(
			"Firefox playback:",
			await script("({status:document.querySelector('#status').textContent,visibility:document.visibilityState})"),
		)
		await run("/frame", { id: null })
		const shot = await command<string>(`/session/${session}/screenshot`, undefined, "GET")
		await Bun.write(`${root}/.cache/product-probe/firefox-reading.png`, Uint8Array.fromBase64(shot))
		throw error
	})
	console.log("Firefox highlighted Czech source word:", highlight)
	await run("/window", { handle: voicesHandle })
	await script(checkAbortedVoiceDeletion("cs_CZ-jirka-medium"))
	await run("/window", { handle: sourceHandle })
	await run("/frame", { id: frame })
	assert(
		await script(
			"document.querySelector('#voice').value==='cs_CZ-jirka-medium' && document.querySelector('#status').textContent==='Reading'",
		),
		"An aborted deletion interrupted the Firefox voice",
	)
	console.log("Firefox aborted deletion retained the voice and reader without a committed notification.")
	await script(
		"browser.storage.local.set({voiceChange:{id:'cs_CZ-jirka-medium',deleted:true,revision:crypto.randomUUID()}})",
	)
	await Bun.sleep(500)
	assert(
		await script(
			"document.querySelector('#voice').value==='cs_CZ-jirka-medium' && document.querySelector('#status').textContent==='Reading'",
		),
		"A stale deletion notification interrupted the installed Firefox voice",
	)
	const cold = (await script<any>("browser.storage.local.get('lastSpeechPerformance')")).lastSpeechPerformance
	console.log("Firefox cold first-buffer timings:", JSON.stringify(cold))
	// Drive Firefox's media-control service, which routes OS keys to the active
	// controller. Calling our JS handlers directly cannot test that activation.
	console.log(
		"Firefox media elements:",
		await script(
			"window.__probeAudio.elements.map(e=>({duration:e.duration,time:e.currentTime,paused:e.paused,volume:e.volume,ready:e.readyState}))",
		),
	)
	await run("/moz/context", { context: "chrome" })
	console.log(
		"Firefox controller:",
		await script(
			"({enabled:Services.prefs.getBoolPref('media.hardwaremediakeys.enabled'),active:gBrowser.selectedBrowser.browsingContext.mediaController.isActive,audible:gBrowser.selectedBrowser.browsingContext.mediaController.isAudible,keys:gBrowser.selectedBrowser.browsingContext.mediaController.supportedKeys})",
		),
	)
	const mediaState = await waitFor(
		() => script("MediaControlService.getCurrentMediaSessionPlaybackState()"),
		(value) => value === "playing",
		15,
	)
	assert(mediaState === "playing", "Firefox has no active playing media controller")
	await script("MediaControlService.generateMediaControlKey('pause')")
	await run("/moz/context", { context: "content" })
	await waitFor(
		() => script("document.querySelector('#play')?.getAttribute('aria-label')"),
		(value) => value === "Play",
	)
	await run("/moz/context", { context: "chrome" })
	await script("MediaControlService.generateMediaControlKey('play')")
	await run("/moz/context", { context: "content" })
	await waitFor(
		() => script("document.querySelector('#play')?.getAttribute('aria-label')"),
		(value) => value === "Pause",
	)
	console.log("Firefox media-control service routed pause/play through the active controller.")
	const volume = await script<any>(checkVolume)
	assert(volume?.muted, "Firefox volume failed: " + JSON.stringify(volume))
	console.log("Firefox volume controls:", JSON.stringify(volume))

	await run("/actions", {
		actions: [
			{
				type: "key",
				id: "volume-keyboard",
				actions: [
					{ type: "keyDown", value: "\uE00C" },
					{ type: "keyUp", value: "\uE00C" },
				],
			},
		],
	})
	assert(
		await script(
			"!document.querySelector('#volume-panel').matches(':popover-open') && !!document.querySelector('#bar')",
		),
		"Firefox Escape closed the player instead of the volume panel",
	)
	await script("document.querySelector('#sound').click()")
	await run("/frame", { id: null })
	await run("/actions", {
		actions: [
			{
				type: "pointer",
				id: "volume-outside",
				parameters: { pointerType: "mouse" },
				actions: [
					{ type: "pointerMove", duration: 0, x: 10, y: 180 },
					{ type: "pointerDown", button: 0 },
					{ type: "pointerUp", button: 0 },
				],
			},
		],
	})
	await run("/frame", { id: frame })
	assert(
		await script("!document.querySelector('#volume-panel').matches(':popover-open')"),
		"Firefox source-page click left the volume panel open",
	)
	await script(
		"(()=>{document.querySelector('#volume').value='100';document.querySelector('#volume').dispatchEvent(new Event('input'));document.querySelector('#volume').dispatchEvent(new Event('change'))})()",
	)
	console.log("Firefox speed panel:", JSON.stringify(await script(checkSpeedPanel)))
	const pressPlay = async () => {
		await script("document.querySelector('#play').focus()")
		await run("/actions", {
			actions: [
				{
					type: "key",
					id: "keyboard",
					actions: [
						{ type: "keyDown", value: "\uE007" },
						{ type: "keyUp", value: "\uE007" },
					],
				},
			],
		})
	}
	const evaluateRecovery = async <T>(expression: string): Promise<T> => {
		const result = await script<T>(expression)
		if (result && typeof result === "object" && "probeError" in result && typeof result.probeError === "string")
			throw new Error(result.probeError)
		return result
	}
	const recovery: RecoveryDriver = {
		player: evaluateRecovery,
		source: async <T>(expression: string): Promise<T> => {
			await run("/frame", { id: null })
			try {
				return await evaluateRecovery<T>(expression)
			} finally {
				await run("/frame", { id: frame })
			}
		},
		pressPlay,
		readSelectionFromMenu: async () => {
			const result = await evaluateRecovery<{ ok?: boolean }>(
				`browser.runtime.sendMessage({type:'probe-context-menu',tab:{id:${tab.id}},info:{menuItemId:'read-selection',pageUrl:${JSON.stringify(server.url.href)}}})`,
			)
			assert(result?.ok, `Firefox selection menu failed: ${JSON.stringify(result)}`)
		},
	}
	const recoveredScope = await recoverSelectionAfterFailure(recovery, "#warm-selection")
	await verifySelectionReplay(recovery, recoveredScope)
	await recoverSelectionFromMenu(recovery, "#selection")
	console.log("Firefox Play and context-menu commands recovered from playback failure.")
	await script("document.querySelector('#play').click()")
	await waitFor(
		() => script("document.querySelector('#status').textContent"),
		(value) => value === "Paused",
		5,
	)
	await run("/frame", { id: null })
	await run("/window", { handle: voicesHandle })
	await script(`(async()=>{
		const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('read-aloud-voices',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
		window.__probeSavedVoice=await new Promise((resolve,reject)=>{const req=db.transaction('voices').objectStore('voices').get('cs_CZ-jirka-medium');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
		db.close();
	})()`)
	await script(`document.querySelector('[data-voice="cs_CZ-jirka-medium"] .danger').click()`)
	await waitFor(
		() => script<boolean>("!document.querySelector('[data-voice=\"cs_CZ-jirka-medium\"] .danger')"),
		Boolean,
	)
	await run("/window", { handle: sourceHandle })
	await run("/frame", { id: frame })
	await waitFor(
		() => script("document.querySelector('#bar')?.dataset.view"),
		(value) => value === "setup",
	)
	assert(
		await script("document.querySelector('#playback').hidden && !document.querySelector('#setup').hidden"),
		"Firefox deletion left unusable playback controls",
	)
	await script("document.querySelector('#close').click()")
	await run("/frame", { id: null })
	await waitFor(() => script("!document.querySelector('[data-read-aloud]')"), Boolean)
	await run("/window", { handle: voicesHandle })
	console.log("Firefox pause, close, and deletion passed.")
	await script(`(async()=>{
		const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('read-aloud-voices',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)});
		await new Promise((resolve,reject)=>{const tx=db.transaction('voices','readwrite');tx.objectStore('voices').put(window.__probeSavedVoice);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error)});
		db.close();delete window.__probeSavedVoice;await browser.storage.local.set({voice:'cs_CZ-jirka-medium'});
	})()`)
	const originalPdf = await script<{ id: number }>(
		`browser.tabs.create({url:${JSON.stringify(pdfSource)},active:false})`,
	)
	await script(
		`browser.tabs.create({url:browser.runtime.getURL('/pdf.html')+'?src='+encodeURIComponent(${JSON.stringify(pdfSource)}),active:true})`,
	)
	await waitFor(
		async () => {
			for (const handle of await command<string[]>(`/session/${session}/window/handles`, undefined, "GET")) {
				await run("/window", { handle })
				if (
					(await command<string>(`/session/${session}/url`, undefined, "GET")).startsWith(
						`moz-extension://${uuid}/pdf.html`,
					)
				)
					return true
			}
			return false
		},
		Boolean,
		20,
	)
	const pdfStatus = await waitFor(
		() => script<string>("document.querySelector('#status').textContent"),
		(value) => value === "" || !value.startsWith("Opening PDF"),
		90,
	)
	assert(!pdfStatus, `Firefox PDF fetch failed: ${pdfStatus}`)
	const pdf = await script<any>(`(async()=>{
		const session=new URL(document.querySelector('iframe').src).hash.slice(1)
		const {text}=await window.readAloudHost({session,command:'document'})
		const target='Virtual Research Environment',start=text.indexOf(target)
		await window.readAloudHost({session,command:'highlight',start,end:start+target.length})
		return {pages:document.querySelectorAll('.pdf-page').length,characters:text.length,highlighted:Array.from(CSS.highlights.get('read-aloud-current-word')??[]).map(range=>range.toString()).join('')}
	})()`)
	assert(
		pdf.pages === 60 && pdf.characters > 50000 && pdf.highlighted === "Virtual Research Environment",
		`Firefox PDF mapping failed: ${JSON.stringify(pdf)}`,
	)
	const pdfSelection = await script<{ exactSelection?: boolean }>(checkPdfSelection)
	assert(pdfSelection.exactSelection, `Firefox PDF selection failed: ${JSON.stringify(pdfSelection)}`)
	const crossPage = await script<string>(`(async()=>{
		const frame=document.querySelector('iframe'),session=new URL(frame.src).hash.slice(1);
		const {text}=await window.readAloudHost({session,command:'document'});
		const start=text.indexOf('This work was supported',text.indexOf('Acknowledgements'));
		const end=text.slice(0,text.indexOf('This thesis',start)).trimEnd().length;
		if(start<0||end<=start)throw Error('Cross-page fixture missing');
		const tab=await browser.tabs.getCurrent();await browser.storage.session.set({['pdfSelection:'+tab.id]:text.slice(start,end)});
		return text.slice(start,end);
	})()`)
	const pdfSelectionStarted = performance.now()
	await run("/url", {
		url: `moz-extension://${uuid}/pdf.html?src=${encodeURIComponent(pdfSource)}&mode=selection`,
	})
	const earlyText = await waitFor(
		() =>
			script<string>(`(async()=>{
			const frame=document.querySelector('iframe');if(!frame)return '';
			return (await window.readAloudHost({session:new URL(frame.src).hash.slice(1),command:'document'})).text;
		})()`),
		(value) => typeof value === "string" && value.length > 0,
		30,
	)
	const pdfSelectionReadyMs = performance.now() - pdfSelectionStarted
	assert(earlyText === crossPage, "Firefox early PDF selection changed its scope")
	await waitFor(
		() => script<number>("document.querySelector('iframe')?.contentWindow?.__probeAudio?.sources ?? 0"),
		(value) => value > 0,
		90,
	)
	const pdfFirstBufferMs = performance.now() - pdfSelectionStarted
	await run("/window", { handle: voicesHandle })
	assert(
		await script(`browser.tabs.get(${originalPdf.id}).then(()=>true,()=>false)`),
		"The original PDF tab was closed",
	)
	console.log(
		`Firefox ${cachedPdf ? "cached" : "live"} MUNI PDF fetch, text mapping, highlighting, and original-tab preservation passed.`,
	)
	const speakerSwitch = hasSpeakerFixture
		? await script(
				`import(browser.runtime.getURL('check-speakers.js')).then(m=>m.checkSpeakers(${JSON.stringify(server.url.href)}))`,
			)
		: undefined
	if (hasSpeakerFixture) {
		assert(speakerSwitch?.reusedSession, `Firefox speaker switching failed: ${JSON.stringify(speakerSwitch)}`)
		console.log("Firefox two-speaker model reused:", JSON.stringify(speakerSwitch))
	}
	await Bun.write(
		`${root}/docs/evidence/firefox-product-2026-10-30.json`,
		JSON.stringify(
			{
				recordedAt: new Date().toISOString(),
				browserVersion: created.capabilities.browserVersion,
				voice: "cs_CZ-jirka-medium",
				performance: { cold, caveat: "Development VM with virtual audio, not target-hardware latency acceptance." },
				virtualAudio: Boolean(Bun.env.PULSE_SERVER),
				pdf,
				pdfSelection,
				pdfSelectionReadyMs,
				pdfFirstBufferMs,
				...(speakerSwitch ? { speakerSwitch } : {}),
				...(directReaderProbe ? { directReaderProbe } : {}),
				passed: [
					"no-voice state hides unusable controls",
					"live installation recovers a stale preference",
					"extension-owned storage despite unavailable iframe storage",
					"explicit download",
					"integrity",
					"model storage",
					"local speech",
					"Czech word highlighting",
					"keyboard Play reads only the current selection",
					"volume output gain, mute, persistence, no synthesis restart, and keyboard dismissal",
					"floating speed and volume panels leave bar height unchanged",
					"Play and background context-menu commands recover from playback failure",
					"PDF close and context-menu restart without Tab.url, with a new session",
					"selection completion and replay stay within the selection",
					"pause",
					"close",
					"delete",
					`${cachedPdf ? "cached" : "live"} MUNI PDF fetch/render/highlight with explicit test-origin grant`,
				],
				limitations: [
					"Scripted entry with localhost and MUNI test-origin grants; native activeTab/context menu and permission dialog not tested",
					"Virtual audio sink; not a physical device performance or quality test",
					"GPU and Windows not tested",
				],
			},
			null,
			2,
		) + "\n",
	)
	if (Bun.env.PDF_LOCAL === "1") {
		await run("/url", {
			url: `moz-extension://${uuid}/pdf.html?src=${encodeURIComponent(Bun.pathToFileURL(`${root}/.cache/benchmarks/muni-thesis.pdf`).href)}`,
		})
		await waitFor(() => script<boolean>("!!document.querySelector('#status input[type=file]')"), Boolean)
		const input = await run<Record<string, string>>("/element", { using: "css selector", value: "input[type=file]" })
		const element = input["element-6066-11e4-a52e-4f735466cecf"]
		assert(element, "Local PDF chooser is missing")
		await run(`/element/${element}/value`, { text: `${root}/.cache/benchmarks/muni-thesis.pdf` })
		await waitFor(
			() =>
				script<boolean>(
					"document.querySelector('#status').textContent==='' && document.querySelectorAll('.pdf-page').length===60",
				),
			Boolean,
			90,
		)
		console.log("Firefox local PDF opened from a user-selected File without file URL permissions.")
	}
} finally {
	if (session) await command(`/session/${session}`, undefined, "DELETE").catch(() => {})
	driver.kill()
	await driver.exited
	await Promise.all(readers)
	await Bun.write(`${root}/.cache/product-probe/geckodriver.log`, log)
	await $`rm -rf ${root + "/.cache/product-probe/profiles"}`.quiet()
	server.stop(true)
}
