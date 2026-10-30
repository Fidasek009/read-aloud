import { $ } from "bun"
import { expect, test } from "bun:test"

import { root, verify } from "../scripts/assets.ts"
import { encodeWav } from "../src/wav.ts"

test("rejects missing, truncated, and same-size corrupted model assets", async () => {
	const directory = `${root}/../../.cache/integrity-tests/${crypto.randomUUID()}`
	await $`mkdir -p ${directory}`.quiet()
	try {
		const path = `${directory}/model`
		const bytes = new TextEncoder().encode("trusted model")
		const asset = { bytes: bytes.length, sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex") }
		expect(await verify(path, asset)).toBe(false)
		await Bun.write(path, bytes)
		expect(await verify(path, asset)).toBe(true)
		await Bun.write(path, bytes.subarray(1))
		expect(await verify(path, asset)).toBe(false)
		await Bun.write(path, new Uint8Array(bytes.length))
		expect(await verify(path, asset)).toBe(false)
	} finally {
		await $`rm -rf ${directory}`.quiet()
	}
})

test("exports playable mono PCM with the model sample rate and clipped amplitudes", () => {
	const wave = encodeWav(new Float32Array([-2, -0.5, 0, 0.5, 2]), 24000)
	const view = new DataView(wave.buffer)
	expect(new TextDecoder().decode(wave.subarray(0, 4))).toBe("RIFF")
	expect(new TextDecoder().decode(wave.subarray(8, 12))).toBe("WAVE")
	expect(view.getUint32(4, true)).toBe(wave.length - 8)
	expect(view.getUint16(22, true)).toBe(1)
	expect(view.getUint32(24, true)).toBe(24000)
	expect(view.getUint32(40, true)).toBe(10)
	expect(Array.from({ length: 5 }, (_, index) => view.getInt16(44 + index * 2, true))).toEqual([
		-32768, -16384, 0, 16384, 32767,
	])
})
