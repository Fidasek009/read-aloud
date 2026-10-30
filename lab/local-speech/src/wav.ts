export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
	const data = new ArrayBuffer(44 + samples.length * 2)
	const view = new DataView(data)
	const ascii = (offset: number, text: string) =>
		[...text].forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0)))
	ascii(0, "RIFF")
	view.setUint32(4, data.byteLength - 8, true)
	ascii(8, "WAVE")
	ascii(12, "fmt ")
	view.setUint32(16, 16, true)
	view.setUint16(20, 1, true)
	view.setUint16(22, 1, true)
	view.setUint32(24, sampleRate, true)
	view.setUint32(28, sampleRate * 2, true)
	view.setUint16(32, 2, true)
	view.setUint16(34, 16, true)
	ascii(36, "data")
	view.setUint32(40, samples.length * 2, true)
	for (let index = 0; index < samples.length; index++) {
		const value = Math.max(-1, Math.min(1, samples[index]!))
		view.setInt16(44 + index * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true)
	}
	return new Uint8Array(data)
}
