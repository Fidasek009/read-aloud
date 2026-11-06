import { $ } from "bun"

import { getVoice } from "../src/speech/catalog.ts"
import { observePlayerAudio } from "./check-player-controls.ts"
import { assert, copyProbeExtension, projectRoot } from "./probe-helpers.ts"

/** Fixtures select text through the DOM, then invoke the browser-owned menu. */
export async function nativeEntryFixture(browser: "chrome" | "firefox") {
	const voice = getVoice(
		Bun.env.NATIVE_ENTRY_VOICE ?? (browser === "chrome" ? "en_US-ljspeech-medium" : "cs_CZ-kasandra-medium"),
	)
	const text = voice.locale.startsWith("cs")
		? "Dobrý den. Čtení běží přímo ve vašem počítači a váš text zůstává v soukromí. Přirozený hlas přečte pouze vybraný text."
		: "Your text stays on your device. Natural speech makes reading effortless. A second sentence keeps the selected passage playing while we verify its scope."
	const extension = `${projectRoot}/.cache/native-entry/${browser}-${crypto.randomUUID()}`
	await copyProbeExtension(browser, extension)
	await observePlayerAudio(extension)
	const manifest = await Bun.file(`${extension}/manifest.json`).json()
	assert(!manifest.host_permissions?.length, "Native entry must use activeTab without a fixture origin grant")
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () =>
			new Response(
				`<!doctype html><title>Native entry fixture</title><main><p id="selection">${text}</p><p>THIS MUST NOT BE READ.</p></main>`,
				{ headers: { "Content-Type": "text/html;charset=utf-8" } },
			),
	})
	return {
		voice,
		text,
		extension,
		manifest,
		server,
		async record(browserVersion: string, time: number) {
			assert(time > 0, "Native audio clock did not advance")
			const evidence = {
				checkedAt: new Date().toISOString(),
				browser,
				browserVersion,
				voice: voice.id,
				manifestSha256: new Bun.CryptoHasher("sha256")
					.update(await Bun.file(`${extension}/manifest.json`).arrayBuffer())
					.digest("hex"),
				permanentHostPermissions: manifest.host_permissions ?? [],
				method:
					"Fresh isolated profile; production Download control; DOM text selection; real browser-owned Read selection menu; no simulated menu listener, pre-granted source origin, autoplay override or second Play click. Only native audio/error observation added to a copied package.",
				checks: {
					automaticPlayback: true,
					audioClockSeconds: time,
					exactSelectionScope: true,
					uncaughtPlayerScriptErrors: 0,
				},
				limitations:
					"Linux VM and virtual audio sink; not physical listening-quality, Windows or target-device latency acceptance.",
			}
			await Bun.write(
				`${projectRoot}/.cache/evidence/native-entry-${browser}-${voice.id}.json`,
				`${JSON.stringify(evidence, null, "\t")}\n`,
			)
		},
		async close() {
			server.stop(true)
			await $`rm -rf ${extension}`.quiet()
		},
	}
}

/** Serialized into the player solely to observe real Audio elements. */
export function nativeEntryState() {
	const probe = window as unknown as Window & { __probeAudio: { elements: HTMLAudioElement[] } }
	const error = document.documentElement.dataset.probeError ?? document.documentElement.dataset.probeRejection
	if (error) throw new Error(error)
	const status = document.querySelector("#status")?.textContent
	if (status === "Press Play to start listening.") throw new Error("Native menu entry requires a second Play gesture")
	return {
		status,
		time: Math.max(
			0,
			...probe.__probeAudio.elements.filter((audio) => !audio.paused).map((audio) => audio.currentTime),
		),
	}
}
