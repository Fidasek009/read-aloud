import { $ } from "bun"

import { checkPdfSelection } from "./check-pdf-selection.ts"
import { checkVolume, observePlayerAudio } from "./check-player-controls.ts"

const root = import.meta.dir.replace(/\/scripts$/, "")
const out = `${root}/.cache/product-probe/firefox`
await $`rm -rf ${out}`.quiet()
await $`mkdir -p ${out} ${root + "/.cache/product-probe/profiles"}`.quiet()
await $`cp -R ${root + "/.output/firefox-mv3/."} ${out}`.quiet()
await observePlayerAudio(out)
const manifest = await Bun.file(`${out}/manifest.json`).json()
// Test-only grant for scripted entry; native Firefox action activation is a separate gate.
manifest.host_permissions = ["http://127.0.0.1/*", "https://is.muni.cz/*"]
await Bun.write(`${out}/manifest.json`, JSON.stringify(manifest))
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch: () =>
		new Response(
			'<!doctype html><main><h1>Čtení na vašem zařízení</h1><p id="selection">Dobrý den. Čtení běží přímo ve vašem počítači a váš text zůstává v soukromí.</p><p id="warm-selection">Jenom tento výběr.</p><p>Další věta pro ověření přehrávání.</p></main>',
			{ headers: { "Content-Type": "text/html;charset=utf-8" } },
		),
})
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
const consume = async (stream: ReadableStream<Uint8Array>) => {
	const decoder = new TextDecoder()
	for await (const chunk of stream) log += decoder.decode(chunk, { stream: true })
}
const readers = [consume(driver.stdout), consume(driver.stderr)]
const waitFor = async <T>(read: () => Promise<T>, accept: (value: T) => boolean, seconds = 60): Promise<T> => {
	const deadline = performance.now() + seconds * 1000
	let value: T
	do {
		value = await read()
		if (accept(value)) return value
		await Bun.sleep(100)
	} while (performance.now() < deadline)
	throw new Error(`Condition timed out: ${String(JSON.stringify(value)).slice(0, 600)}`)
}
function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message)
}
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
	run("/execute/async", {
		script: `const done=arguments[arguments.length-1]; Promise.resolve().then(()=>(${expression})).then(done,error=>done({probeError:error.message}));`,
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

	await waitFor(
		() => script("document.querySelector('#bar').dataset.view"),
		(value) => value === "setup",
	)
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
	await run("/window", { handle: voicesHandle })
	await script(`document.querySelector('[data-voice="cs_CZ-jirka-medium"] .primary').click()`)
	const download = await waitFor(
		() => script<string>("document.querySelector('#status').textContent"),
		(value) => /ready|failed|unexpected|interrupted/i.test(value),
		120,
	)
	assert(download.includes("ready"), download)
	console.log("Firefox Czech voice download, integrity check, and persistence passed.")

	await run("/window", { handle: sourceHandle })
	await run("/frame", { id: frame })
	await waitFor(
		() => script("document.querySelector('#bar').dataset.view"),
		(value) => value === "playback",
	)
	assert(
		await script("document.querySelector('#voice').value==='cs_CZ-jirka-medium'"),
		"Firefox stale preference left an empty voice picker",
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
	await run("/frame", { id: frame })
	const cold = (await script<any>("browser.storage.local.get('lastSpeechPerformance')")).lastSpeechPerformance
	console.log("Firefox cold first-buffer timings:", JSON.stringify(cold))
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
	await script("document.querySelector('#play').click()")
	await waitFor(
		() => script<string>("document.querySelector('#status').textContent"),
		(value) => value === "Paused",
	)
	const originalSession = await script("location.hash")
	await run("/frame", { id: null })
	await script("window.getSelection().selectAllChildren(document.querySelector('#warm-selection'))")
	await run("/frame", { id: frame })
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
	await pressPlay()
	await waitFor(
		() => script<any>("browser.runtime.sendMessage({type:'reader',session:location.hash.slice(1),command:'document'})"),
		(value) => value?.text === "Jenom tento výběr.",
	)
	assert((await script("location.hash")) === originalSession, "Play replaced the existing Firefox reader")
	await waitFor(
		() => script("document.querySelector('#status').textContent"),
		(value) => value === "Finished",
	)
	assert(await script("document.querySelector('#next').disabled"), "Firefox escaped the selected text")
	await pressPlay()
	await waitFor(
		() => script("document.querySelector('#play').getAttribute('aria-label')"),
		(value) => value === "Pause",
	)
	assert(
		(
			await script<any>(
				"browser.runtime.sendMessage({type:'reader',session:location.hash.slice(1),command:'document'})",
			)
		).text === "Jenom tento výběr.",
		"Firefox replay escaped the selected text",
	)
	await script("document.querySelector('#play').click()")
	await run("/frame", { id: null })
	await run("/window", { handle: voicesHandle })
	await script(`document.querySelector('[data-voice="cs_CZ-jirka-medium"] .danger').click()`)
	await waitFor(
		() => script<string>("document.querySelector('#status').textContent"),
		(value) => value.includes("deleted"),
	)
	await run("/window", { handle: sourceHandle })
	await run("/frame", { id: frame })
	await waitFor(
		() => script("document.querySelector('#bar').dataset.view"),
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
	const originalPdf = await script<{ id: number }>(
		`browser.tabs.create({url:'https://is.muni.cz/th/wdhgd/bc.pdf',active:false})`,
	)
	await script(
		`browser.tabs.create({url:browser.runtime.getURL('/pdf.html')+'?src='+encodeURIComponent('https://is.muni.cz/th/wdhgd/bc.pdf'),active:true})`,
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
	assert(!pdfStatus, `Firefox live PDF fetch failed: ${pdfStatus}`)
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
	await run("/window", { handle: voicesHandle })
	assert(
		await script(`browser.tabs.get(${originalPdf.id}).then(()=>true,()=>false)`),
		"The original PDF tab was closed",
	)
	console.log("Firefox live MUNI PDF fetch, text mapping, highlighting, and original-tab preservation passed.")
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
					"selection completion and replay stay within the selection",
					"pause",
					"close",
					"delete",
					"live MUNI PDF fetch/render/highlight with explicit test-origin grant",
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
} finally {
	if (session) await command(`/session/${session}`, undefined, "DELETE").catch(() => {})
	driver.kill()
	await driver.exited
	await Promise.all(readers)
	await Bun.write(`${root}/.cache/product-probe/geckodriver.log`, log)
	await $`rm -rf ${root + "/.cache/product-probe/profiles"}`.quiet()
	server.stop(true)
}
