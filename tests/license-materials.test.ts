import { expect, test } from "bun:test"
import { cp, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { assertLicenseMaterials, inspectLicenseMaterials } from "../scripts/check-licenses"

async function withMaterials(check: (directory: string) => Promise<void>) {
	const directory = await mkdtemp(join(tmpdir(), "license-materials-test-"))
	try {
		for (const path of ["LICENSE", "NOTICE.md", "public/notices.html", "package.json", "vendor"])
			await cp(path, join(directory, path), { recursive: true })
		await check(directory)
	} finally {
		await rm(directory, { recursive: true, force: true })
	}
}

test("license notices and pinned source materials are supplied", async () => {
	expect(await inspectLicenseMaterials()).toEqual([])
})

test("ordinary application edits need no licensing approval refresh", async () => {
	await withMaterials(async (directory) => {
		await Bun.write(join(directory, "src/speech/catalog.ts"), "// ordinary application edit\n")
		await Bun.write(join(directory, "bun.lock"), "unrelated development-tool change")
		await expect(assertLicenseMaterials(directory)).resolves.toBeUndefined()
	})
})

test("missing notices, corrupt sources and changed runtime versions fail with actionable errors", async () => {
	await withMaterials(async (directory) => {
		await Bun.file(join(directory, "NOTICE.md")).delete()
		const provenance = await Bun.file(join(directory, "vendor/source/provenance.json")).json()
		await Bun.write(join(directory, `vendor/source/${provenance.espeakNg.archive}`), "corrupted archive")
		const pkg = await Bun.file(join(directory, "package.json")).json()
		pkg.dependencies["onnxruntime-web"] = "0.0.1"
		await Bun.write(join(directory, "package.json"), JSON.stringify(pkg))
		const errors = await inspectLicenseMaterials(directory)
		expect(errors).toContain("Missing license/source material: NOTICE.md")
		expect(errors).toContain(`Source checksum mismatch: vendor/source/${provenance.espeakNg.archive}`)
		expect(errors).toContain("Update source materials for onnxruntime-web: dependency and provenance versions differ")
		await expect(assertLicenseMaterials(directory)).rejects.toThrow("License/source materials check failed")
	})
})

test("standalone live publishers reject missing license materials before invoking publishing tools", async () => {
	await withMaterials(async (directory) => {
		await Bun.file(join(directory, "LICENSE")).delete()
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
			expect(stderr).toContain("License/source materials check failed")
			expect(stderr).toContain("LICENSE")
		}
	})
})

test("missing supplier build recipes fail the materials check", async () => {
	await withMaterials(async (directory) => {
		const sources = await Bun.file(join(directory, "vendor/source/remote-sources.json")).json()
		const recipe = sources.preservedRecipes[0]
		await Bun.file(join(directory, recipe.path)).delete()
		expect(await inspectLicenseMaterials(directory)).toContain(`Missing license/source material: ${recipe.path}`)
	})
})
