import { createEspeak } from "@spelling-creator/spellophone/browser"
import { expect, test } from "bun:test"

import { speechDataFetch } from "../src/speech/data-fetch"

test("English and Czech phonemization work when only the renamed inventory is served", async () => {
	const upstream = new URL("../node_modules/@spelling-creator/spellophone/", import.meta.url)
	const requests: string[] = []
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			const name = new URL(request.url).pathname.slice(1)
			requests.push(name)
			if (!["data-index.json", "core.bin.gz", "en_dict.gz", "cs_dict.gz"].includes(name))
				return new Response(null, { status: 404 })
			return new Response(
				Bun.file(new URL(`espeak-ng-data/${name === "data-index.json" ? "manifest.json" : name}`, upstream)),
			)
		},
	})
	let engine: Awaited<ReturnType<typeof createEspeak>> | undefined
	try {
		engine = await createEspeak({
			dataUrl: server.url,
			fetch: speechDataFetch(server.url),
			wasmUrl: new URL("wasm/espeak-ng.wasm", upstream),
			phonemeEvents: "ipa",
		})
		for (const [voice, text] of [
			["en-us", "Read this page aloud."],
			["cs", "Přečti tuto stránku nahlas."],
		]) {
			await engine.loadVoice(voice!)
			const result = engine.synthesize(text!)
			expect(result.events.some((event) => event.type === "phoneme")).toBe(true)
		}
		expect(requests).toContain("data-index.json")
		expect(requests).toContain("cs_dict.gz")
		expect(requests).not.toContain("manifest.json")
	} finally {
		engine?.dispose()
		await server.stop(true)
	}
})
