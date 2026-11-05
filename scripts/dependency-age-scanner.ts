// Resolution's minimumReleaseAge does not recheck locked packages. This hook
// enforces the same boundary before installation, including frozen installs.
export const MINIMUM_RELEASE_AGE_MS = 24 * 60 * 60 * 1000

export function releaseIsOldEnough(published: unknown, now = Date.now()): boolean {
	if (typeof published !== "string") return false
	const timestamp = Date.parse(published)
	return Number.isFinite(timestamp) && now - timestamp >= MINIMUM_RELEASE_AGE_MS
}

export const scanner: Bun.Security.Scanner = {
	version: "1",
	async scan({ packages }) {
		const advisories: Bun.Security.Advisory[] = []
		const pending = [...packages]
		// Bound registry traffic, and discard metadata after each invocation.
		await Promise.all(
			Array.from({ length: Math.min(8, pending.length) }, async () => {
				for (let pkg = pending.pop(); pkg; pkg = pending.pop()) {
					try {
						// This project uses public npm packages only. Alternate sources
						// cannot establish publication age using npm's version timestamps.
						const tarball = new URL(pkg.tarball)
						if (
							!Bun.semver.satisfies(pkg.version, "*") ||
							tarball.origin !== "https://registry.npmjs.org" ||
							tarball.username ||
							tarball.password
						)
							throw new Error("Only timestamped public npm releases are supported")
						const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg.name)}`, {
							signal: AbortSignal.timeout(30_000),
						})
						if (!response.ok) throw new Error(`Registry metadata request failed (${response.status})`)
						const metadata = (await response.json()) as { time?: Record<string, unknown> }
						if (!releaseIsOldEnough(metadata.time?.[pkg.version]))
							throw new Error("Release is less than 24 hours old or has no valid publication timestamp")
					} catch (error) {
						advisories.push({
							level: "fatal",
							package: pkg.name,
							url: null,
							description: `${pkg.version}: ${error instanceof Error ? error.message : "Cannot verify release age"}`,
						})
					}
				}
			}),
		)
		return advisories
	},
}
