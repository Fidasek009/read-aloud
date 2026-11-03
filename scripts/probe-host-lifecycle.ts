import type { browser } from "wxt/browser"

import { $ } from "bun"

import {
	assert,
	chromeExecutable,
	chromeExtensionId,
	chromeTestProfileArguments,
	projectRoot,
	waitFor,
} from "./probe-helpers.ts"

interface HostFixtureState {
	port?: ReturnType<typeof browser.runtime.connect>
	disconnected?: boolean
}
type HostFixtureWindow = Window &
	typeof globalThis & {
		chrome: typeof browser
		__hostFixture?: HostFixtureState
	}

// These functions execute on the copied player.html, preserving production sender
// validation. The synthetic client holds exactly the same port as a paused player;
// this isolates document lifetime without downloading or running a voice model.
async function prepareHost() {
	const fixture = window as HostFixtureWindow
	const response: unknown = await fixture.chrome.runtime.sendMessage({ type: "prepare-speech-host" })
	if (!response || typeof response !== "object" || !("ok" in response) || response.ok !== true)
		throw new Error("Speech host preparation failed")
	return true
}

async function connectHostClient() {
	const fixture = window as HostFixtureWindow
	const state: HostFixtureState = { disconnected: false }
	fixture.__hostFixture = state
	const port = fixture.chrome.runtime.connect({ name: "speech-client" })
	state.port = port
	port.onDisconnect.addListener(() => {
		state.disconnected = true
	})
	// A cancel from a client without an owned model returns cancelled. Receiving
	// that reply proves the production host accepted the port, without inference.
	return new Promise<boolean>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("Speech host did not accept the client")), 5000)
		port.onMessage.addListener((response: unknown) => {
			if (!response || typeof response !== "object" || !("id" in response) || response.id !== 1) return
			clearTimeout(timer)
			resolve(true)
		})
		port.postMessage({ id: 1, type: "cancel" })
	})
}

function disconnectHostClient() {
	const fixture = window as HostFixtureWindow
	fixture.__hostFixture?.port?.disconnect()
	return true
}

function clientConnected() {
	const fixture = window as HostFixtureWindow
	return !!fixture.__hostFixture?.port && fixture.__hostFixture.disconnected === false
}

const extension = `${projectRoot}/.cache/host-lifecycle-probe`
await $`rm -rf ${extension}`.quiet()
await $`mkdir -p ${extension}`.quiet()
await $`cp -R ${projectRoot + "/.output/chrome-mv3/."} ${extension}`.quiet()
// Rebuild only the production offscreen entrypoint with shortened test deadlines.
// The broker, client validation, service and lifecycle implementation remain real.
const shortened = Bun.env.HOST_LIFECYCLE_REAL_TIME !== "1"
const retentionMs = shortened ? 1600 : 120_000
const leaseMs = shortened ? 700 : 10_000
const build = await Bun.build({
	entrypoints: [`${projectRoot}/src/entrypoints/inference/main.ts`],
	outdir: extension,
	naming: "probe-inference.js",
	target: "browser",
	format: "esm",
	plugins: [
		{
			name: "shorten-host-lifetime-fixture",
			setup(builder) {
				builder.onLoad({ filter: /[/\\]speech[/\\]host-lifetime\.ts$/u }, async (args) => ({
					contents: (await Bun.file(args.path).text())
						.replace("SPEECH_HOST_RETENTION_MS = 120_000", `SPEECH_HOST_RETENTION_MS = ${retentionMs}`)
						.replace("SPEECH_HOST_LEASE_MS = 10_000", `SPEECH_HOST_LEASE_MS = ${leaseMs}`),
					loader: "ts",
				}))
			},
		},
	],
})
if (!build.success) throw new AggregateError(build.logs, "Speech host lifecycle fixture failed to bundle")
await Bun.write(
	`${extension}/inference.html`,
	'<!doctype html><script type="module" src="probe-inference.js"></script>',
)
await Bun.write(`${extension}/player.html`, "<!doctype html><title>Speech host lifetime fixture</title>")
const executable = await chromeExecutable()
const view = new Bun.WebView({
	backend: {
		type: "chrome",
		url: false,
		...(executable ? { path: executable } : {}),
		argv: [
			...chromeTestProfileArguments,
			`--disable-extensions-except=${extension}`,
			`--load-extension=${extension}`,
			"--enable-unsafe-extension-debugging",
		],
	},
	dataStore: "ephemeral",
})
const extensionId = chromeExtensionId(extension)
const hostUrl = `chrome-extension://${extensionId}/inference.html`
async function hostTarget() {
	const targets = await view.cdp<{ targetInfos: { targetId: string; url: string }[] }>("Target.getTargets")
	return targets.targetInfos.find((target) => target.url === hostUrl)
}
const invoke = (operation: () => unknown) => view.evaluate<boolean>(`(${operation.toString()})()`)
const waitClosed = () => waitFor(hostTarget, (target) => !target, retentionMs / 1000 + 15)
try {
	await view.navigate(`chrome-extension://${extensionId}/player.html`)
	await invoke(prepareHost)
	const initial = await waitFor(hostTarget, Boolean, 15)
	assert(initial, "Offscreen speech host was not created")
	await invoke(connectHostClient)
	await Bun.sleep(retentionMs + leaseMs + 250)
	assert((await hostTarget())?.targetId === initial.targetId, "Open/paused client lost its speech host")
	assert(await invoke(clientConnected), "Idle host disconnected its open/paused client")
	console.log("An open/paused client retained the host beyond its idle timeout.")
	await invoke(disconnectHostClient)
	await waitClosed()
	console.log("The offscreen document closed after its final client disconnected.")

	await invoke(prepareHost)
	const reopened = await waitFor(hostTarget, Boolean, 15)
	assert(reopened && reopened.targetId !== initial.targetId, "A fresh host was not created after idle closure")
	await invoke(connectHostClient)
	await invoke(disconnectHostClient)
	// Reserve just before expiration, then deliberately leave the connect gap
	// extending beyond the old disconnect deadline. Closure must lose the race.
	await Bun.sleep(Math.max(0, retentionMs - leaseMs / 2))
	await invoke(prepareHost)
	await Bun.sleep(leaseMs * 0.75)
	assert((await hostTarget())?.targetId === reopened.targetId, "Idle closure beat a reserved preparation")
	await invoke(connectHostClient)
	assert(await invoke(clientConnected), "The delayed client did not connect after the preparation lease")
	console.log("A reserved preparation protected the delayed client connection across the idle deadline.")
	await invoke(disconnectHostClient)
	await waitClosed()

	await invoke(prepareHost)
	await waitFor(hostTarget, Boolean, 15)
	await waitFor(hostTarget, (target) => !target, leaseMs / 1000 + 15)
	console.log("An unused preparation lease expired and its empty document closed.")
	await Bun.write(
		`${projectRoot}/docs/evidence/host-lifecycle-2026-11-03.json`,
		JSON.stringify(
			{
				recordedAt: new Date().toISOString(),
				browser: await view.cdp("Browser.getVersion"),
				retentionMs,
				leaseMs,
				shortenedDeadlines: shortened,
				openClientRetainsHost: true,
				lastDisconnectClosesHost: true,
				reopeningCreatesFreshHost: true,
				preparationLeaseProtectsConnectGap: true,
				unusedLeaseClosesHost: true,
				limits:
					"Real production broker and offscreen lifetime implementation, synthetic player-owned port, no voice model or audio. Default deadlines are shortened in a copied test bundle; this does not measure actual two-minute retention or Chrome 140–149 behavior.",
			},
			null,
			2,
		) + "\n",
	)
} finally {
	view.close()
}
