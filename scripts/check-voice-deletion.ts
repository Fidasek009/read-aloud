import type { browser } from "wxt/browser"

/** Abort a real IDB delete in the catalog; this is injected only into test copies. */
async function abortVoiceDeletion(id: string) {
	const page = window as Window & { browser?: typeof browser; chrome?: typeof browser }
	const api = page.browser ?? page.chrome
	if (!api) throw new Error("Extension API is unavailable")
	const card = document.querySelector<HTMLElement>(`[data-voice="${CSS.escape(id)}"]`)
	const button = card?.querySelector<HTMLButtonElement>(".danger")
	if (!card || !button) throw new Error("Installed voice is missing from the catalog")
	let notifications = 0
	const changed: Parameters<typeof api.storage.onChanged.addListener>[0] = (changes, area) => {
		const change: unknown = changes.voiceChange?.newValue
		if (
			area === "local" &&
			change &&
			typeof change === "object" &&
			"id" in change &&
			change.id === id &&
			"deleted" in change &&
			change.deleted === true
		)
			notifications++
	}
	api.storage.onChanged.addListener(changed)
	const nativeTransaction = IDBDatabase.prototype.transaction
	let aborted = false
	IDBDatabase.prototype.transaction = function (this: IDBDatabase, ...args: Parameters<typeof nativeTransaction>) {
		const transaction = nativeTransaction.apply(this, args)
		if (
			!aborted &&
			this.name === "read-aloud-voices" &&
			args[1] === "readwrite" &&
			transaction.objectStoreNames.contains("voices")
		) {
			aborted = true
			queueMicrotask(() => transaction.abort())
		}
		return transaction
	}
	try {
		button.click()
		const deadline = performance.now() + 5_000
		while (
			performance.now() < deadline &&
			(!aborted || button.disabled || !card.textContent?.includes("could not be deleted"))
		)
			await new Promise((resolve) => setTimeout(resolve, 25))
		if (!aborted || button.disabled || !card.textContent?.includes("could not be deleted"))
			throw new Error("Failed deletion did not recover its inline action")
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open("read-aloud-voices", 1)
			request.onsuccess = () => resolve(request.result)
			request.onerror = () => reject(request.error)
		})
		try {
			const retained = await new Promise<IDBValidKey | undefined>((resolve, reject) => {
				const request = db.transaction("voices").objectStore("voices").getKey(id)
				request.onsuccess = () => resolve(request.result)
				request.onerror = () => reject(request.error)
			})
			if (retained !== id || notifications !== 0)
				throw new Error("Aborted deletion removed the voice or published a committed change")
		} finally {
			db.close()
		}
		return { retained: true, committedNotifications: notifications }
	} finally {
		IDBDatabase.prototype.transaction = nativeTransaction
		api.storage.onChanged.removeListener(changed)
	}
}

export const checkAbortedVoiceDeletion = (id: string) => `(${abortVoiceDeletion.toString()})(${JSON.stringify(id)})`
