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
