import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { buildVersion } from "./release-version"

// Different checkout AND install/cache paths expose machine-dependent bundle output.
const version = buildVersion()
const original = resolve(`.output/read-aloud-${version}-firefox.zip`)
const sources = resolve(`.output/read-aloud-${version}-sources.zip`)
const manifest = JSON.parse(await Bun.$`unzip -p ${original} manifest.json`.text())
const temp = await mkdtemp(join(tmpdir(), "read-aloud-review-"))
const source = join(temp, "source")
const extracted = join(temp, "original")
try {
	await Bun.$`unzip -q ${sources} -d ${source}`.quiet()
	await Bun.$`unzip -q ${original} -d ${extracted}`.quiet()
	const env = {
		...process.env,
		// Reviewers do not have the originating Actions/tag environment.
		GITHUB_REF_TYPE: undefined,
		GITHUB_REF_NAME: undefined,
		RELEASE_VERSION: manifest.version,
		BUN_INSTALL_CACHE_DIR: join(temp, "bun-cache"),
		FIREFOX_EXTENSION_ID: manifest.browser_specific_settings.gecko.id,
	}
	for (const args of [
		["install", "--frozen-lockfile"],
		["run", "zip:firefox"],
	]) {
		const child = Bun.spawn([process.execPath, ...args], { cwd: source, env, stdout: "inherit", stderr: "inherit" })
		if ((await child.exited) !== 0) throw new Error(`Reviewer rebuild failed: bun ${args.join(" ")}`)
	}
	const rebuilt = join(source, ".output/firefox-mv3")
	async function files(directory: string) {
		return Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: directory, onlyFiles: true, dot: true })).then((paths) =>
			paths.sort(),
		)
	}
	const expected = await files(extracted)
	const actual = await files(rebuilt)
	if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error("Reviewer rebuild file list differs")
	const differences: string[] = []
	for (const file of expected) {
		const left = new Bun.CryptoHasher("sha256")
			.update(await Bun.file(join(extracted, file)).arrayBuffer())
			.digest("hex")
		const right = new Bun.CryptoHasher("sha256").update(await Bun.file(join(rebuilt, file)).arrayBuffer()).digest("hex")
		if (left !== right) differences.push(file)
	}
	if (differences.length) throw new Error(`Reviewer rebuild bytes differ: ${differences.join(", ")}`)
	console.log(`Reviewer rebuild matches all ${expected.length} packaged files byte-for-byte (ZIP metadata excluded).`)
} finally {
	await rm(temp, { recursive: true, force: true })
}
