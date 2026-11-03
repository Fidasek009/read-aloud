import { browser } from "wxt/browser"

import { isPdfCommandResult, type PdfAction, type PdfCommand, pdfCommandKey } from "./pdf-control.ts"

/** One acknowledged request at a time per reader; different readers never share a slot. */
export function commandPdf(tabId: number, action: PdfAction): Promise<void> {
	return navigator.locks.request(`read-aloud-pdf-command:${tabId}`, async () => {
		// Do not wait for an acknowledgement from a tab that has already closed.
		await browser.tabs.get(tabId)
		const command: PdfCommand = { ...action, tabId, revision: crypto.randomUUID() }
		const key = pdfCommandKey(tabId, command.revision)
		let listener: Parameters<typeof browser.storage.onChanged.addListener>[0]
		let timer: ReturnType<typeof setTimeout>
		let removed: Parameters<typeof browser.tabs.onRemoved.addListener>[0]
		const acknowledged = new Promise<void>((resolve, reject) => {
			listener = (changes, area) => {
				if (area !== "session" || !(key in changes)) return
				const value: unknown = changes[key]?.newValue
				if (value === undefined) {
					reject(new Error("The PDF reader closed before receiving the command. Open it again to retry."))
					return
				}
				if (!value || typeof value !== "object" || !("result" in value) || !isPdfCommandResult(value.result)) return
				if (value.result.ok) resolve()
				else reject(new Error(value.result.error))
			}
			browser.storage.onChanged.addListener(listener)
			removed = (closedTab) => {
				if (closedTab === tabId)
					reject(new Error("The PDF reader closed before receiving the command. Open it again to retry."))
			}
			browser.tabs.onRemoved.addListener(removed)
			timer = setTimeout(() => reject(new Error("The PDF reader did not respond. Open it again to retry.")), 5_000)
		})
		// Attach the rejection handler before the write: storage itself can fail too.
		try {
			await Promise.all([browser.storage.session.set({ [key]: command }), acknowledged])
		} finally {
			clearTimeout(timer!)
			browser.storage.onChanged.removeListener(listener!)
			browser.tabs.onRemoved.removeListener(removed!)
			await browser.storage.session.remove(key)
		}
	})
}
