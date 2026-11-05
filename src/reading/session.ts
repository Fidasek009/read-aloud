/** The source surface owns its live reading scope and all stale-work checks. */
export class ReaderSession<T> {
	id = ""
	revision = 0
	source: T | undefined

	replace(source: T) {
		this.id ||= crypto.randomUUID()
		this.source = source
		this.revision++
		return { session: this.id }
	}

	/** A later request or close always wins, even if earlier preparation finishes later. */
	async start(capture: () => T | Promise<T>): Promise<boolean> {
		const request = this.invalidate()
		const source = await capture()
		if (!this.isCurrent(request)) return false
		this.replace(source)
		return true
	}

	invalidate() {
		return ++this.revision
	}

	isCurrent(revision: number) {
		return this.revision === revision
	}

	close() {
		this.id = ""
		this.source = undefined
		this.invalidate()
	}
}
