import { expect, test } from "bun:test"
import protobuf from "protobufjs"

import { instrumentInWorker } from "../src/speech/instrument-client.ts"
import { instrumentModel } from "../src/speech/instrument.ts"

const schema = protobuf.parse(await Bun.file(new URL("../vendor/onnx/onnx.proto3", import.meta.url)).text()).root
const Model = schema.lookupType("onnx.ModelProto")
const fixture = (ceils = 1) =>
	Model.encode(
		Model.create({
			irVersion: 7,
			graph: {
				name: "timing-fixture",
				node: [
					...Array.from({ length: ceils }, (_, index) => ({
						name: `ceil-${index}`,
						opType: "Ceil",
						input: ["predictions"],
						output: ["frames"],
					})),
					...[8, 8, 4].map((stride, index) => ({
						name: `/dec/ups.${index}/ConvTranspose`,
						opType: "ConvTranspose",
						input: ["audio"],
						output: ["audio"],
						attribute: [{ name: "strides", type: 7, ints: [stride] }],
					})),
				],
				initializer: [{ name: "original-weights", dataType: 1, dims: [1], rawData: Uint8Array.of(0, 0, 128, 63) }],
				output: [{ name: "output" }],
			},
		}),
	).finish()

test("model instrumentation preserves original operators and weights while exposing duration frames", () => {
	const source = fixture()
	const sourceModel = Model.toObject(Model.decode(source)) as any
	const transformed = instrumentModel(Uint8Array.from(source).buffer)
	const result = Model.toObject(Model.decode(transformed)) as any
	expect(result.graph.node.slice(0, -1)).toEqual(sourceModel.graph.node)
	expect(result.graph.initializer).toEqual(sourceModel.graph.initializer)
	expect(result.graph.node.at(-1)).toMatchObject({
		opType: "Identity",
		input: ["frames"],
		output: ["read_aloud_durations"],
	})
	expect(result.graph.output.at(-1)).toMatchObject({
		name: "read_aloud_durations",
		type: { tensorType: { elemType: 1 } },
	})
	expect(result.docString).toContain("Modified by Read Aloud")
})

test("unrecognized and truncated model graphs are rejected before installation", () => {
	expect(() => instrumentModel(Uint8Array.from(fixture(2)).buffer)).toThrow("unsupported timing graph")
	expect(() => instrumentModel(Uint8Array.from(fixture().slice(0, -3)).buffer)).toThrow()
	expect(() => instrumentModel(new ArrayBuffer(0))).toThrow()
})

test("voice preparation runs in a worker and returns the same instrumented graph", async () => {
	const source = Uint8Array.from(fixture()).buffer
	const expected = instrumentModel(source.slice(0))
	const output = await instrumentInWorker(
		source,
		new AbortController().signal,
		() => new Worker(new URL("../src/speech/instrument-worker.ts", import.meta.url), { type: "module" }),
	)
	expect(new Uint8Array(output)).toEqual(expected)
	expect(source.byteLength).toBe(0)
})

test("cancelling voice preparation terminates its worker without saving a result", async () => {
	const controller = new AbortController()
	let terminated = false
	const worker = {
		postMessage: () => {},
		terminate: () => {
			terminated = true
		},
	} as unknown as Worker
	const preparation = instrumentInWorker(new ArrayBuffer(8), controller.signal, () => worker)
	controller.abort()
	await expect(preparation).rejects.toMatchObject({ name: "AbortError" })
	expect(terminated).toBe(true)
})
