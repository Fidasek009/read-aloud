import { instrumentModel } from "./instrument.ts"

self.onmessage = ({ data }: MessageEvent<unknown>) => {
	try {
		if (!(data instanceof ArrayBuffer)) throw new Error("Invalid voice model")
		const result = instrumentModel(data)
		self.postMessage({ ok: true, model: result.buffer }, { transfer: [result.buffer] })
	} catch (error) {
		self.postMessage({ ok: false, error: error instanceof Error ? error.message : "Voice preparation failed" })
	}
}
