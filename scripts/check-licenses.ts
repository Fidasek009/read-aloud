import { join } from "node:path"

const requiredFiles = [
	"LICENSE",
	"NOTICE.md",
	"public/notices.html",
	"vendor/source/README.md",
	"vendor/source/SOURCE-ACCESS.md",
	"vendor/espeak-ng/licenses/COPYING",
	"vendor/espeak-ng/licenses/COPYING.APACHE",
	"vendor/espeak-ng/licenses/COPYING.BSD2",
	"vendor/espeak-ng/licenses/COPYING.UCD",
	"vendor/espeak-ng/licenses/FILE-NOTICES.txt",
	"vendor/wxt/LICENSE",
	"vendor/onnxruntime/LICENSE",
	"vendor/onnxruntime/ThirdPartyNotices.txt",
	"vendor/onnx/LICENSE",
	"vendor/emscripten/LICENSE",
	"vendor/emscripten/musl-COPYRIGHT",
	"vendor/emscripten/libcxx-LICENSE",
	"vendor/emscripten/libcxxabi-LICENSE",
]

// Verify deliverables, not approval labels. Model/preview questions live in
// docs/licensing.md; passing this check does not resolve them or certify rights.
export async function inspectLicenseMaterials(root = process.cwd()): Promise<string[]> {
	const errors: string[] = []
	async function checkFile(path: string, sha256?: string) {
		if (path.startsWith("/") || path.split(/[\\/]/).includes("..")) throw new Error("Invalid source path")
		const file = Bun.file(join(root, path))
		if (!(await file.exists()) || file.size === 0) {
			errors.push(`Missing license/source material: ${path}`)
			return
		}
		if (sha256 && new Bun.CryptoHasher("sha256").update(await file.arrayBuffer()).digest("hex") !== sha256)
			errors.push(`Source checksum mismatch: ${path}`)
	}
	for (const path of requiredFiles) await checkFile(path)
	const provenance = await Bun.file(join(root, "vendor/source/provenance.json")).json()
	const pkg = await Bun.file(join(root, "package.json")).json()
	for (const [id, name] of [
		["spellophone", "@spelling-creator/spellophone"],
		["espeakNg", null],
		["wxt", "wxt"],
		["onnxRuntime", "onnxruntime-web"],
		["pdfJs", "pdfjs-dist"],
	] as const) {
		const source = provenance[id]
		if (!source?.version) throw new Error(`Missing source provenance: ${id}`)
		if (name && (pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]) !== source.version)
			errors.push(`Update source materials for ${name}: dependency and provenance versions differ`)
		if (id === "spellophone" || id === "espeakNg" || id === "wxt") {
			if (!/^[a-z0-9-]+\.tar\.gz$/.test(source.archive) || !/^[a-f0-9]{64}$/.test(source.sha256))
				throw new Error(`Invalid source archive provenance: ${id}`)
			await checkFile(`vendor/source/${source.archive}`, source.sha256)
		}
	}
	const sources = await Bun.file(join(root, "vendor/source/remote-sources.json")).json()
	if (!Array.isArray(sources.preservedRecipes) || sources.preservedRecipes.length === 0)
		throw new Error("Missing supplier build recipes")
	for (const recipe of sources.preservedRecipes) {
		if (!recipe.path?.startsWith("vendor/source/recipes/") || !/^[a-f0-9]{64}$/.test(recipe.sha256))
			throw new Error("Invalid supplier build recipe")
		await checkFile(recipe.path, recipe.sha256)
	}
	return errors
}

export async function assertLicenseMaterials(root = process.cwd()) {
	const errors = await inspectLicenseMaterials(root)
	if (errors.length) throw new Error(`License/source materials check failed:\n${errors.join("\n")}`)
}

if (import.meta.main) {
	await assertLicenseMaterials()
	console.log("License notices and pinned source materials are present. Open assessments: docs/licensing.md.")
}
