import { $ } from "bun"

import { nativeEntryFixture, nativeEntryState } from "./native-entry-fixture.ts"
import { pageScript } from "./page-script.ts"
import { assert, chromeExecutable, chromeExtensionId, projectRoot, waitFor } from "./probe-helpers.ts"

function elementCenter(selector: string) {
	const element = document.querySelector(selector)
	if (!element) throw Error(`Missing element: ${selector}`)
	const rect = element.getBoundingClientRect()
	return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

function selectionPoint() {
	const rect = window.getSelection()?.getRangeAt(0).getClientRects()[0]
	if (!rect) throw Error("Selection rectangle is missing")
	return { x: rect.x + 3, y: rect.y + rect.height / 2 }
}

const fixture = await nativeEntryFixture("chrome")
const { extension, server, voice, text } = fixture
const profile = projectRoot + "/.cache/native-entry-chrome-profile-" + crypto.randomUUID()
await $`mkdir -p ${profile}`.quiet()
const chrome = Bun.spawn(
	[
		(await chromeExecutable())!,
		"--user-data-dir=" + profile,
		"--remote-debugging-port=0",
		"--no-first-run",
		"--no-default-browser-check",
		"--no-sandbox",
		"--password-store=basic",
		"--disable-extensions-except=" + extension,
		"--load-extension=" + extension,
		"--window-size=1100,800",
		"about:blank",
	],
	{ stdout: "ignore", stderr: "pipe" },
)
const chromeLog = new Response(chrome.stderr).text()
let closeView: (() => void) | undefined
try {
	const connection = await waitFor(
		async () => {
			if (chrome.exitCode !== null) throw Error(await chromeLog)
			const f = Bun.file(profile + "/DevToolsActivePort")
			return (await f.exists()) ? await f.text() : ""
		},
		Boolean,
		20,
	)
	const [port, path] = connection.trim().split("\n")
	const view = new Bun.WebView({ backend: { type: "chrome", url: "ws://127.0.0.1:" + port + path } })
	closeView = () => view.close()
	let sequence = 0
	const scriptErrors: unknown[] = []
	const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>()
	view.addEventListener("Target.receivedMessageFromTarget", (event: any) => {
		const m = JSON.parse(event.data.message)
		if (m.id) {
			const p = pending.get(m.id)
			pending.delete(m.id)
			if (m.error) p?.reject(Error(m.error.message))
			else p?.resolve(m.result)
		}
		if (m.method === "Runtime.exceptionThrown") scriptErrors.push(m.params.exceptionDetails)
	})
	async function call(session: string, method: string, params: object = {}) {
		const id = ++sequence
		const result = new Promise<any>((resolve, reject) => {
			const timer = setTimeout(() => {
				pending.delete(id)
				reject(Error(method + " timed out"))
			}, 30_000)
			pending.set(id, {
				resolve: (v) => {
					clearTimeout(timer)
					resolve(v)
				},
				reject: (e) => {
					clearTimeout(timer)
					reject(e)
				},
			})
		})
		await view.cdp("Target.sendMessageToTarget", {
			sessionId: session,
			message: JSON.stringify({ id, method, params }),
		})
		return result
	}
	async function remote(session: string, expression: string) {
		const x = await call(session, "Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
			userGesture: false,
		})
		if (x.exceptionDetails) throw Error(JSON.stringify(x.exceptionDetails))
		return x.result.value
	}
	async function click(selector: string) {
		await view.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`)
		const r = await view.evaluate<{ x: number; y: number }>(pageScript(elementCenter, selector))
		await view.cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...r, button: "left", clickCount: 1 })
		await view.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...r, button: "left", clickCount: 1 })
	}
	await view.navigate("chrome-extension://" + chromeExtensionId(extension) + "/voices.html")
	await waitFor(() => view.evaluate(`!!document.querySelector('[data-voice="${voice.id}"] .primary')`), Boolean, 20)
	await click(`[data-voice="${voice.id}"] .primary`)
	await waitFor(() => view.evaluate(`!!document.querySelector('[data-voice="${voice.id}"] .danger')`), Boolean, 180)
	await view.evaluate(`chrome.storage.local.set({voice:"${voice.id}"})`)
	console.log("Downloaded through production control:", voice.id)
	await view.navigate(server.url.href)
	await view.cdp("Page.bringToFront")
	const xdo = Bun.env.XDOTOOL ?? "xdotool"
	const windowIds = (
		await $`${xdo} search --onlyvisible --all --pid ${chrome.pid} --name "^Native entry fixture"`.text()
	)
		.trim()
		.split("\n")
	assert(windowIds.length === 1 && /^\d+$/u.test(windowIds[0]!), "Cannot identify the fixture's native window")
	await $`${xdo} windowfocus --sync ${windowIds[0]!}`.quiet()
	const visibleWindows = async () =>
		(await $`${xdo} search --onlyvisible --pid ${chrome.pid}`.text()).trim().split("\n")
	const beforeMenu = new Set(await visibleWindows())
	await view.evaluate('window.getSelection().selectAllChildren(document.querySelector("#selection"))')
	const r = await view.evaluate<{ x: number; y: number }>(pageScript(selectionPoint))
	await view.cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...r, button: "right", clickCount: 1 })
	await view.cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...r, button: "right", clickCount: 1 })
	await waitFor(async () => (await visibleWindows()).some((id) => !beforeMenu.has(id)), Boolean, 5)
	// OS keys select the actual Chromium-owned context menu, never our handler.
	await $`${xdo} key --clearmodifiers End Up Return`.quiet()
	console.log("Activated native Chrome menu with OS keyboard")
	await waitFor(() => view.evaluate('!!document.querySelector("[data-read-aloud]")'), Boolean, 20)
	const target = await waitFor(
		async () => {
			const x = await view.cdp<any>("Target.getTargets")
			return x.targetInfos.find((t: any) => t.type === "iframe" && t.url.includes("/player.html"))
		},
		Boolean,
		20,
	)
	assert(target && typeof target === "object" && "targetId" in target, "Player target is missing")
	const { sessionId } = await view.cdp<any>("Target.attachToTarget", { targetId: target.targetId, flatten: false })
	await call(sessionId, "Runtime.enable")
	const state = await waitFor(
		() => remote(sessionId, pageScript(nativeEntryState)),
		(x) => x.time > 0,
		180,
	)
	const source = await remote(
		sessionId,
		'chrome.runtime.sendMessage({type:"reader",session:location.hash.slice(1),command:"document"})',
	)
	assert(source.text === text, "Native reader escaped the selected text")
	assert(scriptErrors.length === 0, "Uncaught player exceptions: " + JSON.stringify(scriptErrors))
	const version = await view.cdp<{ product: string }>("Browser.getVersion")
	await fixture.record(version.product, state.time)
	console.log("PASS native Chrome automatic playback and exact selection", voice.id)
} finally {
	closeView?.()
	Bun.WebView.closeAll()
	chrome.kill()
	await chrome.exited
	console.log((await chromeLog).slice(-1000))
	await $`rm -rf ${profile}`.quiet()
	await fixture.close()
}
