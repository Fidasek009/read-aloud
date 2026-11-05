// Stable SemVer is also the manifest version: no lossy prerelease mapping.
export function parseVersion(version: string, release = false): number[] {
	if (/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version)?.[0] !== version)
		throw new Error(`Expected stable semantic version X.Y.Z, received ${version}`)
	const parts = version.split(".").map(Number)
	if (parts.some((part) => part > 65535)) throw new Error("Browser version components cannot exceed 65535")
	if (release && parts.every((part) => part === 0)) throw new Error("0.0.0 is a development placeholder, not a release")
	return parts
}

export function validateRelease(version: string, tag: string, previousTags: string[]) {
	const current = parseVersion(version, true)
	if (tag !== `v${version}`) throw new Error("Release tag must exactly match package.json version")
	for (const previousTag of previousTags) {
		if (previousTag === tag || !/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(previousTag)) continue
		const previous = parseVersion(previousTag.slice(1))
		const difference = current.findIndex((part, index) => part !== previous[index])
		if (difference < 0 || current[difference]! < previous[difference]!)
			throw new Error(`Release ${tag} must be newer than ${previousTag}`)
	}
}

if (import.meta.main) {
	const { version } = await Bun.file("package.json").json()
	parseVersion(version)
	if (process.argv[2] === "--release") {
		const tag = process.env.GITHUB_REF_NAME ?? ""
		const tags = await Bun.$`git tag --list`.text()
		validateRelease(version, tag, tags.trim().split("\n"))
		// Only release commits already on the protected default branch.
		const branch = process.env.DEFAULT_BRANCH
		if (!branch) throw new Error("DEFAULT_BRANCH is required")
		await Bun.$`git merge-base --is-ancestor HEAD ${`origin/${branch}`}`.quiet()
	}
	console.log(`Validated version ${version}`)
}
