import type { browser } from "wxt/browser"

import { instrumentModel } from "../src/speech/instrument.ts"
import { validateConfig, type VoiceConfig } from "../src/speech/voice-config.ts"
import { pageScript } from "./page-script.ts"
import {
	assert,
	chromeExtensionId,
	closeChromeProbe,
	copyProbeExtension,
	createChromeProbe,
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

async function installFixtureVoice(sourceHash: string, modelUrl: string, config: VoiceConfig) {
	const { writeStoredVoice } = await import("./voice-fixtures.js")
	const model = await (await fetch(modelUrl)).arrayBuffer()
	await writeStoredVoice({ id: "en_US-ljspeech-medium", sourceHash, model, config })
}

interface FixtureSpeechResult {
	ok: boolean
	samples: number
	words: number
	backend: string
}

async function speakThroughFixtureHost(): Promise<FixtureSpeechResult> {
	interface Reply {
		id: number
		ok: boolean
		code?: string
		clip?: { pcm: string; words: unknown[] }
		diagnostics?: { backend?: string }
	}
	const port = (window as HostFixtureWindow).__hostFixture?.port
	if (!port) throw Error("Speech fixture host port is unavailable")
	const rpc = (message: { id: number; type: string; [key: string]: unknown }) =>
		new Promise<Reply>((resolve, reject) => {
			const timer = setTimeout(() => reject(Error("Speech fixture timed out")), 90_000)
			const listener = (reply: Reply) => {
				if (reply.id !== message.id) return
				clearTimeout(timer)
				port.onMessage.removeListener(listener)
				resolve(reply)
			}
			port.onMessage.addListener(listener)
			port.postMessage(message)
		})
	const loaded = await rpc({ id: 2, type: "load", voice: "en_US-ljspeech-medium" })
	if (!loaded.ok) return { ok: false, samples: 0, words: 0, backend: `load failed: ${loaded.code}` }
	const spoken = await rpc({ id: 3, type: "synthesize", text: "One natural voice on your device.", speed: 1 })
	return {
		ok: spoken.ok,
		samples: spoken.clip ? Uint8Array.fromBase64(spoken.clip.pcm).byteLength / 4 : 0,
		words: spoken.clip?.words.length ?? 0,
		backend: spoken.diagnostics?.backend ?? spoken.code ?? "",
	}
}

function installOffscreenPolicyProbe() {
	interface Reply {
		ok: boolean
	}
	const api = (globalThis as unknown as { chrome: typeof browser }).chrome
	const send = (message: object) => api.runtime.sendMessage(message) as Promise<Reply>
	const listener = (message: unknown) => {
		if (!message || typeof message !== "object" || !("type" in message) || message.type !== "probe-offscreen-policy")
			return
		return (async () => {
			const before = await send({ type: "speech-gpu-available" })
			await send({ type: "speech-gpu-failed" })
			const after = await send({ type: "speech-gpu-available" })
			return {
				storageUnavailable: (api as { storage?: unknown }).storage === undefined,
				before: before.ok,
				after: after.ok,
			}
		})()
	}
	api.runtime.onMessage.addListener(listener as Parameters<typeof api.runtime.onMessage.addListener>[0])
}

const extension = `${projectRoot}/.cache/host-lifecycle-probe`
await copyProbeExtension("chrome", extension)
const withSpeech = Bun.env.HOST_LIFECYCLE_SPEECH === "1"
const fixture = `${projectRoot}/.cache/piper/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/en/en_US/ljspeech/medium/en_US-ljspeech-medium.onnx`
const fixtureModel = withSpeech ? instrumentModel(await Bun.file(fixture).arrayBuffer()) : undefined
const fixtureServer = fixtureModel
	? Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			fetch: () =>
				new Response(fixtureModel, {
					headers: { "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin" },
				}),
		})
	: undefined
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
	define: { "import.meta.env.BROWSER": '"chrome"' },
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
if (withSpeech) {
	const manifest = await Bun.file(`${extension}/manifest.json`).json()
	manifest.host_permissions = ["http://127.0.0.1/*"]
	await Bun.write(`${extension}/manifest.json`, JSON.stringify(manifest))
	await Bun.write(`${extension}/offscreen-policy-probe.js`, pageScript(installOffscreenPolicyProbe))
	await Bun.write(
		`${extension}/inference.html`,
		`${await Bun.file(`${extension}/inference.html`).text()}<script src="offscreen-policy-probe.js"></script>`,
	)
}
const view = await createChromeProbe(extension, ["--enable-unsafe-extension-debugging"])
const extensionId = chromeExtensionId(extension)
const hostUrl = `chrome-extension://${extensionId}/inference.html`
async function hostTarget() {
	const targets = await view.cdp<{ targetInfos: { targetId: string; url: string }[] }>("Target.getTargets")
	return targets.targetInfos.find((target) => target.url === hostUrl)
}
const waitClosed = () => waitFor(hostTarget, (target) => !target, retentionMs / 1000 + 15)
try {
	await view.navigate(`chrome-extension://${extensionId}/player.html`)
	await view.evaluate<boolean>(pageScript(prepareHost))
	const initial = await waitFor(hostTarget, Boolean, 15)
	assert(initial, "Offscreen speech host was not created")
	await view.evaluate<boolean>(pageScript(connectHostClient))
	if (fixtureServer) {
		const sourceHash = new Bun.CryptoHasher("sha256").update(await Bun.file(fixture).arrayBuffer()).digest("hex")
		const config = validateConfig(await Bun.file(`${fixture}.json`).json())
		await view.evaluate(pageScript(installFixtureVoice, sourceHash, fixtureServer.url.href, config))
		const speech = await view.evaluate<FixtureSpeechResult>(pageScript(speakThroughFixtureHost))
		// Reset only the fixture flag to prove both directions of persistence.
		await view.evaluate("chrome.storage.session.remove('speechGpuFailed')")
		const policy = await view.evaluate<{ storageUnavailable: boolean; before: boolean; after: boolean }>(
			"chrome.runtime.sendMessage({type:'probe-offscreen-policy'})",
		)
		assert(
			speech.ok && speech.samples > 0 && speech.words > 0,
			`Actual offscreen speech failed: ${JSON.stringify({ speech, policy })}`,
		)
		assert(
			policy.storageUnavailable && policy.before === true && policy.after === false,
			`Offscreen policy persistence failed: ${JSON.stringify(policy)}`,
		)
		console.log(
			"Actual English offscreen load/synthesis and broker-owned GPU policy passed:",
			JSON.stringify({ speech, policy }),
		)
	}
	await Bun.sleep(retentionMs + leaseMs + 250)
	assert((await hostTarget())?.targetId === initial.targetId, "Open/paused client lost its speech host")
	assert(await view.evaluate<boolean>(pageScript(clientConnected)), "Idle host disconnected its open/paused client")
	console.log("An open/paused client retained the host beyond its idle timeout.")
	await view.evaluate<boolean>(pageScript(disconnectHostClient))
	await waitClosed()
	console.log("The offscreen document closed after its final client disconnected.")

	await view.evaluate<boolean>(pageScript(prepareHost))
	const reopened = await waitFor(hostTarget, Boolean, 15)
	assert(reopened && reopened.targetId !== initial.targetId, "A fresh host was not created after idle closure")
	await view.evaluate<boolean>(pageScript(connectHostClient))
	await view.evaluate<boolean>(pageScript(disconnectHostClient))
	// Reserve just before expiration, then deliberately leave the connect gap
	// extending beyond the old disconnect deadline. Closure must lose the race.
	await Bun.sleep(Math.max(0, retentionMs - leaseMs / 2))
	await view.evaluate<boolean>(pageScript(prepareHost))
	await Bun.sleep(leaseMs * 0.75)
	assert((await hostTarget())?.targetId === reopened.targetId, "Idle closure beat a reserved preparation")
	await view.evaluate<boolean>(pageScript(connectHostClient))
	assert(
		await view.evaluate<boolean>(pageScript(clientConnected)),
		"The delayed client did not connect after the preparation lease",
	)
	console.log("A reserved preparation protected the delayed client connection across the idle deadline.")
	await view.evaluate<boolean>(pageScript(disconnectHostClient))
	await waitClosed()

	await view.evaluate<boolean>(pageScript(prepareHost))
	await waitFor(hostTarget, Boolean, 15)
	await waitFor(hostTarget, (target) => !target, leaseMs / 1000 + 15)
	console.log("An unused preparation lease expired and its empty document closed.")
	await Bun.write(
		`${projectRoot}/.cache/evidence/host-lifecycle.json`,
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
				actualSpeechAndPolicy: withSpeech,
				limits: `Real production broker and offscreen lifetime implementation, synthetic player-owned port${withSpeech ? ", cached English model and real PCM" : ", no voice model"}, no audio playback. Default deadlines are shortened in a copied test bundle; this does not measure actual two-minute retention or Chrome 140–149 behavior.`,
			},
			null,
			2,
		) + "\n",
	)
} finally {
	await closeChromeProbe(view)
	fixtureServer?.stop(true)
}
