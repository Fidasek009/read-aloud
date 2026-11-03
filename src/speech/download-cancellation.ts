const channelName = "read-aloud-voices"

export function cancelVoiceDownloads(id: string): void {
	const channel = new BroadcastChannel(channelName)
	try {
		channel.postMessage({ id, cancelDownload: true })
	} finally {
		channel.close()
	}
}

/** A new download must not receive a cancellation queued before it existed. */
export function voiceDownloadCancellation(id: string, signal: AbortSignal): { signal: AbortSignal; close(): void } {
	const channel = new BroadcastChannel(channelName)
	const controller = new AbortController()
	channel.onmessage = (event: MessageEvent<unknown>) => {
		const value = event.data
		if (
			value &&
			typeof value === "object" &&
			"id" in value &&
			value.id === id &&
			"cancelDownload" in value &&
			value.cancelDownload === true
		)
			controller.abort(new DOMException("Download cancelled because this voice was deleted.", "AbortError"))
	}
	return { signal: AbortSignal.any([signal, controller.signal]), close: () => channel.close() }
}
