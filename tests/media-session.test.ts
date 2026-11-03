import { expect, test } from "bun:test"

import { bindMediaSession } from "../src/playback/media-session.ts"

test("media controls route sentence navigation and release handlers on close", () => {
	const handlers = new Map<MediaSessionAction, MediaSessionActionHandler | null>()
	const session = {
		playbackState: "none",
		setActionHandler(action: MediaSessionAction, handler: MediaSessionActionHandler | null) {
			handlers.set(action, handler)
		},
	} as MediaSession
	const calls: string[] = []
	const controls = bindMediaSession(session, {
		play: () => calls.push("play"),
		pause: () => calls.push("pause"),
		previoustrack: () => calls.push("previous sentence"),
		nexttrack: () => calls.push("next sentence"),
		stop: () => calls.push("close"),
	})
	for (const [action, handler] of handlers) handler?.({ action })
	expect(calls).toEqual(["play", "pause", "previous sentence", "next sentence", "close"])
	controls.update("playing")
	expect(session.playbackState).toBe("playing")
	controls.update("paused")
	expect(session.playbackState).toBe("paused")
	controls.dispose()
	expect(session.playbackState).toBe("none")
	expect([...handlers.values()].every((handler) => handler === null)).toBe(true)
})

test("unsupported actions do not prevent registering other media controls", () => {
	const registered: string[] = []
	const session = {
		setActionHandler(action: MediaSessionAction) {
			if (action === "stop") throw new DOMException("Unsupported action", "NotSupportedError")
			registered.push(action)
		},
	} as unknown as MediaSession
	const noop = () => {}
	const actions = { stop: noop, play: noop, pause: noop, previoustrack: noop, nexttrack: noop }
	const controls = bindMediaSession(session, actions)
	expect(registered).toEqual(["play", "pause", "previoustrack", "nexttrack"])
	controls.dispose()
	expect(() => bindMediaSession(undefined, actions).dispose()).not.toThrow()
})
