import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("package validation rejects a nested data manifest in an actual ZIP", async () => {
	const directory = await mkdtemp(join(tmpdir(), "read-aloud-package-test-"))
	const manifest = JSON.stringify({ manifest_version: 3, version: "0.0.0" })
	const checker = Bun.fileURLToPath(new URL("../scripts/check-package.ts", import.meta.url))
	try {
		await Bun.write(join(directory, ".output/chrome-mv3/manifest.json"), manifest)
		await Bun.write(join(directory, "manifest.json"), manifest)
		const nested = "runtime/espeak-ng-data/manifest.json"
		await Bun.write(join(directory, nested), "{}")
		const zip = ".output/read-aloud-0.0.0-chrome.zip"
		await Bun.$`zip -q ${zip} manifest.json ${nested}`.cwd(directory).quiet()
		const check = async () => {
			const child = Bun.spawn([process.execPath, checker], {
				cwd: directory,
				env: {
					...process.env,
					GITHUB_REF_TYPE: undefined,
					GITHUB_REF_NAME: undefined,
					RELEASE_VERSION: "0.0.0",
					TARGET_BROWSER: "chrome",
				},
				stdout: "pipe",
				stderr: "pipe",
			})
			const stderr = await new Response(child.stderr).text()
			return { code: await child.exited, stderr }
		}
		const rejected = await check()
		expect(rejected.code).not.toBe(0)
		expect(rejected.stderr).toContain("Package must have exactly one root manifest.json")
		await Bun.file(join(directory, zip)).delete()
		const inventory = "runtime/espeak-ng-data/data-index.json"
		await Bun.write(join(directory, inventory), "{}")
		await Bun.$`zip -q ${zip} manifest.json ${inventory}`.cwd(directory).quiet()
		expect((await check()).code).toBe(0)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
