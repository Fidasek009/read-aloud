import { expect, test } from "bun:test"

import { cancelVoiceDownloads, voiceDownloadCancellation } from "../src/speech/download-cancellation.ts"

test("deletion cancels an existing download without cancelling a later download or another voice", async () => {
	const id = crypto.randomUUID()
	const first = voiceDownloadCancellation(id, new AbortController().signal)
	const otherVoice = voiceDownloadCancellation(crypto.randomUUID(), new AbortController().signal)
	const aborted = new Promise<void>((resolve) =>
		first.signal.addEventListener("abort", () => resolve(), { once: true }),
	)
	cancelVoiceDownloads(id)
	// Create this listener before asynchronous delivery of the earlier request.
	const replacement = voiceDownloadCancellation(id, new AbortController().signal)
	try {
		await aborted
		expect(first.signal.reason).toMatchObject({ name: "AbortError" })
		expect(replacement.signal.aborted).toBe(false)
		expect(otherVoice.signal.aborted).toBe(false)
	} finally {
		first.close()
		replacement.close()
		otherVoice.close()
	}
})

test("an explicit download cancellation remains effective after its channel is closed", () => {
	const controller = new AbortController()
	const download = voiceDownloadCancellation(crypto.randomUUID(), controller.signal)
	download.close()
	controller.abort()
	expect(download.signal.aborted).toBe(true)
})
