import { $ } from "bun"

import { nativeEntryFixture, nativeEntryState } from "./native-entry-fixture.ts"
import { pageScript } from "./page-script.ts"
import { assert, projectRoot, waitFor } from "./probe-helpers.ts"

function selectFixtureText() {
	const selection = window.getSelection()
	const source = document.querySelector("#selection")
	if (!selection || !source) throw Error("Selection fixture is missing")
	selection.selectAllChildren(source)
	return selection.toString()
}

function selectionPoint() {
	const rect = window.getSelection()?.getRangeAt(0).getClientRects()[0]
	if (!rect) throw Error("Selection rectangle is missing")
	return { x: Math.round(rect.x + 3), y: Math.round(rect.y + rect.height / 2) }
}

const fixture = await nativeEntryFixture("firefox")
const { extension, manifest, server, voice, text } = fixture
const uuid = crypto.randomUUID()
await $`mkdir -p ${projectRoot + "/.cache/native-entry-profiles"}`.quiet()
const driver = Bun.spawn(
	[
		Bun.env.GECKODRIVER ?? "/snap/bin/geckodriver",
		"--allow-system-access",
		"--port",
		"0",
		"--profile-root",
		projectRoot + "/.cache/native-entry-profiles",
	],
	{ stdout: "pipe", stderr: "pipe" },
)
let log = "",
	endpoint = "",
	session = ""
async function consume(s: ReadableStream<Uint8Array>) {
	for await (const c of s) log += new TextDecoder().decode(c)
}
const readers = Promise.all([consume(driver.stdout), consume(driver.stderr)])
async function command(path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<any> {
	const r = await fetch(endpoint + path, {
		method,
		headers: { "Content-Type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
		signal: AbortSignal.timeout(240_000),
	})
	const x: any = await r.json()
	if (!r.ok || x.value?.error) throw Error(JSON.stringify(x))
	return x.value
}
const run = (path: string, body?: unknown, method?: string) => command("/session/" + session + path, body, method)
const script = (s: string, args: unknown[] = []) => run("/execute/sync", { script: s, args })
const evaluate = <T>(expression: string) => script(`return (${expression})`) as Promise<T>
async function element(selector: string) {
	return run("/element", { using: "css selector", value: selector })
}
try {
	endpoint = await waitFor(
		async () => {
			if (driver.exitCode !== null) throw Error(log)
			const m = log.match(/Listening on (127\.0\.0\.1:\d+)/)
			return m ? "http://" + m[1] : ""
		},
		Boolean,
		30,
	)
	const created = await command("/session", {
		capabilities: {
			alwaysMatch: {
				browserName: "firefox",
				"moz:firefoxOptions": {
					binary: Bun.env.FIREFOX_BINARY ?? "/snap/firefox/current/usr/lib/firefox/firefox",
					args: ["-headless"],
					prefs: {
						"extensions.webextensions.uuids": JSON.stringify({ [manifest.browser_specific_settings.gecko.id]: uuid }),
					},
				},
			},
		},
	})
	session = created.sessionId
	await run("/timeouts", { script: 240_000, pageLoad: 30_000 })
	await run("/moz/addon/install", { path: extension, temporary: true })

	await waitFor(
		async () => {
			for (const h of await run("/window/handles")) {
				await run("/window", { handle: h })
				if ((await run("/url")).endsWith("/voices.html")) {
					return true
				}
			}
			return false
		},
		Boolean,
		20,
	)
	await waitFor(() => script(`return !!document.querySelector('[data-voice="${voice.id}"] .primary')`), Boolean, 20)
	const download = await element(`[data-voice="${voice.id}"] .primary`)
	await run("/element/" + download["element-6066-11e4-a52e-4f735466cecf"] + "/click", {})
	await waitFor(() => script(`return !!document.querySelector('[data-voice="${voice.id}"] .danger')`), Boolean, 180)
	await script(`return browser.storage.local.set({voice:"${voice.id}"})`)
	console.log("Downloaded through production control:", voice.id)
	await run("/window/new", { type: "tab" }).then((x) => run("/window", { handle: x.handle }))
	await run("/url", { url: server.url.href })
	await evaluate<string>(pageScript(selectFixtureText))
	const point = await evaluate<{ x: number; y: number }>(pageScript(selectionPoint))
	await run("/actions", {
		actions: [
			{
				type: "pointer",
				id: "native-context",
				parameters: { pointerType: "mouse" },
				actions: [
					{ type: "pointerMove", duration: 0, origin: "viewport", x: point.x, y: point.y },
					{ type: "pointerDown", button: 2 },
					{ type: "pointerUp", button: 2 },
				],
			},
		],
	})
	await run("/moz/context", { context: "chrome" })
	assert(
		await script('return document.getElementById("contentAreaContextMenu").state === "open"'),
		"Native Firefox menu did not open",
	)
	const menu = await element('menuitem[label="Read selection"]')
	await run("/element/" + menu["element-6066-11e4-a52e-4f735466cecf"] + "/click", {})
	await run("/moz/context", { context: "content" })
	const frame = await waitFor(
		() => script('return document.querySelector("[data-read-aloud]")?.shadowRoot?.querySelector("iframe")'),
		Boolean,
		20,
	)
	await run("/frame", { id: frame })
	const state = await waitFor(
		() => evaluate<ReturnType<typeof nativeEntryState>>(pageScript(nativeEntryState)),
		(x) => x.time > 0,
		180,
	)
	const source = await script(
		'return browser.runtime.sendMessage({type:"reader",session:location.hash.slice(1),command:"document"})',
	)
	assert(source.text === text, "Native reader escaped the selected text")
	await fixture.record(created.capabilities.browserVersion, state.time)
	console.log("PASS native Firefox automatic playback and exact selection", voice.id)
} finally {
	if (session) await command("/session/" + session, undefined, "DELETE").catch(() => {})
	driver.kill()
	await driver.exited
	await readers
	await fixture.close()
}
