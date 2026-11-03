export const SPEECH_HOST_LOCK = "read-aloud-speech-host"
export const SPEECH_HOST_RETENTION_MS = 120_000
export const SPEECH_HOST_LEASE_MS = 10_000

/** Chrome offscreen lifetime, independent of service-worker suspension. */
export class SpeechHostLifetime {
	private clients = new Set<string>()
	private idleAt = 0
	private reservedUntil = 0
	private closing = false

	reserve(now: number): boolean {
		if (this.closing) return false
		this.reservedUntil = Math.max(this.reservedUntil, now + SPEECH_HOST_LEASE_MS)
		return true
	}

	connect(client: string): boolean {
		if (this.closing) return false
		this.clients.add(client)
		return true
	}

	disconnect(client: string, now: number) {
		if (this.clients.delete(client) && !this.clients.size) this.idleAt = now + SPEECH_HOST_RETENTION_MS
	}

	closeDelay(now: number): number | undefined {
		if (this.closing || this.clients.size) return
		return Math.max(0, Math.max(this.idleAt, this.reservedUntil) - now)
	}

	claimClose(now: number): boolean {
		if (this.closeDelay(now) !== 0) return false
		this.closing = true
		return true
	}

	/** Roll back a failed browser close while the background still holds its lock. */
	reopen() {
		this.closing = false
	}
}
