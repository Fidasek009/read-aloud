import { $ } from "bun"

import { readingChunks, sentenceTarget } from "../src/reading/document.ts"

// This copied test manifest grants only the fixture origin. Native action /
// context-menu activation and the activeTab grant are not covered by this test.
const root = import.meta.dir.replace(/\/scripts$/, "")
const extension = `${root}/.cache/product-probe/chromium`
await $`rm -rf ${extension}`.quiet()
await $`mkdir -p ${extension}`.quiet()
await $`cp -R ${root + "/.output/chrome-mv3/."} ${extension}`.quiet()
const manifest = await Bun.file(`${extension}/manifest.json`).json()
assert(!manifest.host_permissions?.length, "The product must not request access to all sites")
manifest.host_permissions = ["http://127.0.0.1/*", "https://filipkrasa.salonek.org/*"]
await Bun.write(`${extension}/manifest.json`, JSON.stringify(manifest))
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch: () =>
		new Response(
			`<!doctype html><title>Reading fixture</title><nav>Navigation should not be read</nav><main><h1>Local reading</h1><p id="selection">One <em>natural voice</em> on your device. A second sentence keeps reading while you switch tabs. Your text stays private.</p><p id="warm-selection">Fresh words start a new selection. A second sentence keeps reading while you switch tabs. Your text stays private.</p>${"<p>Good design makes listening effortless. We can pause and continue without losing our place.</p>".repeat(12)}</main>`,
			{ headers: { "Content-Type": "text/html" } },
		),
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
		argv: [
			`--disable-extensions-except=${extension}`,
			`--load-extension=${extension}`,
			"--enable-unsafe-extension-debugging",
		],
	},
	dataStore: "ephemeral",
})
function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message)
}
const waitFor = async <T>(read: () => Promise<T>, accept: (value: T) => boolean, seconds = 60): Promise<T> => {
	const until = performance.now() + seconds * 1000
	let value: T
	do {
		value = await read()
		if (accept(value)) return value
		await Bun.sleep(100)
	} while (performance.now() < until)
	throw new Error(`Condition timed out: ${String(JSON.stringify(value)).slice(0, 600)}`)
}
let sequence = 0
const calls = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>()
view.addEventListener("Target.receivedMessageFromTarget", (event: any) => {
	const message = JSON.parse(event.data.message)
	if (message.method === "Runtime.exceptionThrown")
		console.log("Browser exception:", message.params.exceptionDetails.exception?.description?.slice(0, 1000))
	if (message.id) {
		const pending = calls.get(message.id)
		calls.delete(message.id)
		if (message.error) pending?.reject(new Error(message.error.message))
		else pending?.resolve(message.result)
	}
})
const call = async (session: string, method: string, params: object = {}): Promise<any> => {
	const id = ++sequence
	const result = new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			calls.delete(id)
			reject(new Error(`CDP ${method} did not answer`))
		}, 30_000)
		calls.set(id, {
			resolve: (value) => {
				clearTimeout(timer)
				resolve(value)
			},
			reject: (error) => {
				clearTimeout(timer)
				reject(error)
			},
		})
	})
	await view.cdp("Target.sendMessageToTarget", { sessionId: session, message: JSON.stringify({ id, method, params }) })
	return result
}
try {
	await view.navigate("about:blank")
	const id = [...new Bun.CryptoHasher("sha256").update(extension).digest("hex").slice(0, 32)]
		.map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
		.join("")
	await view.navigate(`chrome-extension://${id}/voices.html`)
	await waitFor(
		() => view.evaluate<number>("document.querySelectorAll('section').length"),
		(value) => value === 178,
	)
	console.log("Voice catalog loaded; no model download requested.")
	await view.evaluate("document.querySelector('section .primary').click()")
	await waitFor(
		() => view.evaluate<string>("document.querySelector('#status').textContent"),
		(value) => /ready|failed|unexpected|interrupted/i.test(value),
		120,
	)
	const download = await view.evaluate<string>("document.querySelector('#status').textContent")
	assert(download.includes("ready"), download)
	console.log("Explicit download passed integrity check and persisted.")
	const tab: any = await view.evaluate(`chrome.tabs.create({url:${JSON.stringify(server.url.href)}, active:true})`)
	const targets = await view.cdp<any>("Target.getTargets")
	const target = targets.targetInfos.find(
		(target: any) => target.type === "page" && target.url.startsWith(server.url.href),
	)
	assert(target, "Fixture tab missing")
	const { sessionId } = await view.cdp<any>("Target.attachToTarget", { targetId: target.targetId, flatten: false })
	const evaluate = async (expression: string, contextId?: number) => {
		const result = await call(sessionId, "Runtime.evaluate", {
			expression,
			returnByValue: true,
			awaitPromise: true,
			...(contextId ? { contextId } : {}),
		})
		if (result.exceptionDetails)
			throw new Error(result.exceptionDetails.text + ": " + result.exceptionDetails.exception?.description)
		return result.result.value
	}
	await waitFor(
		() => evaluate("document.readyState"),
		(value) => value === "complete",
	)
	await view.evaluate(`chrome.scripting.executeScript({target:{tabId:${tab.id}},files:['content-scripts/reader.js']})`)
	await evaluate("window.getSelection().selectAllChildren(document.querySelector('#selection'))")
	const contexts: { id: number; origin: string; auxData?: { isDefault?: boolean } }[] = []
	view.addEventListener("Target.receivedMessageFromTarget", (event: any) => {
		const m = JSON.parse(event.data.message)
		if (event.data.sessionId === sessionId && m.method === "Runtime.executionContextCreated")
			contexts.push(m.params.context)
	})
	await call(sessionId, "Runtime.enable")
	const started = await view.evaluate<any>(
		`chrome.tabs.sendMessage(${tab.id},{type:'start-reading',mode:'selection'},{frameId:0})`,
	)
	assert(started?.ok, started?.error ?? "Reader did not start")
	const playerTarget = await waitFor<{ targetId: string } | undefined>(
		async () => {
			const targets = await view.cdp<any>("Target.getTargets")
			return targets.targetInfos.find((target: any) => target.url.startsWith(`chrome-extension://${id}/player.html`))
		},
		Boolean,
		15,
	)
	assert(playerTarget, "The embedded player target is missing")
	const playerSession = (
		await view.cdp<any>("Target.attachToTarget", { targetId: playerTarget.targetId, flatten: false })
	).sessionId
	await call(playerSession, "Runtime.enable")
	const player = async (expression: string, userGesture = false) => {
		const result = await call(playerSession, "Runtime.evaluate", {
			expression,
			returnByValue: true,
			awaitPromise: true,
			userGesture,
		})
		if (result.exceptionDetails)
			throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
		return result.result.value
	}
	await call(sessionId, "Page.bringToFront")
	await player(
		"globalThis.probeHighlights=[];const originalSend=chrome.runtime.sendMessage;chrome.runtime.sendMessage=(...args)=>{if(args[0]?.command==='highlight')probeHighlights.push({start:args[0].start,end:args[0].end});return originalSend(...args)}",
	)
	const status = await waitFor(
		() => player("document.querySelector('#status')?.textContent"),
		(value) => typeof value === "string" && !value.includes("Preparing") && !value.includes("Getting"),
		120,
	)
	console.log("Player status:", status)
	console.log("Visibility:", await evaluate("document.visibilityState"), await player("document.visibilityState"))
	assert(/Reading|Press Play/.test(status), `Player failed: ${status}`)
	await waitFor(
		() => player("probeHighlights.length > 1 || document.querySelector('#status').textContent.includes('Press Play')"),
		Boolean,
		5,
	)
	if ((await player("document.querySelector('#status').textContent")).includes("Press Play")) {
		console.log("Programmatic entry requires a trusted Play gesture; native context-menu autoplay is not covered.")
		await player("document.querySelector('#play').click()", true)
	}
	const highlight = await waitFor(
		() =>
			evaluate(
				"Array.from(CSS.highlights.get('read-aloud-current-word') ?? []).map(range => range.toString()).join('')",
			),
		(value) => typeof value === "string" && value.length > 0,
		10,
	).catch(async (error) => {
		console.log(
			"Highlight diagnostics:",
			await player(
				"({status:document.querySelector('#status').textContent,messages:probeHighlights,visible:document.visibilityState})",
			),
			contexts,
		)
		for (const context of contexts.filter((context) => !context.auxData?.isDefault)) {
			try {
				console.log("Isolated world highlights:", await evaluate("Array.from(CSS.highlights.keys())", context.id))
			} catch {}
		}
		const shot = await call(sessionId, "Page.captureScreenshot", { format: "png" })
		await Bun.write(`${root}/.cache/product-probe/reading.png`, Buffer.from(shot.data, "base64"))
		throw error
	})
	console.log("Highlighted source word:", highlight)
	const cold = (await view.evaluate<any>("chrome.storage.local.get('lastSpeechPerformance')")).lastSpeechPerformance
	console.log("Cold first-buffer timings:", JSON.stringify(cold))
	const paddingBefore = await evaluate("document.documentElement.style.paddingTop")
	const hostCountBefore = await evaluate("document.querySelectorAll('[data-read-aloud]').length")
	await view.evaluate(
		`chrome.tabs.sendMessage(${tab.id},{type:'start-reading',mode:'article',reveal:true},{frameId:0})`,
	)
	assert(
		(await evaluate("document.documentElement.style.paddingTop")) === paddingBefore,
		"Toolbar activation changed page padding",
	)
	assert(
		(await evaluate("document.querySelectorAll('[data-read-aloud]').length")) === hostCountBefore,
		"Toolbar activation duplicated controls",
	)
	const barSize = await player(
		"({width:document.querySelector('#speed').getBoundingClientRect().width,height:document.querySelector('#bar').getBoundingClientRect().height,viewport:innerHeight})",
	)
	assert(
		barSize.width <= 80 && barSize.viewport < 140,
		`Playback controls grew unexpectedly: ${JSON.stringify(barSize)}`,
	)
	await evaluate("window.getSelection().selectAllChildren(document.querySelector('#warm-selection'))")
	const restarted = await view.evaluate<any>(
		`chrome.tabs.sendMessage(${tab.id},{type:'start-reading',mode:'selection'},{frameId:0})`,
	)
	assert(restarted.reuse, "A second selection discarded the loaded engine")
	const background = (await view.cdp<any>("Target.getTargets")).targetInfos.find(
		(target: any) => target.type === "service_worker" && target.url.includes(id),
	)
	assert(background, "The background worker is missing")
	const backgroundSession = (
		await view.cdp<any>("Target.attachToTarget", { targetId: background.targetId, flatten: false })
	).sessionId
	await call(backgroundSession, "Runtime.evaluate", {
		expression: `chrome.runtime.sendMessage({type:'reset-reader',session:${JSON.stringify(restarted.session)}})`,
		awaitPromise: true,
	})
	await waitFor(
		async () =>
			(await view.evaluate<any>("chrome.storage.local.get('lastSpeechPerformance')")).lastSpeechPerformance?.recordedAt,
		(value) => value !== cold.recordedAt,
	)
	const warm = (await view.evaluate<any>("chrome.storage.local.get('lastSpeechPerformance')")).lastSpeechPerformance
	console.log("Warm first-buffer timings:", JSON.stringify(warm))
	await player("document.querySelector('#next').click()")
	await waitFor(
		() =>
			evaluate("Array.from(CSS.highlights.get('read-aloud-current-word')??[]).map(range=>range.toString()).join('')"),
		(value) => value === "A",
	)
	await player("document.querySelector('#next').click()")
	await waitFor(
		() =>
			evaluate("Array.from(CSS.highlights.get('read-aloud-current-word')??[]).map(range=>range.toString()).join('')"),
		(value) => value === "Your",
	)
	await player("document.querySelector('#previous').click()")
	await waitFor(
		() =>
			evaluate("Array.from(CSS.highlights.get('read-aloud-current-word')??[]).map(range=>range.toString()).join('')"),
		(value) => value === "A",
	)
	const shot = await call(sessionId, "Page.captureScreenshot", { format: "png" })
	await Bun.write(`${root}/.cache/product-probe/reading.png`, Uint8Array.fromBase64(shot.data))
	await player("document.querySelector('#play').click()")
	assert((await player("document.querySelector('#status').textContent")) === "Paused", "Pause state did not update")
	await player("document.querySelector('#close').click()")
	await waitFor(() => evaluate("document.querySelector('[data-read-aloud]') === null"), Boolean)
	for (let n = 0; n < 2; n++)
		await view.evaluate(
			`chrome.scripting.executeScript({target:{tabId:${tab.id}},files:['content-scripts/reader.js']})`,
		)
	await evaluate("window.getSelection().selectAllChildren(document.querySelector('#warm-selection'))")
	await view.evaluate(`chrome.tabs.sendMessage(${tab.id},{type:'start-reading',mode:'selection'},{frameId:0})`)
	assert(
		(await evaluate("document.querySelectorAll('[data-read-aloud]').length")) === 1,
		"Reinjection left stale message listeners",
	)
	await view.evaluate(`chrome.tabs.sendMessage(${tab.id},{type:'stop-reading'},{frameId:0})`)
	console.log("Testing sentence navigation on the actual MD Dash benchmark.")
	const mdTab: any = await view.evaluate(
		`chrome.tabs.create({url:'https://filipkrasa.salonek.org/projects/md-dash/',active:true})`,
	)
	const mdTarget = await waitFor<any>(
		async () =>
			(await view.cdp<any>("Target.getTargets")).targetInfos.find(
				(target: any) => target.url === "https://filipkrasa.salonek.org/projects/md-dash/",
			),
		Boolean,
	)
	const mdSession = (await view.cdp<any>("Target.attachToTarget", { targetId: mdTarget.targetId, flatten: false }))
		.sessionId
	const remote = async (session: string, expression: string, userGesture = false) => {
		const result = await call(session, "Runtime.evaluate", {
			expression,
			returnByValue: true,
			awaitPromise: true,
			userGesture,
		})
		if (result.exceptionDetails)
			throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
		return result.result.value
	}
	await waitFor(
		() => remote(mdSession, "document.readyState"),
		(state) => state === "complete",
	)
	await view.evaluate(
		`chrome.scripting.executeScript({target:{tabId:${mdTab.id}},files:['content-scripts/reader.js']})`,
	)
	await view.evaluate(`chrome.tabs.sendMessage(${mdTab.id},{type:'start-reading',mode:'article'},{frameId:0})`)
	const mdPlayer = await waitFor<any>(
		async () =>
			(await view.cdp<any>("Target.getTargets")).targetInfos.find((target: any) =>
				target.url.startsWith(`chrome-extension://${id}/player.html`),
			),
		Boolean,
	)
	const mdPlayerSession = (
		await view.cdp<any>("Target.attachToTarget", { targetId: mdPlayer.targetId, flatten: false })
	).sessionId
	const mdControl = (expression: string, userGesture = false) => remote(mdPlayerSession, expression, userGesture)
	await call(mdSession, "Page.bringToFront")
	await mdControl(
		"globalThis.probeWords=[];globalThis.freezeOnHighlight=true;const originalSend=chrome.runtime.sendMessage;chrome.runtime.sendMessage=(...args)=>{if(args[0]?.command==='highlight'&&args[0].end>args[0].start){probeWords.push(args[0]);if(freezeOnHighlight){freezeOnHighlight=false;document.querySelector('#play').click()}}return originalSend(...args)}",
	)
	const mdStatus = await waitFor(
		() => mdControl("document.querySelector('#status').textContent"),
		(value) => /Reading|Press Play|Paused|failed/i.test(value),
		90,
	)
	if (mdStatus.includes("Press Play")) await mdControl("document.querySelector('#play').click()", true)
	await waitFor(
		() => mdControl("document.querySelector('#status').textContent"),
		(value) => value === "Paused",
	)
	const mdSource = await mdControl(
		"chrome.runtime.sendMessage({type:'reader',session:location.hash.slice(1),command:'document'})",
	)
	const mdChunks = readingChunks(mdSource.text, "en-US")
	let mdCursor = 0
	for (let n = 0; n < 5; n++) {
		mdCursor = sentenceTarget(mdChunks, mdCursor, 1)
		assert(mdCursor > 0, "MD Dash must have several sentence boundaries")
		await mdControl(
			"probeWords.length=0;freezeOnHighlight=true;document.querySelector('#next').click();document.querySelector('#play').click()",
		)
		await waitFor(
			() => mdControl("probeWords.at(-1)?.start??-1"),
			(value) => value >= mdChunks[mdCursor]!.start && value < mdChunks[mdCursor]!.end,
			30,
		)
	}
	mdCursor = sentenceTarget(mdChunks, mdCursor, -1)
	assert(mdCursor > 0, "The previous MD Dash sentence should not be the article start")
	await mdControl(
		"probeWords.length=0;freezeOnHighlight=true;document.querySelector('#previous').click();document.querySelector('#play').click()",
	)
	await waitFor(
		() => mdControl("probeWords.at(-1)?.start??-1"),
		(value) => value >= mdChunks[mdCursor]!.start && value < mdChunks[mdCursor]!.end,
		30,
	)
	const mdShot = await call(mdSession, "Page.captureScreenshot", { format: "png" })
	await Bun.write(`${root}/.cache/product-probe/md-dash.png`, Uint8Array.fromBase64(mdShot.data))
	await mdControl("document.querySelector('#close').click()")
	console.log("MD Dash next/previous navigation passed without restarting at the article beginning.")
	await view.evaluate("document.querySelector('section .danger').click()")
	await waitFor(
		() => view.evaluate<string>("document.querySelector('#status').textContent"),
		(value) => value.includes("deleted"),
	)
	console.log("Pause, close, and voice deletion passed.")
	await Bun.write(
		`${root}/docs/evidence/chrome-product-2026-10-30.json`,
		JSON.stringify(
			{
				recordedAt: new Date().toISOString(),
				browser: await view.cdp("Browser.getVersion"),
				voice: "en_US-ljspeech-medium",
				performance: {
					cold,
					warm,
					caveat:
						"Development VM first-buffer readiness, not target-hardware audible latency; warm uses a different opening sentence in the same live engine.",
				},
				passed: [
					"explicit download",
					"integrity",
					"model storage",
					"local speech",
					"word highlighting",
					"pause",
					"close",
					"delete",
					"repeat activation without padding changes or duplicate controls",
					"next/previous sentence",
					"actual MD Dash article sentence navigation",
				],
				limitations: [
					"Scripted entry with test-only localhost and MD Dash grants; native activeTab/context-menu activation not tested",
					"Trusted Play gesture supplied if autoplay is blocked",
					"GPU, Windows, target-device performance, and audio quality not tested",
				],
			},
			null,
			2,
		) + "\n",
	)
} finally {
	view.close()
	server.stop(true)
}
