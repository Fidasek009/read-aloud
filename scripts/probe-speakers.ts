import {
	chromeExtensionId,
	closeChromeProbe,
	copyProbeExtension,
	createChromeProbe,
	projectRoot,
} from "./probe-helpers.ts"

const extension = `${projectRoot}/.cache/speaker-probe`
await copyProbeExtension("chrome", extension)
const build = await Bun.build({
	entrypoints: [`${projectRoot}/scripts/check-speakers.ts`],
	outdir: extension,
	naming: "check-speakers.js",
	target: "browser",
	format: "esm",
})
if (!build.success) throw new AggregateError(build.logs, "Speaker fixture failed to bundle")
const model = Bun.file(`${projectRoot}/.cache/speaker-fixture/model.onnx`)
const config = Bun.file(`${projectRoot}/.cache/speaker-fixture/config.json`)
if (!(await model.exists()) || !(await config.exists()))
	throw new Error("Provision the pinned multispeaker fixture first")
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch: (request) =>
		new Response(new URL(request.url).pathname === "/config" ? config : model, {
			headers: { "Access-Control-Allow-Origin": "*", "Cross-Origin-Resource-Policy": "cross-origin" },
		}),
})
const view = await createChromeProbe(extension)
try {
	await view.navigate(`chrome-extension://${chromeExtensionId(extension)}/voices.html`)
	const result = await view.cdp<{ result: { value: unknown }; exceptionDetails?: { text: string } }>(
		"Runtime.evaluate",
		{
			expression: `import(chrome.runtime.getURL('check-speakers.js')).then(m=>m.checkSpeakers(${JSON.stringify(server.url.href)}))`,
			awaitPromise: true,
			returnByValue: true,
		},
	)
	if (result.exceptionDetails) throw new Error(result.exceptionDetails.text)
	console.log("Two real speakers, one loaded model:", JSON.stringify(result.result.value))
	await Bun.write(
		`${projectRoot}/docs/evidence/speaker-switch-2026-11-02.json`,
		JSON.stringify(
			{
				recordedAt: new Date().toISOString(),
				browser: await view.cdp("Browser.getVersion"),
				voice: "en_GB-aru-medium",
				result: result.result.value,
				limits:
					"Development VM, CPU fallback, isolated extension page and cached pinned model. Model noise is disabled and the first speaker is repeated to verify reproducibility. Does not establish audible quality, GPU behavior, Firefox compatibility, or target-device latency.",
			},
			null,
			2,
		) + "\n",
	)
} finally {
	await closeChromeProbe(view)
	server.stop(true)
}
