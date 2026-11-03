/** A local, seekable speech clip. PCM16 is supported by both browser decoders. */
export function speechWav(pcm: Float32Array, sampleRate: number): Blob {
	const bytes = new ArrayBuffer(44 + pcm.length * 2)
	const view = new DataView(bytes)
	const tag = (offset: number, text: string) => {
		for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
	}
	tag(0, "RIFF")
	view.setUint32(4, bytes.byteLength - 8, true)
	tag(8, "WAVEfmt ")
	view.setUint32(16, 16, true)
	view.setUint16(20, 1, true)
	view.setUint16(22, 1, true)
	view.setUint32(24, sampleRate, true)
	view.setUint32(28, sampleRate * 2, true)
	view.setUint16(32, 2, true)
	view.setUint16(34, 16, true)
	tag(36, "data")
	view.setUint32(40, pcm.length * 2, true)
	for (let i = 0; i < pcm.length; i++) {
		const value = Math.max(-1, Math.min(1, pcm[i]!))
		view.setInt16(44 + i * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true)
	}
	return new Blob([bytes], { type: "audio/wav" })
}
