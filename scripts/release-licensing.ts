import { join } from "node:path"

const requiredFindings = [
	"corresponding-source",
	"runtime-notices",
	"model-downloads",
	"preview-integration",
	"store-distribution",
]
const requiredInputs = [
	"package.json",
	"bun.lock",
	"src/speech/voices.json",
	"scripts/prepare-runtime.ts",
	"public/notices.html",
	"NOTICE.md",
	"vendor/source/provenance.json",
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
interface Finding {
	id: string
	status: "satisfied" | "unresolved"
	evidence: string[]
	remaining: string[]
}
interface RecordData {
	schemaVersion: number
	reviewedAt: string
	inputs: Record<string, string>
	findings: Finding[]
}
export interface LicensingAudit {
	stale: string[]
	blockers: string[]
}

// This checks a committed review and its exact inputs; it cannot manufacture a
// copyright grant or substitute for the underlying evidence/review.
export async function inspectReleaseLicensing(root = process.cwd()): Promise<LicensingAudit> {
	const record = (await Bun.file(join(root, "release/licensing.json")).json()) as RecordData
	if (
		record.schemaVersion !== 1 ||
		!/^\d{4}-\d{2}-\d{2}$/.test(record.reviewedAt) ||
		!record.inputs ||
		!Array.isArray(record.findings)
	)
		throw new Error("Malformed release licensing record")
	const stale: string[] = []
	const blockers: string[] = []
	for (const path of requiredInputs) if (!(path in record.inputs)) stale.push(`Missing reviewed input: ${path}`)
	const sources = await Bun.file(join(root, "vendor/source/provenance.json")).json()
	for (const id of ["spellophone", "espeakNg", "wxt"]) {
		const source = sources[id]
		if (
			!source ||
			typeof source.archive !== "string" ||
			!/^[a-z0-9-]+\.tar\.gz$/.test(source.archive) ||
			!/^[a-f0-9]{64}$/.test(source.sha256)
		)
			throw new Error(`Missing pinned source archive: ${id}`)
		const path = `vendor/source/${source.archive}`
		if (record.inputs[path] !== source.sha256) stale.push(`Missing or inconsistent reviewed source archive: ${path}`)
	}
	for (const [path, expected] of Object.entries(record.inputs)) {
		if (path.startsWith("/") || path.includes("..") || !/^[a-f0-9]{64}$/.test(expected))
			throw new Error("Invalid licensing input fingerprint")
		const file = Bun.file(join(root, path))
		if (!(await file.exists())) {
			stale.push(`Missing reviewed file: ${path}`)
			continue
		}
		const actual = new Bun.CryptoHasher("sha256").update(await file.arrayBuffer()).digest("hex")
		if (actual !== expected) stale.push(`Licensing review is stale for ${path}`)
	}
	for (const id of requiredFindings) {
		const matches = record.findings.filter((finding) => finding.id === id)
		if (matches.length !== 1) {
			blockers.push(`Missing or duplicate licensing finding: ${id}`)
			continue
		}
		const finding = matches[0]!
		if (
			!Array.isArray(finding.evidence) ||
			finding.evidence.length === 0 ||
			finding.evidence.some((value) => typeof value !== "string" || !value.trim()) ||
			!Array.isArray(finding.remaining) ||
			finding.remaining.some((value) => typeof value !== "string" || !value.trim())
		)
			throw new Error(`Missing licensing evidence for ${id}`)
		// Remaining work blocks even if someone changes only the status label.
		if (finding.status !== "satisfied" || finding.remaining.length > 0)
			blockers.push(`${id}: ${finding.remaining.join("; ") || "review is unresolved"}`)
	}
	return { stale, blockers }
}

export async function assertReleaseLicensing(root = process.cwd()) {
	const { stale, blockers } = await inspectReleaseLicensing(root)
	if (stale.length || blockers.length)
		throw new Error(`Public release blocked by licensing review:\n${[...stale, ...blockers].join("\n")}`)
}

if (import.meta.main) {
	const audit = await inspectReleaseLicensing()
	if (audit.stale.length || (process.argv.includes("--release") && audit.blockers.length))
		throw new Error(`Release licensing validation failed:\n${[...audit.stale, ...audit.blockers].join("\n")}`)
	console.log(
		audit.blockers.length
			? `Licensing audit is current; PUBLIC RELEASE BLOCKED (${audit.blockers.length} unresolved findings). See release/licensing.json and docs/licensing.md.`
			: "Licensing review inputs and findings pass.",
	)
}
