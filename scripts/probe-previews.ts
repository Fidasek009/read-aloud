import { voices as catalog } from "../src/speech/catalog.ts"
import { pageScript } from "./page-script.ts"
import {
	chromeExtensionId,
	closeChromeProbe,
	copyProbeExtension,
	createChromeProbe,
	projectRoot,
	waitFor as poll,
} from "./probe-helpers.ts"

const voices = catalog.filter((voice) => voice.previewUrl)
if (!voices.length) throw new Error("No catalog previews are available to verify")

const root = projectRoot
const extension = `${root}/.cache/preview-probe`
await copyProbeExtension("chrome", extension)
for (const browser of ["chrome", "firefox"]) {
	const packaged = await Array.fromAsync(new Bun.Glob("**/*.{wav,mp3,ogg,m4a}").scan(`${root}/.output/${browser}-mv3`))
	if (packaged.length) throw new Error(`Bundled audio remains: ${packaged.join(", ")}`)
}
// Disposable fixture profile; this VM cannot launch Chromium's OS sandbox.
const view = await createChromeProbe(extension, ["--headless=new", "--no-sandbox"])
const requests: string[] = []
const networkFailures: Array<{ url: string | undefined; errorText: string }> = []
const requestUrls = new Map<string, string>()
const retried: string[] = []
const waitFor = (expression: string, accept: (value: string) => boolean) =>
	poll(() => view.evaluate<string>(expression), accept, 30)

interface PreviewAudioObservation {
	__previewFailures: { url: string; error: string; media?: string }[]
	__previewAudio?: HTMLAudioElement
}

/** Self-contained: installed before page scripts to observe the catalog player. */
function installPreviewAudioObservation() {
	const probe = globalThis as unknown as typeof globalThis & PreviewAudioObservation
	probe.__previewFailures = []
	probe.Audio = new Proxy(probe.Audio, {
		construct(target, args) {
			const audio = Reflect.construct(target, args) as HTMLAudioElement
			probe.__previewAudio = audio
			const play = audio.play.bind(audio)
			audio.play = () =>
				play().catch((error: unknown) => {
					probe.__previewFailures.push({
						url: audio.currentSrc,
						error: String(error),
						...(audio.error ? { media: audio.error.message } : {}),
					})
					throw error
				})
			return audio
		},
	})
}

/** Self-contained: filtering must not interrupt or rebuild the playing preview. */
function previewSurvivesFilter(selector: string) {
	const button = document.querySelector<HTMLButtonElement>(selector)
	const search = document.querySelector<HTMLInputElement>("#search")
	const section = button?.closest("section")
	if (!button || !search || !section) throw Error("Preview controls are missing")
	search.value = "no matching voice"
	search.dispatchEvent(new Event("input", { bubbles: true }))
	const filtered = section.hidden && button.textContent === "Pause sample"
	search.value = ""
	search.dispatchEvent(new Event("input", { bubbles: true }))
	return (
		filtered && button === document.querySelector(selector) && !section.hidden && button.textContent === "Pause sample"
	)
}

try {
	await view.navigate("about:blank")
	await view.cdp("Network.enable")
	await view.cdp("Page.addScriptToEvaluateOnNewDocument", {
		source: pageScript(installPreviewAudioObservation),
	})
	const exceptions: string[] = []
	view.addEventListener("Runtime.exceptionThrown", (event: any) => {
		exceptions.push(JSON.stringify(event.data.exceptionDetails))
	})
	view.addEventListener("Network.requestWillBeSent", (event: any) => {
		const url = event.data.request.url as string
		requestUrls.set(event.data.requestId, url)
		if (/^https?:/.test(url)) requests.push(url)
	})
	view.addEventListener("Network.loadingFailed", (event: any) => {
		if (!event.data.canceled)
			networkFailures.push({ url: requestUrls.get(event.data.requestId), errorText: event.data.errorText })
	})
	view.addEventListener("Network.responseReceived", (event: any) => {
		if (event.data.response.status >= 400)
			networkFailures.push({ url: event.data.response.url, errorText: `HTTP ${event.data.response.status}` })
	})
	const id = chromeExtensionId(extension)
	await view.navigate(`chrome-extension://${id}/voices.html`)
	await view.cdp("Page.bringToFront")
	await waitFor("String(document.querySelectorAll('section').length)", (value) => value === String(catalog.length))
	if (requests.length) throw new Error(`Unexpected request before Listen: ${requests.join(", ")}`)
	for (const voice of voices) {
		const selector = `[data-voice="${voice.id}"] [data-action="preview"]`
		for (let attempt = 0; ; attempt++) {
			await view.cdp("Runtime.evaluate", {
				expression: `document.querySelector(${JSON.stringify(selector)}).click()`,
				userGesture: true,
			})
			try {
				await waitFor(
					`document.querySelector(${JSON.stringify(selector)}).textContent`,
					(value) => value === "Pause sample",
				)
				await waitFor("String(globalThis.__previewAudio?.currentTime ?? 0)", (value) => Number(value) > 0)
				break
			} catch (cause) {
				// Exercise the existing user retry after the VM's network-change
				// notification. Decode/script errors and a second failure stay fatal.
				if (
					attempt === 0 &&
					networkFailures.some(
						(failure) => failure.url === voice.previewUrl && failure.errorText === "net::ERR_NETWORK_CHANGED",
					)
				) {
					retried.push(voice.id)
					if (
						(await view.evaluate<string>(`document.querySelector(${JSON.stringify(selector)}).textContent`)) !==
						"Listen"
					)
						await view.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`)
					continue
				}
				const detail = await view.evaluate<string>(
					"JSON.stringify({status:document.querySelector('#status').textContent,failures:globalThis.__previewFailures})",
				)
				throw new Error(`Preview failed for ${voice.id}: ${detail}; network: ${JSON.stringify(networkFailures)}`, {
					cause,
				})
			}
		}
		const duration = await view.evaluate<number>("globalThis.__previewAudio.duration")
		if (!Number.isFinite(duration) || duration < 2 || duration > 30)
			throw new Error(`Invalid preview duration for ${voice.id}: ${duration}`)
		if (!requests.includes(voice.previewUrl!)) throw new Error("Expected pinned preview URL was not requested")
		if (voice === voices[0]) {
			const unchanged = await view.evaluate<boolean>(pageScript(previewSurvivesFilter, selector))
			if (!unchanged) throw new Error("Filtering interrupted or rebuilt the playing preview")
		}
	}
	const lastSelector = `[data-voice="${voices.at(-1)!.id}"] [data-action="preview"]`
	await view.evaluate(`document.querySelector(${JSON.stringify(lastSelector)}).click()`)
	await waitFor(`document.querySelector(${JSON.stringify(lastSelector)}).textContent`, (value) => value === "Listen")
	if (requests.some((url) => !voices.some((voice) => voice.previewUrl === url)))
		throw new Error("A preview fetched something other than its audio")
	await view.cdp("Network.emulateNetworkConditions", {
		offline: true,
		latency: 0,
		downloadThroughput: 0,
		uploadThroughput: 0,
	})
	await view.cdp("Network.setCacheDisabled", { cacheDisabled: true })
	await view.cdp("Runtime.evaluate", {
		expression: `document.querySelector(${JSON.stringify(`[data-voice="${voices[0]!.id}"] [data-action="preview"]`)}).click()`,
		userGesture: true,
	})
	await waitFor("document.querySelector('#status').textContent", (value) => value.includes("Preview unavailable"))
	if (exceptions.length) throw new Error(`Browser exceptions: ${exceptions.join("; ")}`)
	console.log(
		`Both packages exclude audio. No preview prefetch. All ${voices.length} catalog samples play; switching, stop, and offline recovery pass. No model requests. Network-change retries: ${retried.length} (${retried.join(", ")}).`,
	)
} finally {
	await closeChromeProbe(view)
}
