import { getVoice, voices as catalog } from "../src/speech/catalog.ts"
import {
	chromeExtensionId,
	closeChromeProbe,
	copyProbeExtension,
	createChromeProbe,
	projectRoot,
	waitFor as poll,
} from "./probe-helpers.ts"

const voices = [getVoice("en_US-ljspeech-medium"), getVoice("cs_CZ-jirka-medium")]

const root = projectRoot
const extension = `${root}/.cache/preview-probe`
await copyProbeExtension("chrome", extension)
for (const browser of ["chrome", "firefox"]) {
	const packaged = await Array.fromAsync(new Bun.Glob("**/*.{wav,mp3,ogg,m4a}").scan(`${root}/.output/${browser}-mv3`))
	if (packaged.length) throw new Error(`Bundled audio remains: ${packaged.join(", ")}`)
}
const view = await createChromeProbe(extension)
const requests: string[] = []
const waitFor = (expression: string, accept: (value: string) => boolean) =>
	poll(() => view.evaluate<string>(expression), accept, 30)

try {
	await view.navigate("about:blank")
	await view.cdp("Network.enable")
	view.addEventListener("Network.requestWillBeSent", (event: any) => {
		const url = event.data.request.url as string
		if (/^https?:/.test(url)) requests.push(url)
	})
	const id = chromeExtensionId(extension)
	await view.navigate(`chrome-extension://${id}/voices.html`)
	await view.cdp("Page.bringToFront")
	await waitFor("String(document.querySelectorAll('section').length)", (value) => value === String(catalog.length))
	if (requests.length) throw new Error(`Unexpected request before Listen: ${requests.join(", ")}`)
	for (const voice of voices) {
		const selector = `[data-voice="${voice.id}"] [data-action="preview"]`
		await view.cdp("Runtime.evaluate", {
			expression: `document.querySelector(${JSON.stringify(selector)}).click()`,
			userGesture: true,
		})
		await waitFor(
			`document.querySelector(${JSON.stringify(selector)}).textContent`,
			(value) => value === "Pause sample",
		)
		if (!requests.includes(voice.previewUrl!)) throw new Error("Expected pinned preview URL was not requested")
		if (voice === voices[0]) {
			const unchanged = await view.evaluate<boolean>(`(() => {
				const button = document.querySelector(${JSON.stringify(selector)});
				const search = document.querySelector('#search');
				search.value = 'no matching voice';
				search.dispatchEvent(new Event('input', {bubbles:true}));
				const filtered = button.closest('section').hidden && button.textContent === 'Pause sample';
				search.value = '';
				search.dispatchEvent(new Event('input', {bubbles:true}));
				return filtered && button === document.querySelector(${JSON.stringify(selector)}) &&
					!button.closest('section').hidden && button.textContent === 'Pause sample';
			})()`)
			if (!unchanged) throw new Error("Filtering interrupted or rebuilt the playing preview")
		}
	}
	const secondSelector = `[data-voice="${voices[1]!.id}"] [data-action="preview"]`
	await view.evaluate(`document.querySelector(${JSON.stringify(secondSelector)}).click()`)
	await waitFor(`document.querySelector(${JSON.stringify(secondSelector)}).textContent`, (value) => value === "Listen")
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
	console.log(
		"Both packages exclude audio. No preview prefetch. Both remote samples play; switching, stop, and offline recovery pass. No model requests.",
	)
} finally {
	await closeChromeProbe(view)
}
