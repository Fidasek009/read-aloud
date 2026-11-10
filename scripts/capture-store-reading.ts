import type { browser } from "wxt/browser"

import { observePlayerAudio } from "./check-player-controls"
import { pageScript, readHighlightedText } from "./page-script"
import {
	assert,
	chromeExtensionId,
	closeChromeProbe,
	copyProbeExtension,
	createChromeProbe,
	projectRoot,
	waitFor,
} from "./probe-helpers"

const passage =
	"The train leaves the city behind. Beyond the window, the houses give way to fields and a narrow river. A reader folds the corner of a page, puts the book down and watches the water. There is time to finish the chapter before the next station."

const article = `<!doctype html><html lang="en"><meta charset="utf-8"><title>A seat by the window</title><style>
*{box-sizing:border-box}body{margin:0;background:#faf7f1;color:#24211e}header{padding:26px 56px;border-bottom:1px solid #dfd7ca;font:14px system-ui,sans-serif;letter-spacing:1px}main{max-width:780px;margin:65px auto;padding:0 30px}h1{font:52px Georgia,serif;letter-spacing:-1.5px;margin:16px 0 24px}p{font:23px/1.75 Georgia,serif}.note{font:14px/1.5 system-ui,sans-serif;color:#685e50}hr{border:0;border-top:1px solid #dfd7ca;margin:28px 0}
</style><header>SYLLUNE DEMO ARTICLE</header><main><p class="note">Original text for this demonstration</p><h1>A seat by the window</h1><p id="passage">${passage}</p><hr><p class="note">This paragraph is outside the selected passage.</p><p>The next stop is still a few miles away. Someone opens a notebook and writes down the name of the river.</p></main></html>`

async function evaluateTarget(
	view: Bun.WebView,
	targetId: string,
	expression: string,
	userGesture = false,
): Promise<unknown> {
	const { sessionId } = await view.cdp<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: false })
	let receive: EventListener | undefined
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		const response = new Promise<unknown>((resolve, reject) => {
			timer = setTimeout(() => reject(new Error("Store capture script timed out")), 30_000)
			receive = (event) => {
				if (!("data" in event) || !event.data || typeof event.data !== "object") return
				if (!("sessionId" in event.data) || event.data.sessionId !== sessionId) return
				if (!("message" in event.data) || typeof event.data.message !== "string") return
				try {
					const message: unknown = JSON.parse(event.data.message)
					if (!message || typeof message !== "object" || !("id" in message) || message.id !== 1) return
					if ("error" in message) throw new Error(JSON.stringify(message.error))
					if (!("result" in message) || !message.result || typeof message.result !== "object")
						throw new Error("Invalid store capture response")
					if ("exceptionDetails" in message.result) throw new Error(JSON.stringify(message.result.exceptionDetails))
					const result = "result" in message.result ? message.result.result : undefined
					resolve(result && typeof result === "object" && "value" in result ? result.value : undefined)
				} catch (error) {
					reject(error)
				}
			}
			view.addEventListener("Target.receivedMessageFromTarget", receive)
		})
		await view.cdp("Target.sendMessageToTarget", {
			sessionId,
			message: JSON.stringify({
				id: 1,
				method: "Runtime.evaluate",
				params: { expression, awaitPromise: true, returnByValue: true, userGesture },
			}),
		})
		return await response
	} finally {
		clearTimeout(timer)
		if (receive) view.removeEventListener("Target.receivedMessageFromTarget", receive)
		await view.cdp("Target.detachFromTarget", { sessionId })
	}
}

async function startSelection(url: string, voice: string): Promise<void> {
	const api = (globalThis as unknown as { chrome: typeof browser }).chrome
	const [tab] = await api.tabs.query({ url })
	if (tab?.id === undefined) throw new Error("Demo article tab is missing")
	await api.storage.local.set({ voice })
	await api.scripting.executeScript({ target: { tabId: tab.id }, files: ["/content-scripts/reader.js"] })
	await api.scripting.executeScript({
		target: { tabId: tab.id },
		func: () => {
			const paragraph = document.querySelector("#passage")
			if (!paragraph) throw new Error("Demo passage is missing")
			window.getSelection()?.selectAllChildren(paragraph)
		},
	})
	const result: unknown = await api.tabs.sendMessage(tab.id, {
		type: "start-reading",
		mode: "selection",
		reveal: false,
	})
	if (!result || typeof result !== "object" || !("ok" in result) || result.ok !== true)
		throw new Error(`Demo reader did not start: ${JSON.stringify(result)}`)
}

function downloadState(voice: string): boolean {
	const card = document.querySelector(`[data-voice="${voice}"]`)
	const error = card?.querySelector(".download-status.error")?.textContent
	if (error) throw new Error(error)
	return !!card?.querySelector(".danger")
}

type PlaybackState = {
	played: boolean
	status: string | undefined
	visibility: DocumentVisibilityState
	disabled: boolean
	audio: { time: number; paused: boolean; error: number | undefined }[]
}

async function playerState(action: "play" | "pause", expected: string): Promise<PlaybackState> {
	const probe = window as unknown as { __probeAudio: { elements: HTMLAudioElement[] } }
	const error = document.documentElement.dataset.probeError ?? document.documentElement.dataset.probeRejection
	if (error) throw new Error(error)
	const api = (globalThis as unknown as { chrome: typeof browser }).chrome
	const source: unknown = await api.runtime.sendMessage({
		type: "reader",
		session: location.hash.slice(1),
		command: "document",
	})
	if (!source || typeof source !== "object" || !("text" in source) || source.text !== expected)
		throw new Error("The demo reader escaped the selected passage")
	const play = document.querySelector<HTMLButtonElement>("#play")
	if (play && !play.disabled) {
		if (action === "play" && play.getAttribute("aria-label") === "Play") play.click()
		if (action === "pause" && play.getAttribute("aria-label") === "Pause") play.click()
	}
	return {
		played: probe.__probeAudio.elements.some((audio) => audio.currentTime > 0),
		status: document.querySelector("#status")?.textContent ?? undefined,
		visibility: document.visibilityState,
		disabled: !play || play.disabled,
		audio: probe.__probeAudio.elements.map((audio) => ({
			time: audio.currentTime,
			paused: audio.paused,
			error: audio.error?.code,
		})),
	}
}

function hasPlayed(value: unknown): boolean {
	return !!value && typeof value === "object" && "played" in value && value.played === true
}

export async function captureStoreReading(): Promise<void> {
	const extension = `${projectRoot}/.cache/store-reading-${crypto.randomUUID()}`
	await copyProbeExtension("chrome", extension)
	await observePlayerAudio(extension)
	const manifest: unknown = await Bun.file(`${extension}/manifest.json`).json()
	assert(
		manifest && typeof manifest === "object" && "manifest_version" in manifest && manifest.manifest_version === 3,
		"Invalid capture manifest",
	)
	await Bun.write(
		`${extension}/manifest.json`,
		JSON.stringify({ ...manifest, host_permissions: ["http://127.0.0.1/*"] }),
	)
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () => new Response(article, { headers: { "Content-Type": "text/html;charset=utf-8" } }),
	})
	const view = await createChromeProbe(extension, ["--headless=new", "--no-sandbox"])
	const id = chromeExtensionId(extension)
	const voice = "en_US-ljspeech-medium"
	const target = async (kind: "service_worker" | "iframe"): Promise<string> => {
		const found = await waitFor(
			async () => {
				const { targetInfos } = await view.cdp<{ targetInfos: { targetId: string; type: string; url: string }[] }>(
					"Target.getTargets",
				)
				return targetInfos.find((item) => item.type === kind && item.url.startsWith(`chrome-extension://${id}/`))
			},
			Boolean,
			20,
		)
		assert(found, `Missing capture target: ${kind}`)
		return found.targetId
	}
	try {
		await view.navigate(`chrome-extension://${id}/voices.html`)
		await view.cdp("Emulation.setDeviceMetricsOverride", {
			width: 1280,
			height: 800,
			deviceScaleFactor: 1,
			mobile: false,
		})
		await view.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] })
		await waitFor(
			() =>
				view.evaluate(pageScript((name: string) => !!document.querySelector(`[data-voice="${name}"] .primary`), voice)),
			Boolean,
		)
		await view.evaluate(
			pageScript(
				(name: string) => document.querySelector<HTMLButtonElement>(`[data-voice="${name}"] .primary`)?.click(),
				voice,
			),
		)
		console.log(`Store reading capture: downloading ${voice} through the product control.`)
		await waitFor(() => view.evaluate<boolean>(pageScript(downloadState, voice)), Boolean, 180)
		console.log("Store reading capture: voice installed; starting the selected demo passage.")
		const worker = await target("service_worker")
		await view.navigate(server.url.href)
		await view.cdp("Page.bringToFront")
		await evaluateTarget(view, worker, pageScript(startSelection, server.url.href, voice))
		const player = await target("iframe")
		await waitFor(
			() =>
				evaluateTarget(
					view,
					player,
					pageScript(() => !!document.querySelector("#bar")),
				),
			Boolean,
		)
		console.log("Store reading capture: waiting for the local audio clock.")
		await waitFor(() => evaluateTarget(view, player, pageScript(playerState, "play", passage), true), hasPlayed, 180)
		await waitFor(
			() => view.evaluate<string>(readHighlightedText),
			(word) => word.length > 0,
		)
		assert(
			hasPlayed(await evaluateTarget(view, player, pageScript(playerState, "pause", passage))),
			"The demo did not play real audio",
		)
		assert(await view.evaluate<string>(readHighlightedText), "The paused demo has no word highlight")
		const shot = await view.cdp<{ data: string }>("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: false,
		})
		await Bun.write(`${projectRoot}/store/assets/reading-selection.png`, Uint8Array.fromBase64(shot.data))
		console.log(
			"Captured real local speech and highlighting on an original demo article; scripted entry with a localhost-only test grant.",
		)
	} finally {
		await closeChromeProbe(view)
		await server.stop(true)
		await Bun.$`rm -rf ${extension}`.quiet()
	}
}
