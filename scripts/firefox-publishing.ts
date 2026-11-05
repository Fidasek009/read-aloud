import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { JwtApiAuth, signAddon } from "web-ext/util/submit-addon"

import { firefoxMetadata } from "./firefox-metadata"
import { parseVersion } from "./release-version"

interface FirefoxOptions {
	version: string
	dryRun: boolean
	extensionId: string
	issuer: string
	secret: string
	root?: string
}
interface Addon {
	guid: string
	channels?: string[]
	previews: { id: number; position: number }[]
}

// Production always uses AMO. Tests pass a local mock origin to exercise
// Mozilla's actual submission client under Bun without touching a store.
export async function publishFirefox(options: FirefoxOptions, apiBase = "https://addons.mozilla.org/api/v5/") {
	const { version, dryRun, extensionId, issuer, secret, root = process.cwd() } = options
	parseVersion(version, !dryRun)
	if (!extensionId || !issuer || !secret) throw new Error("Firefox ID and AMO API issuer/secret are required")
	const zip = join(root, `.output/read-aloud-${version}-firefox.zip`)
	const sources = join(root, `.output/read-aloud-${version}-sources.zip`)
	if (!(await Bun.file(sources).exists())) throw new Error("Firefox reviewer sources are missing")
	const manifest = JSON.parse(await Bun.$`unzip -p ${zip} manifest.json`.quiet().text())
	if (
		manifest.manifest_version !== 3 ||
		manifest.version !== version ||
		manifest.browser_specific_settings?.gecko?.id !== extensionId
	)
		throw new Error("Firefox package version or permanent ID does not match publishing configuration")
	const metadata = await firefoxMetadata(version, root)
	const privacy = await Bun.file(join(root, "PRIVACY.md")).text()
	const screenshots = ["voices-english.png", "voices-czech.png"]
	for (const file of ["icon-128.png", ...screenshots])
		if (!(await Bun.file(join(root, "store/assets", file)).exists())) throw new Error(`Missing store asset: ${file}`)
	const auth = new JwtApiAuth({ apiKey: issuer, apiSecret: secret })
	async function request(path: string, method = "GET", body?: FormData | Record<string, unknown>) {
		const response = await fetch(new URL(path, apiBase), {
			method,
			headers: {
				Authorization: await auth.getAuthHeader(),
				Accept: "application/json",
				...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
			},
			body: body instanceof FormData ? body : body ? JSON.stringify(body) : null,
			redirect: "error",
			signal: AbortSignal.timeout(60_000),
		})
		if (!response.ok && !(method === "GET" && response.status === 404))
			throw new Error(`AMO ${method} ${path} failed (HTTP ${response.status}); check account access and configuration`)
		return response
	}
	// Authenticate before interpreting an add-on 404. A public add-on lookup alone
	// can succeed even when credentials are unusable.
	const profileResponse = await request("accounts/profile/")
	if (!profileResponse.ok) throw new Error("AMO account profile was not found")
	const profile = await profileResponse.json()
	// AMO serializes its nullable DateTimeField as an ISO timestamp. Its account
	// documentation still describes this as a boolean; check the actual contract.
	const acceptedAt = profile.read_dev_agreement
	if (!Number.isInteger(profile.id) || typeof acceptedAt !== "string" || !Number.isFinite(Date.parse(acceptedAt)))
		throw new Error("Complete AMO account setup and accept Mozilla's developer agreement first")
	const addonPath = `addons/addon/${encodeURIComponent(extensionId)}/`
	const detail = await request(addonPath)
	const existing: Addon | undefined = detail.ok ? await detail.json() : undefined
	if (existing && (existing.guid !== extensionId || !Array.isArray(existing.channels)))
		throw new Error("AMO ID mismatch or account lacks access to this add-on's publishing details")
	if (dryRun) {
		console.log(
			existing
				? "Firefox credentials and existing listing access verified. No uploads or submissions."
				: "Firefox credentials verified. No listing exists; the first release will create it. No uploads or submissions.",
		)
		return
	}

	const temp = await mkdtemp(join(tmpdir(), "read-aloud-amo-"))
	try {
		// Use Mozilla's exported client rather than rebuilding/repacking the CI ZIP.
		// PUT by permanent GUID creates the first listing or submits an update.
		const result = await signAddon({
			apiKey: issuer,
			apiSecret: secret,
			amoBaseUrl: apiBase,
			id: extensionId,
			xpiPath: zip,
			downloadDir: temp,
			channel: "listed",
			savedUploadUuidPath: join(temp, "upload.json"),
			metaDataJson: metadata,
			submissionSource: sources,
			validationCheckTimeout: 300_000,
			// Store review can take days. The job waits for submission and sources;
			// AMO controls approval and automatic publication.
			approvalCheckTimeout: 0,
			userAgentString: "read-aloud-release/web-ext",
		})
		if (result.id !== extensionId) throw new Error("AMO returned a different permanent extension ID")
		const { version: _, ...listing } = metadata
		// PUT uses listing metadata on creation but not on updates.
		await request(addonPath, "PATCH", listing)
		await request(`${addonPath}eula_policy/`, "PATCH", { privacy_policy: { "en-US": privacy } })
		const icon = new FormData()
		icon.set("icon", Bun.file(join(root, "store/assets/icon-128.png")), "icon-128.png")
		await request(addonPath, "PATCH", icon)
		const current: Addon = await (await request(addonPath)).json()
		for (const [index, file] of screenshots.entries()) {
			const position = index + 1
			let preview = current.previews.find((item) => item.position === position)
			if (!preview) {
				const image = new FormData()
				image.set("image", Bun.file(join(root, "store/assets", file)), file)
				image.set("position", String(position))
				preview = await (await request(`${addonPath}previews/`, "POST", image)).json()
			}
			if (!preview || !Number.isInteger(preview.id)) throw new Error("AMO returned an invalid screenshot ID")
			await request(`${addonPath}previews/${preview.id}/`, "PATCH", {
				caption: { "en-US": `Choose ${index === 0 ? "an English" : "a Czech"} voice before downloading it.` },
				position,
			})
		}
		console.log(`Firefox ${version} and reviewer sources submitted to AMO; listing, privacy and artwork configured.`)
	} finally {
		await rm(temp, { recursive: true, force: true })
	}
}
