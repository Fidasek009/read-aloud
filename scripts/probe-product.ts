import { $ } from "bun"

// This copied test manifest grants only the fixture origin. Native action /
// context-menu activation and the activeTab grant are not covered by this test.
const root = import.meta.dir.replace(/\/scripts$/, "")
const extension = `${root}/.cache/product-probe/chromium`
await $`rm -rf ${extension}`.quiet()
await $`mkdir -p ${extension}`.quiet()
await $`cp -R ${root + "/.output/chrome-mv3/."} ${extension}`.quiet()
const manifest = await Bun.file(`${extension}/manifest.json`).json()
assert(!manifest.host_permissions?.length, "The product must not request access to all sites")
manifest.host_permissions = ["http://127.0.0.1/*"]
await Bun.write(`${extension}/manifest.json`, JSON.stringify(manifest))
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch: () =>
		new Response(
			`<!doctype html><title>Reading fixture</title><nav>Navigation should not be read</nav><main><h1>Local reading</h1><p id="selection">One <em>natural voice</em> on your device. A second sentence keeps reading while you switch tabs. Your text stays private.</p>${"<p>Good design makes listening effortless. We can pause and continue without losing our place.</p>".repeat(12)}</main>`,
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
		(value) => value === 2,
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
	await player("document.querySelector('#play').click()")
	assert((await player("document.querySelector('#status').textContent")) === "Paused", "Pause state did not update")
	await player("document.querySelector('#close').click()")
	await waitFor(() => evaluate("document.querySelector('[data-read-aloud]') === null"), Boolean)
	await view.evaluate("document.querySelector('section .primary').click()")
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
				passed: [
					"explicit download",
					"integrity",
					"model storage",
					"local speech",
					"word highlighting",
					"pause",
					"close",
					"delete",
				],
				limitations: [
					"Scripted entry with localhost fixture permission; native activeTab/context-menu activation not tested",
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
