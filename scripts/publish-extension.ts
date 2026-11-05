import { buildVersion, parseVersion } from "./release-version"

// Keep only product safety gates here. WXT owns store options/authentication.
export function submissionArgs(browser: string, version: string, dryRun: boolean) {
	parseVersion(version, !dryRun)
	if (browser !== "chrome" && browser !== "firefox") throw new Error("Expected chrome or firefox")
	const args = [
		"submit",
		"--dry-run",
		String(dryRun),
		`--${browser}-zip`,
		`.output/read-aloud-${version}-${browser}.zip`,
		`--${browser}-skip-submit-review`,
		"false",
	]
	if (browser === "chrome")
		args.push(
			"--chrome-api-version",
			"v2",
			"--chrome-cancel-pending",
			"false",
			"--chrome-publish-type",
			"DEFAULT_PUBLISH",
		)
	else args.push("--firefox-channel", "listed", "--firefox-sources-zip", `.output/read-aloud-${version}-sources.zip`)
	return args
}

if (import.meta.main) {
	const [browser = "", mode] = process.argv.slice(2)
	if (mode !== "--dry-run" && mode !== "--publish") throw new Error("Explicit --dry-run or --publish is required")
	const dryRun = mode === "--dry-run"
	const version = buildVersion()
	const args = submissionArgs(browser, version, dryRun)
	if (!dryRun) {
		if (process.env.GITHUB_REF_TYPE !== "tag" || process.env.GITHUB_REF_NAME !== `v${version}`)
			throw new Error("Publishing requires the matching release tag")
	}
	const child = Bun.spawn([process.execPath, "--bun", "run", "wxt", ...args], { stdout: "inherit", stderr: "inherit" })
	process.exit(await child.exited)
}
