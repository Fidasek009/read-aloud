// ONNX protobuf wire layout: official onnx.proto3 v1.19.1 (Apache-2.0),
// preserved in vendor/onnx. This narrow transformation never evaluates code
// and leaves every original weight/operator byte intact.
interface Field {
	number: number
	wire: number
	start: number
	payload: number
	end: number
}
const decoder = new TextDecoder()
const encoder = new TextEncoder()
function readInteger(bytes: Uint8Array, start: number, limit: number): [number, number] {
	let value = 0,
		factor = 1
	for (let offset = start; offset < Math.min(start + 5, limit); offset++) {
		const byte = bytes[offset]!
		value += (byte & 127) * factor
		if (byte < 128) {
			if (value > 0xffffffff) throw new Error("ONNX integer exceeds the supported size")
			return [value, offset + 1]
		}
		factor *= 128
	}
	throw new Error("Malformed ONNX integer")
}
function* fields(bytes: Uint8Array, start = 0, limit = bytes.length): Generator<Field> {
	let cursor = start
	while (cursor < limit) {
		const begin = cursor
		const [tag, afterTag] = readInteger(bytes, cursor, limit)
		cursor = afterTag
		const wire = tag & 7,
			number = tag >>> 3
		let payload = cursor
		if (!number) throw new Error("Malformed ONNX field")
		if (wire === 2) {
			const [length, afterLength] = readInteger(bytes, cursor, limit)
			payload = afterLength
			cursor = payload + length
		} else if (wire === 0) {
			// Generic protobuf int64 fields can consume ten bytes. We only read
			// the values of the small positive decoder strides below.
			let count = 0
			do {
				if (cursor >= limit || ++count > 10) throw new Error("Malformed ONNX varint")
			} while (bytes[cursor++]! >= 128)
		} else if (wire === 1) cursor += 8
		else if (wire === 5) cursor += 4
		else throw new Error("Unsupported ONNX wire type")
		if (cursor > limit) throw new Error("Truncated ONNX field")
		yield { number, wire, start: begin, payload, end: cursor }
	}
}
function integer(value: number): Uint8Array<ArrayBuffer> {
	const bytes: number[] = []
	do {
		const byte = value % 128
		value = Math.floor(value / 128)
		bytes.push(byte | (value ? 128 : 0))
	} while (value)
	return Uint8Array.from(bytes)
}
function join(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0))
	let cursor = 0
	for (const part of parts) {
		result.set(part, cursor)
		cursor += part.length
	}
	return result
}
const message = (field: number, bytes: Uint8Array) => join(integer(field * 8 + 2), integer(bytes.length), bytes)
const string = (field: number, value: string) => message(field, encoder.encode(value))
const scalar = (field: number, value: number) => join(integer(field * 8), integer(value))

/** Expose predicted VITS token frames without altering the speech graph. */
export function instrumentModel(source: ArrayBuffer): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(source)
	const graphs = [...fields(bytes)].filter((field) => field.number === 7 && field.wire === 2)
	if (graphs.length !== 1) throw new Error("Voice must contain exactly one ONNX graph")
	const graph = graphs[0]!
	const ceils: string[] = []
	let upsamplers = 0,
		hop = 1
	for (const field of fields(bytes, graph.payload, graph.end)) {
		if (field.number !== 1 || field.wire !== 2) continue
		const node = [...fields(bytes, field.payload, field.end)]
		const text = (number: number) => {
			const value = node.find((field) => field.number === number && field.wire === 2)
			return value ? decoder.decode(bytes.subarray(value.payload, value.end)) : ""
		}
		if (text(4) === "Ceil") ceils.push(text(2))
		if (text(4) === "ConvTranspose" && text(3).includes("/dec/ups")) {
			upsamplers++
			let stride: number | undefined
			for (const attr of node.filter((field) => field.number === 5 && field.wire === 2)) {
				const members = [...fields(bytes, attr.payload, attr.end)]
				const name = members.find((field) => field.number === 1)
				if (!name || decoder.decode(bytes.subarray(name.payload, name.end)) !== "strides") continue
				const values = members.filter((field) => field.number === 8)
				if (values.length !== 1) throw new Error("Unsupported ONNX decoder strides")
				const value = values[0]!
				const [number, after] = readInteger(bytes, value.payload, value.end)
				if (after !== value.end || number < 1) throw new Error("Unsupported ONNX decoder stride")
				stride = number
			}
			if (!stride) throw new Error("Missing ONNX decoder stride")
			hop *= stride
		}
	}
	if (ceils.length !== 1 || !ceils[0] || ![3, 4].includes(upsamplers) || hop !== 256)
		throw new Error("This voice has an unsupported timing graph")
	const name = "read_aloud_durations"
	const node = join(string(1, ceils[0]), string(2, name), string(3, name), string(4, "Identity"))
	// ValueInfoProto -> TypeProto.tensor_type -> Tensor{elem_type, shape}
	const shape = join(message(1, scalar(1, 1)), message(1, scalar(1, 1)), message(1, string(2, "tokens")))
	const tensor = join(scalar(1, 1), message(2, shape))
	const info = join(string(1, name), message(2, message(1, tensor)))
	const modified = join(bytes.subarray(graph.payload, graph.end), message(1, node), message(12, info))
	return join(
		bytes.subarray(0, graph.start),
		message(7, modified),
		bytes.subarray(graph.end),
		string(6, "Modified by Read Aloud: exposed predicted token durations. Original speech graph and weights retained."),
	)
}
