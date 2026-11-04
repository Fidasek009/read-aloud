import { afterAll, expect, test } from "bun:test"

import { downloadBytes, DownloadError } from "../src/speech/download.ts"

let requests = 0
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch(request) {
		requests++
		switch (new URL(request.url).pathname) {
			case "/slow": {
				let sent = 0
				return new Response(
					new ReadableStream({
						async pull(controller) {
							await Bun.sleep(70)
							controller.enqueue(Uint8Array.of(++sent))
							if (sent === 6) controller.close()
						},
					}),
				)
			}
			case "/headers":
				return new Promise<Response>(() => {})
			case "/stall":
				return new Response(
					new ReadableStream({
						start(controller) {
							controller.enqueue(Uint8Array.of(1))
						},
					}),
				)
			case "/short":
				return new Response(Uint8Array.of(1, 2))
			case "/large":
				return new Response(new Uint8Array(20))
			case "/unavailable":
				return new Response(null, { status: 503 })
			default:
				return new Response(Uint8Array.of(1, 2, 3, 4))
		}
	},
})
afterAll(() => server.stop(true))
const url = (path: string) => new URL(path, server.url).href
const options = () => ({ signal: new AbortController().signal, bytes: 4, maxBytes: 4, idleTimeoutMs: 250 })

test("a progressing slow transfer outlives the idle interval and completes intact", async () => {
	const progress: number[] = []
	const bytes = await downloadBytes(url("/slow"), {
		...options(),
		bytes: 6,
		maxBytes: 6,
		onProgress: (received) => progress.push(received),
	})
	expect([...bytes]).toEqual([1, 2, 3, 4, 5, 6])
	expect(progress.at(-1)).toBe(6)
	expect(progress.every((value, index) => index === 0 || value > progress[index - 1]!)).toBe(true)
})

test("stalled response headers and a stalled body fail with an actionable timeout", async () => {
	for (const path of ["/headers", "/stall"]) {
		const error = await downloadBytes(url(path), { ...options(), idleTimeoutMs: 60 }).then(
			() => null,
			(error) => error,
		)
		expect(error).toBeInstanceOf(DownloadError)
		expect(error.kind).toBe("stalled")
		expect(error.message).toContain("connection")
	}
})

test("user cancellation during a stalled body preserves the explicit abort reason", async () => {
	const controller = new AbortController()
	const reason = new DOMException("Cancelled by user", "AbortError")
	const result = downloadBytes(url("/stall"), {
		...options(),
		signal: controller.signal,
		onProgress: () => controller.abort(reason),
	})
	await expect(result).rejects.toBe(reason)
})

test("incomplete, oversized, and unavailable files never pass as successful downloads", async () => {
	for (const [path, kind] of [
		["/short", "interrupted"],
		["/large", "size"],
		["/unavailable", "server"],
	] as const) {
		const error = await downloadBytes(url(path), options()).then(
			() => null,
			(error) => error,
		)
		expect(error).toBeInstanceOf(DownloadError)
		expect(error.kind).toBe(kind)
	}
	const bounded = await downloadBytes(url("/large"), { signal: new AbortController().signal, maxBytes: 8 }).then(
		() => null,
		(error) => error,
	)
	expect(bounded.kind).toBe("size")
})

test("an already-cancelled download makes no network request", async () => {
	const controller = new AbortController()
	controller.abort()
	const before = requests
	await expect(downloadBytes(url("/ok"), { ...options(), signal: controller.signal })).rejects.toBe(
		controller.signal.reason,
	)
	expect(requests).toBe(before)
})
