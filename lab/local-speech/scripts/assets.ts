import { $ } from "bun"

export const root = import.meta.dir.replace(/[\\/]scripts$/, "")
export const resolve = (...parts: string[]): string => parts.join("/")
export interface Asset {
	path: string
	bytes: number
	sha256: string
	url?: string
}
interface AssetLock {
	model: string
	revision: string
	voice: string
	license: string
	source: string
	files: Asset[]
}
export const engine = Bun.env.BUN_LAB_ENGINE === "piper" ? "piper" : "supertonic"
export const lock = (await Bun.file(
	resolve(root, engine === "piper" ? "piper-assets.lock.json" : "assets.lock.json"),
).json()) as AssetLock
export const assetRoot = resolve(root, `../../.cache/${engine}`, lock.revision)
export const outputRoot = resolve(root, "dist", engine)

export async function verify(path: string, asset: Pick<Asset, "bytes" | "sha256">): Promise<boolean> {
	const file = Bun.file(path)
	if (!(await file.exists()) || file.size !== asset.bytes) return false
	const hash = new Bun.CryptoHasher("sha256")
	for await (const chunk of file.stream()) hash.update(chunk)
	return hash.digest("hex") === asset.sha256
}

export async function download(asset: Asset): Promise<void> {
	const destination = resolve(assetRoot, asset.path)
	if (await verify(destination, asset)) return
	await $`mkdir -p ${destination.slice(0, destination.lastIndexOf("/"))}`.quiet()
	const temporary = `${destination}.${crypto.randomUUID()}.partial`
	const url = asset.url ?? `https://huggingface.co/${lock.model}/resolve/${lock.revision}/${asset.path}`
	console.log(`Downloading ${asset.path} (${asset.bytes} bytes)`)
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(300_000) })
		if (!response.ok || !response.body) throw new Error(`Download failed: HTTP ${response.status}`)
		let bytes = 0
		const limited = response.body.pipeThrough(
			new TransformStream<Uint8Array, Uint8Array>({
				transform(chunk, controller) {
					bytes += chunk.length
					if (bytes > asset.bytes) throw new Error("Asset exceeds pinned size")
					controller.enqueue(chunk)
				},
			}),
		)
		// Bun 1.4.1+ streams Response bodies to disk rather than buffering the model.
		await Bun.write(temporary, new Response(limited))
		if (!(await verify(temporary, asset))) throw new Error(`Asset integrity check failed: ${asset.path}`)
		await $`mv ${temporary} ${destination}`.quiet()
	} finally {
		if (await Bun.file(temporary).exists()) await Bun.file(temporary).delete()
	}
}

if (import.meta.main) {
	console.log(`Explicit developer download: ${lock.model}; weights license: ${lock.license}`)
	for (const asset of lock.files) await download(asset)
	console.log(`Verified assets: ${assetRoot}`)
}
