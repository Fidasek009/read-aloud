import { $ } from "bun"

import type { ComputeMode, ProbeResult } from "../src/contracts.ts"

import { engine, outputRoot, resolve, root } from "./assets.ts"

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message)
}
const browser = Bun.argv[2]
const provider = (Bun.argv[3] ?? "auto") as ComputeMode
const optimization = Bun.env.BUN_LAB_OPTIMIZATION ?? "basic"
const probeOptions = { provider, optimization }
assert(browser && ["chromium", "firefox"].includes(browser), "Choose chromium or firefox")
assert(["auto", "cpu", "gpu"].includes(provider), "Choose auto, cpu, or gpu")
const results = resolve(root, "results", engine)
await $`mkdir -p ${results}`.quiet()
const build = await Bun.file(resolve(outputRoot, "build-info.json")).json()
let result: ProbeResult
let browserVersion: string
let offlineMethod: string

if (browser === "chromium") {
	const extension = resolve(outputRoot, "chromium")
	let executable = Bun.env.BUN_CHROME_PATH
	const cache = `${Bun.env.HOME ?? ""}/.cache/ms-playwright`
	if (!executable) {
		const candidates = await Array.fromAsync(
			new Bun.Glob("chromium-*/chrome-linux*/chrome").scan({ cwd: cache, absolute: true }),
		)
		executable = candidates.sort().at(-1)
	}
	const view = new Bun.WebView({
		backend: {
			type: "chrome",
			url: false,
			...(executable ? { path: executable } : {}),
			argv: [
				`--disable-extensions-except=${extension}`,
				`--load-extension=${extension}`,
				"--proxy-server=http://127.0.0.1:9",
			],
		},
		dataStore: "ephemeral",
	})
	try {
		await view.navigate("about:blank")
		const version = (await view.cdp("Browser.getVersion")) as { product: string }
		browserVersion = version.product
		const targets = (await view.cdp("Target.getTargets")) as { targetInfos: { url: string }[] }
		// Chromium derives an unpacked extension's ID from its absolute directory.
		// Match this lab specifically; Chromium can also expose component workers.
		const id = [...new Bun.CryptoHasher("sha256").update(extension).digest("hex").slice(0, 32)]
			.map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
			.join("")
		const background = targets.targetInfos.find((target) => target.url === `chrome-extension://${id}/background.js`)
		assert(background, "Chromium did not load the temporary lab extension")
		await view.cdp("Network.enable")
		await view.cdp("Network.emulateNetworkConditions", {
			offline: true,
			latency: 0,
			downloadThroughput: 0,
			uploadThroughput: 0,
		})
		const remoteRequests: string[] = []
		view.addEventListener("Network.requestWillBeSent", (event: unknown) => {
			if (!event || typeof event !== "object" || !("data" in event)) return
			const data = event.data
			if (!data || typeof data !== "object" || !("request" in data)) return
			const request = data.request
			if (
				request &&
				typeof request === "object" &&
				"url" in request &&
				typeof request.url === "string" &&
				/^https?:/.test(request.url)
			) {
				remoteRequests.push(request.url)
			}
		})
		offlineMethod =
			"Bun.WebView CDP offline mode, closed HTTP/HTTPS proxy, extension CSP, and local-only worker fetch guard"
		await view.navigate(`chrome-extension://${id}/probe.html`)
		result = (await view.evaluate(`window.runLab(${JSON.stringify(probeOptions)})`)) as ProbeResult
		result.remoteRequests = remoteRequests
	} finally {
		view.close()
	}
} else {
	const profiles = resolve(results, "profiles")
	await $`mkdir -p ${profiles}`.quiet()
	// Ubuntu's snap needs a profile directory visible inside its sandbox.
	const driver = Bun.spawn(
		[
			Bun.env.GECKODRIVER ?? "/snap/bin/geckodriver",
			"--port",
			"0",
			"--profile-root",
			profiles,
			"--allow-system-access",
		],
		{
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		},
	)
	let log = ""
	let sessionId: string | null = null
	let endpoint: string | undefined
	let acceptReady: (endpoint: string) => void
	let rejectReady: (error: Error) => void
	const ready = new Promise<string>((resolveReady, reject) => {
		acceptReady = resolveReady
		rejectReady = reject
	})
	const timeout = setTimeout(() => rejectReady(new Error("Geckodriver did not start in 30 seconds")), 30_000)
	const consume = async (stream: ReadableStream<Uint8Array>) => {
		const decoder = new TextDecoder()
		for await (const chunk of stream) {
			log += decoder.decode(chunk, { stream: true })
			const match = log.match(/Listening on (127\.0\.0\.1:\d+)/)
			if (match) {
				clearTimeout(timeout)
				acceptReady(`http://${match[1]}`)
			}
		}
	}
	const readers = [consume(driver.stdout), consume(driver.stderr)]
	void driver.exited.then((code) => {
		clearTimeout(timeout)
		rejectReady(new Error(`Geckodriver exited ${code}: ${log.slice(-2000)}`))
	})
	try {
		endpoint = await ready
		const command = async <T = unknown>(path: string, body?: unknown, method = "POST"): Promise<T> => {
			const response = await fetch(`${endpoint}${path}`, {
				method,
				headers: { "Content-Type": "application/json" },
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(240_000),
			})
			const { value } = (await response.json()) as { value: T }
			if (!response.ok) {
				const message =
					value && typeof value === "object" && "message" in value ? String(value.message) : response.statusText
				throw new Error(`WebDriver HTTP ${response.status}: ${message.slice(0, 1000)}`)
			}
			return value
		}
		const uuid = "b953b839-8258-4fc0-babb-bb02025cfab8"
		const session = await command<{ sessionId: string; capabilities: { browserVersion: string } }>("/session", {
			capabilities: {
				alwaysMatch: {
					browserName: "firefox",
					"moz:firefoxOptions": {
						binary: Bun.env.FIREFOX_BINARY ?? "/snap/firefox/current/usr/lib/firefox/firefox",
						args: ["-headless"],
						prefs: {
							"extensions.webextensions.uuids": JSON.stringify({ "local-inference-lab@example.invalid": uuid }),
							"network.proxy.type": 1,
							"network.proxy.http": "127.0.0.1",
							"network.proxy.http_port": 9,
							"network.proxy.ssl": "127.0.0.1",
							"network.proxy.ssl_port": 9,
							"network.proxy.no_proxies_on": "",
						},
					},
				},
			},
		})
		sessionId = session.sessionId
		browserVersion = session.capabilities.browserVersion
		offlineMethod =
			"Fresh profile with HTTP/HTTPS forced through a closed local proxy, extension CSP, and local-only worker fetch guard"
		const run = <T = unknown>(path: string, body?: unknown) => command<T>(`/session/${sessionId}${path}`, body)
		await run("/timeouts", { script: 210_000, pageLoad: 30_000 })
		const originalHandles = new Set(await command<string[]>(`/session/${sessionId}/window/handles`, undefined, "GET"))
		await run("/moz/addon/install", { path: resolve(outputRoot, "firefox"), temporary: true })
		// Current Firefox blocks WebDriver navigation directly to extension URLs.
		// The lab opens its own probe page on explicit temporary installation.
		// Observe that tab. The isolated driver needs system access to execute
		// assertions in our own extension principal, not to change extension permissions.
		let probeHandle: string | undefined
		const deadline = performance.now() + 10_000
		while (!probeHandle && performance.now() < deadline) {
			const handles = await command<string[]>(`/session/${sessionId}/window/handles`, undefined, "GET")
			for (const handle of handles.filter((candidate) => !originalHandles.has(candidate))) {
				await run("/window", { handle })
				const url = await command<string>(`/session/${sessionId}/url`, undefined, "GET")
				if (url === `moz-extension://${uuid}/probe.html`) {
					probeHandle = handle
					break
				}
			}
			if (!probeHandle) await Bun.sleep(50)
		}
		assert(probeHandle, "The temporary lab extension did not open its probe page")
		await run("/window", { handle: probeHandle })
		await run("/execute/async", {
			script:
				'const done = arguments[arguments.length - 1]; if (document.readyState === "complete") done(true); else window.addEventListener("load", () => done(true), {once: true});',
			args: [],
		})
		result = await run<ProbeResult>("/execute/async", {
			script:
				"const callback = arguments[arguments.length - 1]; window.runLab(arguments[0]).then(callback, error => callback({ok: false, error: error.message}));",
			args: [probeOptions],
		})
		await command(`/session/${sessionId}`, undefined, "DELETE")
		sessionId = null
	} finally {
		clearTimeout(timeout)
		if (sessionId && endpoint)
			await fetch(`${endpoint}/session/${sessionId}`, { method: "DELETE", signal: AbortSignal.timeout(10_000) }).catch(
				() => {},
			)
		driver.kill()
		await driver.exited
		await Promise.all(readers)
		await Bun.write(resolve(results, "geckodriver.log"), log)
		await $`rm -rf ${profiles}`.quiet()
	}
}
const waves = result.waves ?? []
delete result.waves
await Bun.write(
	resolve(results, `${browser}-${provider}.json`),
	JSON.stringify(
		{
			recordedAt: new Date().toISOString(),
			browser,
			browserVersion,
			offlineMethod,
			toolchain: `Bun ${Bun.version}`,
			machine: {
				browserReportedCores: result.report?.hardwareConcurrency,
				note: "Development VM, not proof of 4-core/8-GB target or Windows/GPU performance",
			},
			build,
			...result,
		},
		null,
		2,
	) + "\n",
)
for (let index = 0; index < waves.length; index++) {
	await Bun.write(
		resolve(results, `${browser}-${provider}-${index + 1}.wav`),
		Uint8Array.from(atob(waves[index]!), (letter) => letter.charCodeAt(0)),
	)
}
assert(result.ok, result.error ?? "Synthesis failed")
assert(result.report, "Missing inference report")
assert(result.report.denied.length === 0, "Unexpected remote fetch attempted")
assert((result.remoteRequests?.length ?? 0) === 0, "Unexpected browser HTTP request attempted")
assert(result.report.samples.length === 3, "Missing synthesis fixtures")
assert(
	Math.abs(result.report.speedDurationRatio! - 1.5) < 0.1,
	"Model duration control did not change speed as expected",
)
console.log(
	JSON.stringify(
		{
			browser,
			browserVersion,
			selected: result.report.selected,
			firstClipReadyMs: result.report.firstClipReadyMs,
			speedDurationRatio: result.report.speedDurationRatio,
			samples: result.report.samples.map(({ lang, speed, durationSeconds, realTimeFactor }) => ({
				lang,
				speed,
				durationSeconds,
				realTimeFactor,
			})),
		},
		null,
		2,
	),
)
