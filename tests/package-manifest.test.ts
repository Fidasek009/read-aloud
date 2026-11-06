import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("package validation rejects nested manifests, missing notices and bundled preview audio in actual ZIPs", async () => {
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
		expect((await check()).stderr).toContain("Package is missing notices.html")
		const license = "runtime/licenses/read-aloud-MIT.txt"
		await Bun.write(
			join(directory, "notices.html"),
			`<a href="${license}">MIT</a><a href="https://example.invalid/source">Source</a>`,
		)
		await Bun.$`zip -q ${zip} notices.html`.cwd(directory).quiet()
		const missing = await check()
		expect(missing.code).not.toBe(0)
		expect(missing.stderr).toContain(`Package is missing linked license text: ${license}`)
		await Bun.write(join(directory, license), "")
		await Bun.$`zip -q ${zip} ${license}`.cwd(directory).quiet()
		const empty = await check()
		expect(empty.code).not.toBe(0)
		expect(empty.stderr).toContain(`Empty packaged license text: ${license}`)
		await Bun.write(join(directory, license), Bun.file("LICENSE"))
		await Bun.$`zip -q ${zip} ${license}`.cwd(directory).quiet()
		expect((await check()).code).toBe(0)
		await Bun.write(join(directory, "preview.wav"), "unexpected bundled audio")
		await Bun.$`zip -q ${zip} preview.wav`.cwd(directory).quiet()
		const bundled = await check()
		expect(bundled.code).not.toBe(0)
		expect(bundled.stderr).toContain("Voice preview audio must not be bundled")
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
})
