import { $ } from "bun"

// Linux browser-test fixture only. No system daemon, package installation, or
// end-user helper: a private null sink is destroyed when the probe finishes.
const root = import.meta.dir.replace(/\/scripts$/, "")
const distribution = `${root}/.cache/test-audio/pulse`
const runtime = `${root}/.cache/test-audio/runtime-${crypto.randomUUID()}`
await $`mkdir -p ${runtime}`.quiet()
await $`chmod 700 ${runtime}`.quiet()
const socket = `${runtime}/native`
const server = Bun.spawn(
	[
		`${distribution}/usr/bin/pulseaudio`,
		"--daemonize=no",
		"--use-pid-file=no",
		"--exit-idle-time=-1",
		"--log-target=stderr",
		"--log-level=warning",
		"--disable-shm",
		"-n",
		`--dl-search-path=${distribution}/usr/lib/pulse-15.99.1+dfsg1/modules`,
		`--load=module-native-protocol-unix socket=${socket} auth-anonymous=1 auth-cookie=${runtime}/cookie`,
		"--load=module-null-sink sink_name=read_aloud_test rate=48000 channels=2",
	],
	{
		env: {
			...Bun.env,
			LD_LIBRARY_PATH: `${distribution}/usr/lib/pulse-15.99.1+dfsg1/modules:${distribution}/usr/lib/x86_64-linux-gnu:${distribution}/usr/lib/x86_64-linux-gnu/pulseaudio:${Bun.env.LD_LIBRARY_PATH ?? ""}`,
			PULSE_RUNTIME_PATH: runtime,
		},
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
	},
)
let log = ""
const consume = async (stream: ReadableStream<Uint8Array>) => {
	for await (const bytes of stream) log = (log + new TextDecoder().decode(bytes)).slice(-10_000)
}
const readers = [consume(server.stdout), consume(server.stderr)]
try {
	const deadline = performance.now() + 10_000
	while ((await $`test -S ${socket}`.quiet().nothrow()).exitCode !== 0) {
		if (server.exitCode !== null || performance.now() > deadline) throw new Error(`Virtual audio did not start: ${log}`)
		await Bun.sleep(100)
	}
	console.log("Running browser probe with a private virtual audio output.")
	const child = Bun.spawn(["bun", ...Bun.argv.slice(2)], {
		env: { ...Bun.env, PULSE_SERVER: `unix:${socket}` },
		stdin: "inherit",
		stdout: "inherit",
		stderr: "inherit",
	})
	const code = await child.exited
	if (code) throw new Error(`Browser probe exited ${code}`)
} finally {
	server.kill()
	await server.exited
	await Promise.all(readers)
	await $`rm -rf ${runtime}`.quiet()
}
