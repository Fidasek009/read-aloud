import { $ } from "bun"
import protobuf from "protobufjs"

import { assetRoot, engine, lock, resolve, root, verify } from "./assets.ts"

if (engine !== "piper") throw new Error("Set BUN_LAB_ENGINE=piper for this experiment")
interface GraphNode {
	name: string
	opType: string
	input: string[]
	output: string[]
	attribute?: { name: string; ints?: { toNumber(): number }[] }[]
}
interface GraphModel {
	graph: { node: GraphNode[]; output: unknown[]; docString?: string }
	docString?: string
}
const schema = protobuf.parse(await Bun.file(resolve(root, "vendor/piper/onnx.proto3")).text()).root
const Model = schema.lookupType("onnx.ModelProto")
await $`mkdir -p ${resolve(assetRoot, "timed")}`.quiet()
for (const asset of lock.files.filter((file) => file.path.endsWith(".onnx"))) {
	const source = resolve(assetRoot, asset.path)
	if (!(await verify(source, asset))) throw new Error(`Missing or invalid source model: ${asset.path}`)
	const decoded = Model.decode(new Uint8Array(await Bun.file(source).arrayBuffer()))
	const model = decoded as unknown as GraphModel
	const ceils = model.graph.node.filter((node) => node.opType === "Ceil")
	const upsamplers = model.graph.node.filter(
		(node) => node.opType === "ConvTranspose" && node.name.includes("/dec/ups"),
	)
	console.log(asset.path, { ceils: ceils.map((node) => node.name), upsamplers: upsamplers.map((node) => node.name) })
	if (ceils.length !== 1 || ![3, 4].includes(upsamplers.length))
		throw new Error("Unrecognized duration/decoder graph; inspect before patching")
	const hopLength = upsamplers.reduce((product, node) => {
		const strides = node.attribute?.find((item) => item.name === "strides")?.ints
		if (strides?.length !== 1) throw new Error("Unexpected decoder stride")
		return product * Number(strides[0])
	}, 1)
	if (hopLength !== 256) throw new Error("Unexpected samples per duration frame")
	model.graph.node.push({
		name: "read_aloud_duration_output",
		opType: "Identity",
		input: [ceils[0]!.output[0]!],
		output: ["durations"],
	})
	model.graph.output.push({
		name: "durations",
		type: { tensorType: { elemType: 1, shape: { dim: [{ dimValue: 1 }, { dimValue: 1 }, { dimParam: "tokens" }] } } },
	})
	model.docString = `${model.docString ?? ""}\nModified for read-aloud experiment: expose predicted token frame counts as durations. Original synthesis operators and weights retained.`
	const bytes = Model.encode(decoded).finish()
	const id = asset.path.split("/").at(-1)!
	await Bun.write(resolve(assetRoot, "timed", id), bytes)
	await Bun.write(
		resolve(assetRoot, "timed", `${id}.metadata.json`),
		JSON.stringify(
			{
				source: asset,
				modification: "Added Identity graph output for predicted token durations; no weight changes",
				hopLength,
				bytes: bytes.length,
				sha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
			},
			null,
			2,
		) + "\n",
	)
}
