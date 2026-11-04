import { expect, test } from "bun:test"

import { isExtensionBackgroundSender, isExtensionPageSender } from "../src/extension/sender.ts"

const id = "read-aloud@example.invalid"
const root = "moz-extension://generated-id/"
const player = { id, url: `${root}player.html#session`, tab: { id: 7 } }

test("extension page senders match browser identity, protocol, host and an allowed path", () => {
	expect(isExtensionPageSender(player, id, root, ["/player.html"])).toBe(true)
	expect(
		isExtensionPageSender({ ...player, url: "chrome-extension://generated-id/player.html" }, id, root, [
			"/player.html",
		]),
	).toBe(false)
	expect(isExtensionPageSender({ ...player, id: "another-extension" }, id, root, ["/player.html"])).toBe(false)
	expect(
		isExtensionPageSender({ ...player, url: "moz-extension://generated-id.attacker/player.html" }, id, root, [
			"/player.html",
		]),
	).toBe(false)
	expect(isExtensionPageSender({ ...player, url: `${root}voices.html` }, id, root, ["/player.html"])).toBe(false)
	expect(
		isExtensionPageSender({ ...player, url: "https://generated-id/player.html" }, id, root, ["/player.html"]),
	).toBe(false)
})

test("invalid or absent sender URLs fail without throwing", () => {
	expect(isExtensionPageSender(undefined, id, root, ["/player.html"])).toBe(false)
	expect(isExtensionPageSender({ id }, id, root, ["/player.html"])).toBe(false)
	expect(isExtensionPageSender({ id, url: "not a URL" }, id, root, ["/player.html"])).toBe(false)
	expect(isExtensionPageSender(player, id, "not a URL", ["/player.html"])).toBe(false)
})

test("background messages allow absent URL only with the extension identity and no source tab", () => {
	expect(isExtensionBackgroundSender({ id }, id, root)).toBe(true)
	expect(isExtensionBackgroundSender({ id, url: `${root}background.js` }, id, root)).toBe(true)
	expect(isExtensionBackgroundSender({ id, url: `${root}_generated_background_page.html` }, id, root)).toBe(true)
	expect(isExtensionBackgroundSender({ id, tab: { id: 7 } }, id, root)).toBe(false)
	expect(isExtensionBackgroundSender(player, id, root)).toBe(false)
	expect(isExtensionBackgroundSender({ id: "another-extension" }, id, root)).toBe(false)
	expect(isExtensionBackgroundSender({ id, url: "not a URL" }, id, root)).toBe(false)
})
