import { resolve } from "node:path"

import { assertLicenseMaterials } from "./check-licenses"
import { publishFirefox } from "./firefox-publishing"
import { versionFromTag } from "./release-version"

interface ChromeRevision {
	state: string
	distributionChannels?: { crxVersion: string }[]
}

export async function verifyChromeSubmission(
	version: string,
	token: string,
	publisher: string,
	extension: string,
	request: typeof fetch = fetch,
) {
	if (!token || !publisher || !extension) throw new Error("Chrome publishing configuration is missing")
	const response = await request(
		`https://chromewebstore.googleapis.com/v2/publishers/${encodeURIComponent(publisher)}/items/${encodeURIComponent(extension)}:fetchStatus`,
		{
			headers: { Authorization: `Bearer ${token}` },
			redirect: "error",
			signal: AbortSignal.timeout(60_000),
		},
	)
	if (!response.ok) throw new Error(`Chrome status failed (HTTP ${response.status})`)
	const status = await response.json()
	const revisions: ChromeRevision[] = [status.publishedItemRevisionStatus, status.submittedItemRevisionStatus].filter(
		Boolean,
	)
	if (
		status.itemId !== extension ||
		status.takenDown ||
		!revisions.some(
			(revision) =>
				["PENDING_REVIEW", "PUBLISHED"].includes(revision.state) &&
				revision.distributionChannels?.some((channel) => channel.crxVersion === version),
		)
	)
		throw new Error(
			`Chrome ${version} is not submitted for automatic publication. Complete the existing draft in the Developer Dashboard; do not re-upload it.`,
		)
	console.log(`Chrome ${version} is already submitted or published; no upload or duplicate submission.`)
}

if (import.meta.main) {
	const version = versionFromTag(process.env.RELEASE_TAG ?? "")
	const store = process.env.STORE
	if (store !== "all" && store !== "firefox") throw new Error("Recovery supports firefox or all")
	const root = resolve("release-input")
	await assertLicenseMaterials(root)
	await publishFirefox({
		version,
		dryRun: false,
		metadataOnly: true,
		root,
		extensionId: process.env.FIREFOX_EXTENSION_ID ?? "",
		issuer: process.env.FIREFOX_JWT_ISSUER ?? "",
		secret: process.env.FIREFOX_JWT_SECRET ?? "",
	})
	if (store === "all")
		await verifyChromeSubmission(
			version,
			process.env.CHROME_SERVICE_ACCOUNT_ACCESS_TOKEN ?? "",
			process.env.CHROME_PUBLISHER_ID ?? "",
			process.env.CHROME_EXTENSION_ID ?? "",
		)
}
