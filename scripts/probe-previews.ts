import { getVoice, voices as catalog } from "../src/speech/catalog.ts"

const voices = [getVoice("en_US-ljspeech-medium"), getVoice("cs_CZ-jirka-medium")]

const root = import.meta.dir.replace(/\/scripts$/, "")
const extension = `${root}/.output/chrome-mv3`
for (const browser of ["chrome", "firefox"]) {
	const packaged = await Array.fromAsync(new Bun.Glob("**/*.{wav,mp3,ogg,m4a}").scan(`${root}/.output/${browser}-mv3`))
	if (packaged.length) throw new Error(`Bundled audio remains: ${packaged.join(", ")}`)
}
const candidates = await Array.fromAsync(
	new Bun.Glob("chromium-*/chrome-linux*/chrome").scan({ cwd: `${Bun.env.HOME}/.cache/ms-playwright`, absolute: true }),
)
const executable = Bun.env.BUN_CHROME_PATH ?? candidates.sort().at(-1)
const view = new Bun.WebView({
	backend: {
		type: "chrome",
		url: false,
		...(executable ? { path: executable } : {}),
		argv: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
	},
	dataStore: "ephemeral",
})
const requests: string[] = []
const waitFor = async (expression: string, accept: (value: string) => boolean) => {
	const until = performance.now() + 30_000
	let value = ""
	do {
		value = await view.evaluate<string>(expression)
		if (accept(value)) return
		await Bun.sleep(100)
	} while (performance.now() < until)
	throw new Error(`Preview check timed out: ${value}`)
}
try {
	await view.navigate("about:blank")
	await view.cdp("Network.enable")
	view.addEventListener("Network.requestWillBeSent", (event: any) => {
		const url = event.data.request.url as string
		if (/^https?:/.test(url)) requests.push(url)
	})
	const id = [...new Bun.CryptoHasher("sha256").update(extension).digest("hex").slice(0, 32)]
		.map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
		.join("")
	await view.navigate(`chrome-extension://${id}/voices.html`)
	await view.cdp("Page.bringToFront")
	await waitFor("String(document.querySelectorAll('section').length)", (value) => value === String(catalog.length))
	await Bun.sleep(300)
	if (requests.length) throw new Error(`Unexpected request before Listen: ${requests.join(", ")}`)
	for (let index = 0; index < voices.length; index++) {
		await view.cdp("Runtime.evaluate", {
			expression: `document.querySelectorAll('section')[${index}].querySelector('button').click()`,
			userGesture: true,
		})
		await waitFor(
			`document.querySelectorAll('section')[${index}].querySelector('button').textContent`,
			(value) => value === "Pause sample",
		)
		if (!requests.includes(voices[index]!.previewUrl!)) throw new Error("Expected pinned preview URL was not requested")
	}
	await view.evaluate("document.querySelectorAll('section')[1].querySelector('button').click()")
	await waitFor(
		"document.querySelectorAll('section')[1].querySelector('button').textContent",
		(value) => value === "Listen",
	)
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
		expression: "document.querySelector('section button').click()",
		userGesture: true,
	})
	await waitFor("document.querySelector('#status').textContent", (value) => value.includes("Preview unavailable"))
	console.log(
		"Both packages exclude audio. No preview prefetch. Both remote samples play; switching, stop, and offline recovery pass. No model requests.",
	)
} finally {
	view.close()
}
