import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { assertReleaseLicensing, inspectReleaseLicensing } from "../scripts/release-licensing"

async function withReviewFixture(check: (directory: string, record: any) => Promise<void>) {
	const directory = await mkdtemp(join(tmpdir(), "release-licensing-test-"))
	try {
		const record = await Bun.file("release/licensing.json").json()
		for (const path of Object.keys(record.inputs)) await Bun.write(join(directory, path), Bun.file(path))
		// Synthetic approval is only for testing a resolvable gate, not real clearance.
		for (const finding of record.findings) {
			finding.status = "satisfied"
			finding.remaining = []
		}
		await Bun.write(join(directory, "release/licensing.json"), JSON.stringify(record))
		await check(directory, record)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}

test("current licensing review fingerprints match repository inputs", async () => {
	expect((await inspectReleaseLicensing()).stale).toEqual([])
})

test("a fully evidenced and satisfied fixture can pass the release gate", async () => {
	await withReviewFixture(async (directory) => {
		expect(await inspectReleaseLicensing(directory)).toEqual({ stale: [], blockers: [] })
		await expect(assertReleaseLicensing(directory)).resolves.toBeUndefined()
	})
})

test("a status-only flip, missing source archive and stale dependency inputs cannot approve release", async () => {
	await withReviewFixture(async (directory, record) => {
		record.findings[0].remaining = ["Synthetic fixture: a required source material has not been supplied"]
		record.findings[0].status = "satisfied"
		await Bun.write(join(directory, "release/licensing.json"), JSON.stringify(record))
		expect((await inspectReleaseLicensing(directory)).blockers.length).toBeGreaterThan(0)
		const provenance = await Bun.file("vendor/source/provenance.json").json()
		await Bun.file(join(directory, `vendor/source/${provenance.espeakNg.archive}`)).delete()
		await Bun.write(join(directory, "bun.lock"), "changed dependency lock")
		const audit = await inspectReleaseLicensing(directory)
		expect(audit.stale.some((message) => message.includes(provenance.espeakNg.archive))).toBe(true)
		expect(audit.stale.some((message) => message.includes("bun.lock"))).toBe(true)
		await expect(assertReleaseLicensing(directory)).rejects.toThrow()
	})
})

test("standalone live publishers reject an unresolved fixture before invoking publishing tools", async () => {
	await withReviewFixture(async (directory, record) => {
		record.findings[0].status = "unresolved"
		record.findings[0].remaining = ["Synthetic fixture: permission scope unresolved"]
		await Bun.write(join(directory, "release/licensing.json"), JSON.stringify(record))
		for (const [name, args] of [
			["publish-extension", ["chrome", "--publish"]],
			["publish-extension", ["firefox", "--publish"]],
			["github-release", []],
		] as const) {
			const script = Bun.fileURLToPath(new URL(`../scripts/${name}.ts`, import.meta.url))
			const child = Bun.spawn([process.execPath, script, ...args], {
				cwd: directory,
				env: {
					...process.env,
					GITHUB_REF_TYPE: "tag",
					GITHUB_REF_NAME: "v0.1.0",
					RELEASE_TAG: "v0.1.0",
					RELEASE_VERSION: undefined,
				},
				stdout: "pipe",
				stderr: "pipe",
			})
			const stderr = await new Response(child.stderr).text()
			expect(await child.exited).not.toBe(0)
			expect(stderr).toContain("Public release blocked by licensing review")
		}
	})
})

test("supplier recipe fingerprints cannot be omitted from an otherwise satisfied review", async () => {
	await withReviewFixture(async (directory, record) => {
		const sources = await Bun.file("vendor/source/remote-sources.json").json()
		const recipe = sources.preservedRecipes[0]
		delete record.inputs[recipe.path]
		await Bun.write(join(directory, "release/licensing.json"), JSON.stringify(record))
		expect((await inspectReleaseLicensing(directory)).stale).toContain(
			`Missing or inconsistent reviewed supplier recipe: ${recipe.path}`,
		)
		await expect(assertReleaseLicensing(directory)).rejects.toThrow()
	})
})
