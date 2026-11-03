/** Keep fixture I/O outside the browser driver's event loop during navigation. */
export interface FixtureRequest {
	receivedAt: number
	path: string
}

export async function startFixtureServer(path: string, onRequest: (request: FixtureRequest) => void = () => {}) {
	let resolveReady: (url: URL) => void
	let rejectReady: (error: Error) => void
	const ready = new Promise<URL>((resolve, reject) => {
		resolveReady = resolve
		rejectReady = reject
	})
	const child = Bun.spawn(["bun", import.meta.path, path], {
		stdout: "ignore",
		stderr: "inherit",
		ipc(message: unknown) {
			if (!message || typeof message !== "object") return
			if ("url" in message && typeof message.url === "string") resolveReady(new URL(message.url))
			if (
				"receivedAt" in message &&
				typeof message.receivedAt === "number" &&
				"path" in message &&
				typeof message.path === "string"
			)
				onRequest({ receivedAt: message.receivedAt, path: message.path })
		},
		onExit(_process, code) {
			rejectReady(new Error(`Fixture server exited before becoming ready (${code})`))
		},
	})
	const timer = setTimeout(() => {
		child.kill()
		rejectReady(new Error("Fixture server did not start"))
	}, 10_000)
	try {
		const url = await ready
		return {
			url,
			stop: () => {
				child.kill()
			},
		}
	} finally {
		clearTimeout(timer)
	}
}

if (import.meta.main) {
	const path = Bun.argv[2]
	if (!path) throw new Error("Pass the explicit local fixture path")
	const bytes = await Bun.file(path).arrayBuffer()
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			process.send?.({ receivedAt: Date.now(), path: new URL(request.url).pathname })
			return new Response(bytes, {
				headers: {
					"Content-Type": "application/pdf",
					"Access-Control-Allow-Origin": "*",
					"Cross-Origin-Resource-Policy": "cross-origin",
				},
			})
		},
	})
	process.send?.({ url: server.url.href })
}
