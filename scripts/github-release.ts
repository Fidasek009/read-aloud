import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

interface Result {
	exitCode: number
	stdout: string
}
type Run = (args: string[]) => Promise<Result>
const runGh: Run = async (args) => {
	const child = Bun.spawn(["gh", ...args], { stdout: "pipe", stderr: "inherit" })
	const stdout = await new Response(child.stdout).text()
	return { exitCode: await child.exited, stdout }
}

export async function publishRelease(tag: string, files: string[], notes: string, run: Run = runGh) {
	async function checked(args: string[]) {
		const result = await run(args)
		if (result.exitCode !== 0) throw new Error(`GitHub release command failed: ${args.slice(0, 2).join(" ")}`)
		return result.stdout
	}
	let view = await run(["release", "view", tag, "--json", "isDraft,assets"])
	if (view.exitCode !== 0) {
		// Notes generation happens before assets/publication. A failed creation is safe to retry.
		await checked(["release", "create", tag, "--draft", "--verify-tag", "--generate-notes", "--notes-file", notes])
		view = { exitCode: 0, stdout: await checked(["release", "view", tag, "--json", "isDraft,assets"]) }
	}
	const release = JSON.parse(view.stdout) as { isDraft: boolean; assets: { name: string }[] }
	if (release.isDraft) {
		await checked(["release", "upload", tag, ...files, "--clobber"])
		await checked(["release", "edit", tag, "--draft=false", "--latest"])
		return
	}
	// A previous publication may have succeeded despite a lost response. Never overwrite
	// published assets: verify existing bytes and repair only missing uploads.
	const temp = await mkdtemp(join(tmpdir(), "read-aloud-release-"))
	try {
		for (const file of files) {
			if (!release.assets.some((asset) => asset.name === basename(file))) {
				await checked(["release", "upload", tag, file])
				continue
			}
			await checked(["release", "download", tag, "--pattern", basename(file), "--dir", temp])
			const downloaded = await Bun.file(join(temp, basename(file))).arrayBuffer()
			const expected = await Bun.file(file).arrayBuffer()
			if (!Buffer.from(downloaded).equals(Buffer.from(expected)))
				throw new Error(`Published asset differs: ${basename(file)}`)
		}
	} finally {
		await rm(temp, { recursive: true, force: true })
	}
}

if (import.meta.main) {
	const tag = process.env.RELEASE_TAG
	if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error("RELEASE_TAG is required")
	const zips = (await Array.fromAsync(new Bun.Glob("*.zip").scan({ cwd: "artifacts" })))
		.sort()
		.map((file) => `artifacts/${file}`)
	if (zips.length !== 3) throw new Error("Expected Chrome, Firefox and reviewer source archives")
	const checksums = []
	for (const file of zips)
		checksums.push(
			`${new Bun.CryptoHasher("sha256").update(await Bun.file(file).arrayBuffer()).digest("hex")}  ${basename(file)}`,
		)
	await Bun.write("artifacts/SHA256SUMS", `${checksums.join("\n")}\n`)
	const notes = "artifacts/release-notes.md"
	await Bun.write(
		notes,
		"Both store submissions succeeded. Store review may still be pending; this release does not imply store approval. The Firefox ZIP is unsigned; install Firefox releases through AMO.\n",
	)
	await publishRelease(tag, [...zips, "artifacts/SHA256SUMS"], notes)
}
