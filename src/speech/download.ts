const messages = {
	stalled: "Download stalled. Check your connection and try again.",
	network: "Download failed. Check your connection and try again.",
	server: "The voice server could not provide the file. Please try again.",
	interrupted: "Download was interrupted. Check your connection and try again.",
	size: "The voice file has an unexpected size. Please try again.",
} as const

export class DownloadError extends Error {
	constructor(
		readonly kind: keyof typeof messages,
		cause?: unknown,
	) {
		super(messages[kind], { cause })
		this.name = "DownloadError"
	}
}

interface DownloadOptions {
	signal: AbortSignal
	/** Pinned decoded file size, when known. Never trust Content-Length as the limit. */
	bytes?: number
	maxBytes: number
	onProgress?: (received: number) => void
	/** Inactivity only; a progressing transfer has no total time limit. */
	idleTimeoutMs?: number
}

export async function downloadBytes(url: string, options: DownloadOptions): Promise<Uint8Array<ArrayBuffer>> {
	const { signal, bytes: expected, maxBytes, onProgress, idleTimeoutMs = 120_000 } = options
	signal.throwIfAborted()
	if (
		!Number.isSafeInteger(maxBytes) ||
		maxBytes < 1 ||
		(expected !== undefined && (!Number.isSafeInteger(expected) || expected < 1 || expected > maxBytes)) ||
		!Number.isFinite(idleTimeoutMs) ||
		idleTimeoutMs <= 0
	)
		throw new Error("Invalid download limits")
	const output = expected === undefined ? undefined : new Uint8Array(expected)
	const chunks: Uint8Array[] = []
	const idle = new AbortController()
	const abort = AbortSignal.any([signal, idle.signal])
	let timer: ReturnType<typeof setTimeout> | undefined
	let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
	let complete = false
	const touch = () => {
		clearTimeout(timer)
		timer = setTimeout(() => idle.abort(new DownloadError("stalled")), idleTimeoutMs)
	}
	try {
		touch()
		const response = await fetch(url, { signal: abort, credentials: "omit", referrerPolicy: "no-referrer" })
		if (!response.ok || !response.body) throw new DownloadError("server")
		touch()
		reader = response.body.getReader()
		let received = 0
		for (;;) {
			const { done, value } = await reader.read()
			if (done) break
			if (!value.byteLength) continue
			touch()
			if (received + value.byteLength > (expected ?? maxBytes)) throw new DownloadError("size")
			if (output) output.set(value, received)
			else chunks.push(value)
			received += value.byteLength
			onProgress?.(received)
		}
		if (expected !== undefined && received !== expected) throw new DownloadError("interrupted")
		complete = true
		if (output) return output
		const joined = new Uint8Array(received)
		let offset = 0
		for (const chunk of chunks) {
			joined.set(chunk, offset)
			offset += chunk.byteLength
		}
		return joined
	} catch (error) {
		signal.throwIfAborted()
		if (idle.signal.aborted) throw idle.signal.reason
		if (error instanceof DownloadError) throw error
		throw new DownloadError("network", error)
	} finally {
		clearTimeout(timer)
		if (!complete) idle.abort()
		if (reader) {
			if (!complete) void reader.cancel().catch(() => {})
			reader.releaseLock()
		}
	}
}
