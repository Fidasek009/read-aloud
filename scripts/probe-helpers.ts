import { $ } from "bun"

export const projectRoot = Bun.fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/u, "")

// Bun.WebView's disposable fixture profiles have no real credentials. Avoid
// waiting for the desktop password store in headless Linux automation.
export const chromeTestProfileArguments = ["--password-store=basic"] as const

export function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message)
}

export async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, seconds = 60): Promise<T> {
	const deadline = performance.now() + seconds * 1000
	let value: T
	do {
		value = await read()
		if (accept(value)) return value
		await Bun.sleep(100)
	} while (performance.now() < deadline)
	throw new Error(`Condition timed out: ${String(JSON.stringify(value)).slice(0, 600)}`)
}

export async function chromeExecutable(): Promise<string | undefined> {
	if (Bun.env.BUN_CHROME_PATH) return Bun.env.BUN_CHROME_PATH
	const candidates = await Array.fromAsync(
		new Bun.Glob("chromium-*/chrome-linux*/chrome").scan({
			cwd: `${Bun.env.HOME}/.cache/ms-playwright`,
			absolute: true,
		}),
	)
	return candidates.sort().at(-1)
}

export function chromeExtensionId(path: string): string {
	return [...new Bun.CryptoHasher("sha256").update(path).digest("hex").slice(0, 32)]
		.map((digit) => String.fromCharCode(97 + parseInt(digit, 16)))
		.join("")
}

export async function copyProbeExtension(browser: "chrome" | "firefox", destination: string) {
	await $`rm -rf ${destination}`.quiet()
	await $`mkdir -p ${destination}`.quiet()
	await $`cp -R ${projectRoot + "/.output/" + browser + "-mv3/."} ${destination}`.quiet()
	const bundled = await Bun.build({
		entrypoints: [projectRoot + "/scripts/voice-fixtures.ts"],
		outdir: destination,
		naming: "voice-fixtures.js",
		target: "browser",
		format: "esm",
	})
	if (!bundled.success) throw new AggregateError(bundled.logs, "Voice fixture helpers failed to bundle")
}

const chromeProfiles = new WeakMap<Bun.WebView, string>()

/** Identical isolated Chromium launch policy for product and fixture probes. */
export async function createChromeProbe(extension: string, extraArguments: string[] = []) {
	const executable = await chromeExecutable()
	const directory = `${projectRoot}/.cache/browser-profiles/${crypto.randomUUID()}`
	await $`mkdir -p ${directory}`.quiet()
	const view = new Bun.WebView({
		backend: {
			type: "chrome",
			url: false,
			...(executable ? { path: executable } : {}),
			argv: [
				...chromeTestProfileArguments,
				`--disable-extensions-except=${extension}`,
				`--load-extension=${extension}`,
				...extraArguments,
			],
		},
		dataStore: { directory },
	})
	chromeProfiles.set(view, directory)
	return view
}

/** Close the browser before deleting only the fixture directory we created. */
export async function closeChromeProbe(view: Bun.WebView) {
	view.close()
	Bun.WebView.closeAll()
	const directory = chromeProfiles.get(view)
	if (directory) {
		chromeProfiles.delete(view)
		// Chromium shutdown can briefly keep writing profile files after close.
		// Retry deletion of this disposable profile instead of failing a valid probe.
		for (let attempt = 0; ; attempt++) {
			const result = await $`rm -rf ${directory}`.quiet().nothrow()
			if (result.exitCode === 0) break
			if (attempt === 4) throw new Error(`Cannot remove probe profile ${directory}: ${result.stderr.toString()}`)
			await Bun.sleep(100)
		}
	}
}
