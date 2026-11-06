import { isDeepStrictEqual } from "node:util"

import { buildVersion, parseVersion } from "./release-version"

const browser = process.env.TARGET_BROWSER
if (browser !== "chrome" && browser !== "firefox") throw new Error("Invalid TARGET_BROWSER")
const version = buildVersion()
parseVersion(version)
const manifest = await Bun.file(`.output/${browser}-mv3/manifest.json`).json()
if (manifest.manifest_version !== 3 || manifest.version !== version) throw new Error("Manifest/version mismatch")
if (
	browser === "firefox" &&
	process.env.FIREFOX_EXTENSION_ID &&
	manifest.browser_specific_settings?.gecko?.id !== process.env.FIREFOX_EXTENSION_ID
)
	throw new Error("Firefox identity mismatch")
const zip = `.output/read-aloud-${version}-${browser}.zip`
await Bun.$`unzip -tq ${zip}`.quiet()
const entries = (await Bun.$`unzip -Z1 ${zip}`.text()).split("\n")
if (entries.some((file) => /\.(wav|mp3|ogg|opus|m4a|webm)$/i.test(file)))
	throw new Error("Voice preview audio must not be bundled in the extension")
const manifests = entries.filter((file) => /(^|\/)manifest\.json$/i.test(file))
if (manifests.length !== 1 || manifests[0] !== "manifest.json")
	throw new Error(`Package must have exactly one root manifest.json; found: ${manifests.join(", ")}`)
const packaged = JSON.parse(await Bun.$`unzip -p ${zip} manifest.json`.text())
if (!isDeepStrictEqual(packaged, manifest)) throw new Error("ZIP manifest differs from build")
if (!entries.includes("notices.html")) throw new Error("Package is missing notices.html")
const notices = await Bun.$`unzip -p ${zip} notices.html`.text()
for (const [, path] of notices.matchAll(/href="([^"#:]+)"/g)) {
	if (!path || path.startsWith("/") || path.split("/").includes("..")) throw new Error("Invalid local license link")
	if (!entries.includes(path)) throw new Error(`Package is missing linked license text: ${path}`)
	if (!(await Bun.$`unzip -p ${zip} ${path}`.text()).trim()) throw new Error(`Empty packaged license text: ${path}`)
}
if (browser === "firefox") {
	const sources = `.output/read-aloud-${version}-sources.zip`
	await Bun.$`unzip -tq ${sources}`.quiet()
	const files = (await Bun.$`unzip -Z1 ${sources}`.text()).split("\n")
	for (const required of [
		"package.json",
		"bun.lock",
		"bunfig.toml",
		"SOURCE_CODE_REVIEW.md",
		"scripts/prepare-runtime.ts",
		"voice-previews/texts.json",
	])
		if (!files.includes(required)) throw new Error(`Reviewer sources missing ${required}`)
	if (files.some((file) => /(^|\/)(\.env[^/]*|node_modules|\.cache|\.git|\.output)(\/|$)/.test(file)))
		throw new Error("Reviewer archive contains private or generated files")
	if (files.some((file) => /^voice-previews\/.*\.(wav|mp3|ogg|opus|m4a|webm)$/i.test(file)))
		throw new Error("Preview recordings belong outside the reviewer source archive")
}
console.log(`Validated ${browser} MV3 package ${version}`)
