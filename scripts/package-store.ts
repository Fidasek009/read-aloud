import { mkdir } from "node:fs/promises"

import { buildVersion } from "./release-version"

const dimensions: [string, number, number][] = [
	["store/assets/icon-128.png", 128, 128],
	["store/assets/promo-small.png", 440, 280],
	["store/assets/promo-marquee.png", 1400, 560],
	["store/assets/reading-selection.png", 1280, 800],
	["store/assets/voices-english.png", 1280, 800],
	["store/assets/voices-czech.png", 1280, 800],
	...[16, 32, 48, 64, 96, 128].map((size) => [`public/icons/icon-${size}.png`, size, size] as [string, number, number]),
]
for (const [path, width, height] of dimensions) {
	const bytes = await Bun.file(path).arrayBuffer()
	const data = new DataView(bytes)
	if (data.getUint32(0) !== 0x89504e47 || data.getUint32(16) !== width || data.getUint32(20) !== height)
		throw new Error(`Incorrect PNG dimensions: ${path}`)
}
await mkdir(".output", { recursive: true })
const output = `.output/read-aloud-${buildVersion()}-store-assets.zip`
// Recreate instead of updating an existing archive, so removed files cannot linger.
if (await Bun.file(output).exists()) await Bun.file(output).delete()
await Bun.$`zip -q -r ${output} store assets/brand public/icons PRIVACY.md LICENSE NOTICE.md SOURCE_CODE_REVIEW.md`
console.log(`Validated artwork and packaged ${output}`)
