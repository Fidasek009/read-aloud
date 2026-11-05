import { chromeExtensionId, closeChromeProbe, createChromeProbe, projectRoot, waitFor } from "./probe-helpers"

// Original vector artwork + browser-rendered PNGs. No model, preview or page text
// is downloaded. Product screenshots capture the unmodified extension UI.
const logo = await Bun.file(`${projectRoot}/assets/brand/read-aloud.svg`).text()
const page = (body: string, style = "") =>
	`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}body{font-family:Arial,sans-serif}${style}</style>${body}`
let html = ""
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch: () => new Response(html, { headers: { "Content-Type": "text/html" } }),
})
const extension = `${projectRoot}/.output/chrome-mv3`
const view = await createChromeProbe(extension, ["--headless=new", "--no-sandbox"])
async function screenshot(path: string, width: number, height: number, transparent = false) {
	await view.cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false })
	await view.cdp("Emulation.setDefaultBackgroundColorOverride", {
		color: { r: 255, g: 255, b: 255, a: transparent ? 0 : 1 },
	})
	const shot = await view.cdp<{ data: string }>("Page.captureScreenshot", {
		format: "png",
		captureBeyondViewport: false,
	})
	await Bun.write(`${projectRoot}/${path}`, Uint8Array.fromBase64(shot.data))
}
try {
	for (const size of [16, 32, 48, 64, 96, 128]) {
		html = page(logo, "svg{display:block;width:100%;height:100%}")
		await view.navigate(server.url.href)
		await screenshot(`public/icons/icon-${size}.png`, size, size, true)
	}
	await Bun.write(`${projectRoot}/store/assets/icon-128.png`, Bun.file(`${projectRoot}/public/icons/icon-128.png`))
	for (const [width, height, file] of [
		[440, 280, "promo-small.png"],
		[1400, 560, "promo-marquee.png"],
	] as const) {
		const large = width > 500
		html = page(
			`<div class="brand">${logo}<b>Read Aloud</b></div><div class="copy"><span>ON-DEVICE READING</span><h1>Your page.<br>Your pace.</h1><p>Listen in Chrome &amp; Firefox.</p></div><div class="rings"></div>`,
			`body{background:#10283f;color:#fff;padding:${large ? "40px 72px" : "18px 26px"}}.brand{display:flex;align-items:center;gap:8px;position:relative;z-index:2;font-size:${large ? 24 : 17}px}.brand svg{width:${large ? 64 : 40}px;height:${large ? 64 : 40}px;margin-left:-8px}.copy{position:relative;z-index:2;margin-top:${large ? 32 : 17}px}.copy span{font-size:${large ? 13 : 9}px;letter-spacing:2.6px;color:#89d7cf}h1{font-size:${large ? 100 : 43}px;letter-spacing:${large ? -4 : -1.8}px;line-height:1.02;margin:${large ? 18 : 12}px 0;font-weight:700}p{font-size:${large ? 19 : 12}px;color:#c2d3e1;margin:14px 0}.rings{position:absolute;width:${large ? 630 : 230}px;height:${large ? 630 : 230}px;border:1px solid #275466;border-radius:50%;right:${large ? -60 : -130}px;top:${large ? 25 : 70}px;box-shadow:0 0 0 ${large ? 70 : 28}px #17384c,0 0 0 ${large ? 140 : 56}px #143247}.rings:after{content:'';position:absolute;inset:30%;border-radius:50%;background:#61e5cd}`,
		)
		await view.navigate(server.url.href)
		await screenshot(`store/assets/${file}`, width, height)
	}
	if (!process.argv.includes("--brand-only")) {
		await view.cdp("Emulation.setDeviceMetricsOverride", {
			width: 1280,
			height: 800,
			deviceScaleFactor: 1,
			mobile: false,
		})
		await view.cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] })
		await view.navigate(`chrome-extension://${chromeExtensionId(extension)}/voices.html`)
		await waitFor(
			() => view.evaluate<number>("document.querySelectorAll('#voices section').length"),
			(count) => count > 0,
		)
		for (const [language, file] of [
			["en-US", "voices-english.png"],
			["cs-CZ", "voices-czech.png"],
		]) {
			await view.evaluate(
				`(() => { const filter = document.querySelector('#language'); filter.value=${JSON.stringify(language)}; filter.dispatchEvent(new Event('change')); return true })()`,
			)
			await view.evaluate("document.fonts.ready.then(() => true)")
			await screenshot(`store/assets/${file}`, 1280, 800)
		}
		console.log("Captured actual voice management UI; no voices or samples downloaded.")
	}
} finally {
	await closeChromeProbe(view)
	await server.stop(true)
}
