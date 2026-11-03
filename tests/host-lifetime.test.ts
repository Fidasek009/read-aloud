import { expect, test } from "bun:test"

import { SPEECH_HOST_LEASE_MS, SPEECH_HOST_RETENTION_MS, SpeechHostLifetime } from "../src/speech/host-lifetime.ts"

test("an open or paused client holds the speech host beyond model retention", () => {
	const lifetime = new SpeechHostLifetime()
	expect(lifetime.connect("reader")).toBe(true)
	expect(lifetime.closeDelay(10 * SPEECH_HOST_RETENTION_MS)).toBeUndefined()
	expect(lifetime.claimClose(10 * SPEECH_HOST_RETENTION_MS)).toBe(false)
})

test("retention begins after the last real disconnect, not an older client's duplicate event", () => {
	const lifetime = new SpeechHostLifetime()
	lifetime.connect("first")
	lifetime.connect("second")
	lifetime.disconnect("first", 20)
	expect(lifetime.closeDelay(30)).toBeUndefined()
	lifetime.disconnect("second", 100)
	lifetime.disconnect("first", 200)
	expect(lifetime.closeDelay(200)).toBe(SPEECH_HOST_RETENTION_MS - 100)
	expect(lifetime.claimClose(100 + SPEECH_HOST_RETENTION_MS)).toBe(true)
})

test("a preparation lease protects the asynchronous gap before the client port connects", () => {
	const lifetime = new SpeechHostLifetime()
	lifetime.connect("old")
	lifetime.disconnect("old", 0)
	const now = SPEECH_HOST_RETENTION_MS
	expect(lifetime.reserve(now)).toBe(true)
	expect(lifetime.claimClose(now)).toBe(false)
	expect(lifetime.closeDelay(now)).toBe(SPEECH_HOST_LEASE_MS)
	lifetime.connect("new")
	expect(lifetime.claimClose(now + SPEECH_HOST_LEASE_MS)).toBe(false)
})

test("one connection does not consume another pending reader's preparation lease", () => {
	const lifetime = new SpeechHostLifetime()
	lifetime.reserve(100)
	lifetime.reserve(200)
	lifetime.connect("first")
	lifetime.disconnect("first", 300)
	// Post-disconnect retention is longer than the outstanding lease.
	expect(lifetime.closeDelay(300)).toBe(SPEECH_HOST_RETENTION_MS)
	expect(lifetime.connect("second")).toBe(true)
	expect(lifetime.closeDelay(300 + SPEECH_HOST_RETENTION_MS)).toBeUndefined()
})

test("an unused preparation expires and a claimed close rejects late connections", () => {
	const lifetime = new SpeechHostLifetime()
	lifetime.reserve(10)
	expect(lifetime.claimClose(10 + SPEECH_HOST_LEASE_MS)).toBe(true)
	expect(lifetime.reserve(20 + SPEECH_HOST_LEASE_MS)).toBe(false)
	expect(lifetime.connect("late")).toBe(false)
	expect(lifetime.claimClose(20 + SPEECH_HOST_LEASE_MS)).toBe(false)
	// A failed close is rolled back before another preparation acquires the lock.
	lifetime.reopen()
	expect(lifetime.reserve(20 + SPEECH_HOST_LEASE_MS)).toBe(true)
	expect(lifetime.connect("retry")).toBe(true)
})
