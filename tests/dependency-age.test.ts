import { expect, spyOn, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { MINIMUM_RELEASE_AGE_MS, releaseIsOldEnough, scanner } from "../scripts/dependency-age-scanner.ts"

test("Bun invokes the local scanner on frozen installs and stops before installing a young locked package", async () => {
	const directory = await mkdtemp(join(tmpdir(), "read-aloud-cooldown-"))
	async function install(...args: string[]) {
		const child = Bun.spawn([process.execPath, "install", ...args], {
			cwd: directory,
			stdout: "pipe",
			stderr: "pipe",
		})
		const [code, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		])
		return { code, output: stdout + stderr }
	}
	try {
		await Bun.write(join(directory, "package.json"), JSON.stringify({ dependencies: { "is-number": "7.0.0" } }))
		expect((await install("--lockfile-only")).code).toBe(0)
		const lock = await Bun.file(join(directory, "bun.lock")).text()
		const scannerPath = new URL("../scripts/dependency-age-scanner.ts", import.meta.url).pathname
		// Simulate registry timestamps, while exercising Bun's actual hook and
		// frozen lockfile handling rather than calling scan() directly.
		await Bun.write(
			join(directory, "scanner.ts"),
			`import { scanner } from ${JSON.stringify(scannerPath)};
globalThis.fetch = async () => Response.json({ time: { "7.0.0": await Bun.file(${JSON.stringify(join(directory, "published"))}).text() } });
export { scanner };
`,
		)
		await Bun.write(join(directory, "bunfig.toml"), '[install.security]\nscanner = "./scanner.ts"\n')
		await Bun.write(join(directory, "published"), new Date().toISOString())
		const young = await install("--frozen-lockfile")
		expect(young.code).not.toBe(0)
		expect(young.output).toContain("less than 24 hours old")
		expect(await Bun.file(join(directory, "node_modules/is-number/package.json")).exists()).toBe(false)
		await Bun.write(join(directory, "published"), new Date(Date.now() - 172_800_000).toISOString())
		expect((await install("--frozen-lockfile")).code).toBe(0)
		expect(await Bun.file(join(directory, "node_modules/is-number/package.json")).exists()).toBe(true)
		expect(await Bun.file(join(directory, "bun.lock")).text()).toBe(lock)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}, 30_000)

test("publication age includes the 24-hour boundary and rejects unknown or future timestamps", () => {
	const now = Date.parse("2026-11-05T12:00:00Z")
	expect(releaseIsOldEnough(new Date(now - MINIMUM_RELEASE_AGE_MS).toISOString(), now)).toBe(true)
	expect(releaseIsOldEnough(new Date(now - MINIMUM_RELEASE_AGE_MS + 1).toISOString(), now)).toBe(false)
	for (const value of [undefined, null, 0, "invalid", new Date(now + 1).toISOString()])
		expect(releaseIsOldEnough(value, now)).toBe(false)
})

test("install scanner blocks young locked versions, unverifiable sources, and registry failures", async () => {
	const pkg = (name: string): Bun.Security.Package => ({
		name,
		version: "1.0.0",
		requestedRange: "1.0.0",
		tarball: `https://registry.npmjs.org/${name}/-/${name}-1.0.0.tgz`,
	})
	const fetchMetadata = async (input: URL | RequestInfo) => {
		const name = new URL(String(input)).pathname.slice(1)
		if (name === "unavailable") throw new Error("Registry unavailable")
		if (name === "http-error") return new Response(null, { status: 503 })
		return Response.json({
			time: {
				"1.0.0":
					name === "missing" ? undefined : new Date(Date.now() - (name === "old" ? 172_800_000 : 0)).toISOString(),
			},
		})
	}
	const metadata = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(fetchMetadata, { preconnect: fetch.preconnect }),
	)
	try {
		const result = await scanner.scan({
			packages: [
				...["old", "young", "missing", "unavailable", "http-error"].map(pkg),
				{ ...pkg("non-registry"), tarball: "https://example.com/pkg.tgz" },
				{ ...pkg("git"), version: "github:owner/repo#commit" },
			],
		})
		expect(result.map((entry) => entry.package).sort()).toEqual([
			"git",
			"http-error",
			"missing",
			"non-registry",
			"unavailable",
			"young",
		])
		expect(result.every((entry) => entry.level === "fatal")).toBe(true)
	} finally {
		metadata.mockRestore()
	}
})
