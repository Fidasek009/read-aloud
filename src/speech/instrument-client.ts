const preparationFailed = "Voice preparation failed"

/** Prepare the graph off the UI thread; transferring ownership avoids cloning the model. */
export function instrumentInWorker(
	model: ArrayBuffer,
	signal: AbortSignal,
	createWorker: () => Worker,
): Promise<ArrayBuffer> {
	signal.throwIfAborted()
	const worker = createWorker()
	return new Promise((resolve, reject) => {
		let done = false
		const finish = (error?: unknown, result?: ArrayBuffer) => {
			if (done) return
			done = true
			signal.removeEventListener("abort", abort)
			worker.terminate()
			if (error !== undefined) reject(error)
			else if (result) resolve(result)
			else reject(new Error(preparationFailed))
		}
		const abort = () => finish(signal.reason ?? new DOMException("Download cancelled", "AbortError"))
		signal.addEventListener("abort", abort, { once: true })
		worker.onmessage = ({ data }: MessageEvent<unknown>) => {
			if (!data || typeof data !== "object" || !("ok" in data))
				return finish(new Error("Invalid voice preparation response"))
			if (data.ok === true && "model" in data && data.model instanceof ArrayBuffer) return finish(undefined, data.model)
			const message = "error" in data && typeof data.error === "string" ? data.error : preparationFailed
			finish(new Error(message))
		}
		worker.onerror = () => finish(new Error(preparationFailed))
		worker.onmessageerror = () => finish(new Error(preparationFailed))
		if (signal.aborted) return abort()
		try {
			worker.postMessage(model, [model])
		} catch (error) {
			finish(error)
		}
	})
}
