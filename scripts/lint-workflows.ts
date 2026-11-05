import { chmod, mkdir } from "node:fs/promises"

// Verified upstream release checksum, not a mutable action or install script.
const version = "1.7.12"
const sha256 = "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8"
if (process.platform !== "linux" || process.arch !== "x64") throw new Error("Workflow linting requires Linux x64")
const directory = `.cache/actionlint/${version}`
await mkdir(directory, { recursive: true })
const response = await fetch(
	`https://github.com/rhysd/actionlint/releases/download/v${version}/actionlint_${version}_linux_amd64.tar.gz`,
)
if (!response.ok) throw new Error(`actionlint download failed: ${response.status}`)
const data = await response.arrayBuffer()
if (new Bun.CryptoHasher("sha256").update(data).digest("hex") !== sha256)
	throw new Error("actionlint checksum mismatch")
const archive = `${directory}/actionlint.tar.gz`
await Bun.write(archive, data)
await Bun.$`tar -xzf ${archive} -C ${directory} actionlint`.quiet()
await chmod(`${directory}/actionlint`, 0o755)
await Bun.$`${directory}/actionlint`
