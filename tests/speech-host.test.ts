import { expect, test } from "bun:test"

import type { SpeechResponse } from "../src/speech/protocol.ts"

import { isSpeechHostReply, speechHostDispatcher } from "../src/speech/host-protocol.ts"
import { type SpeechPort, SpeechPortRegistry } from "../src/speech/port-registry.ts"
import { SpeechService } from "../src/speech/service.ts"

test("host replies require a boolean result", () => {
	expect(isSpeechHostReply({ ok: true })).toBe(true)
	expect(isSpeechHostReply({ ok: false })).toBe(true)
	expect(isSpeechHostReply({ ok: "true" })).toBe(false)
	expect(isSpeechHostReply(undefined)).toBe(false)
})

test("host dispatch validates payloads before invoking the registered handler", async () => {
	const deleted: string[] = []
	const dispatch = speechHostDispatcher({
		"installed-voices": () => ["cs_CZ-jirka-medium"],
		"speech-voice-deleted": ({ id }) => {
			deleted.push(id)
			return { ok: true }
		},
	})
	expect(await dispatch({ type: "installed-voices" })).toEqual(["cs_CZ-jirka-medium"])
	expect(await dispatch({ type: "speech-voice-deleted", id: "cs_CZ-jirka-medium" })).toEqual({ ok: true })
	await expect(dispatch({ type: "speech-voice-deleted", id: 123 })).rejects.toThrow("Invalid speech host command")
	expect(deleted).toEqual(["cs_CZ-jirka-medium"])
	// Another recipient's registered command must not claim runtime replies.
	expect(dispatch({ type: "reserve-speech-host" })).toBeUndefined()
})

function port() {
	let receive: (request: unknown) => void = () => {}
	let closed: () => void = () => {}
	const replies: SpeechResponse[] = []
	let disconnected = false
	const connection: SpeechPort = {
		onMessage: {
			addListener: (listener) => {
				receive = listener
			},
		},
		onDisconnect: {
			addListener: (listener) => {
				closed = listener
			},
		},
		postMessage: (reply) => {
			replies.push(reply)
		},
		disconnect: () => {
			disconnected = true
			closed()
		},
	}
	return {
		connection,
		replies,
		receive: (request: unknown) => receive(request),
		close: () => connection.disconnect(),
		get disconnected() {
			return disconnected
		},
	}
}

function service() {
	let loads = 0,
		cleared = 0,
		disposed = 0
	const speech = new SpeechService({
		diagnostics: {},
		load: async () => {
			loads++
		},
		synthesize: async () => ({ pcm: Float32Array.of(0.1), sampleRate: 22050, words: [] }),
		cancelQueued() {},
		clearClips() {
			cleared++
		},
		dispose() {
			disposed++
		},
	})
	return {
		speech,
		get loads() {
			return loads
		},
		get cleared() {
			return cleared
		},
		get disposed() {
			return disposed
		},
	}
}

test("shared port routing rejects malformed requests and releases each connected client only once", async () => {
	const f = service(),
		p = port()
	let disconnected = 0
	const registry = new SpeechPortRegistry(f.speech, {
		connect: () => true,
		disconnect: () => {
			disconnected++
		},
	})
	registry.connect(p.connection)
	p.receive({ id: 1, type: "load", voice: "en_US-ljspeech-medium" })
	await Bun.sleep(0)
	expect(p.replies).toEqual([{ id: 1, ok: true, diagnostics: {} }])
	expect(f.loads).toBe(1)
	p.receive({ id: 2, type: "synthesize", text: "hello", speed: NaN })
	expect(p.disconnected).toBe(true)
	p.close()
	expect(disconnected).toBe(1)
	expect(f.cleared).toBe(2)
	// Release clears source text but the host's sole idle clock owns disposal.
	expect(f.disposed).toBe(0)
	f.speech.dispose()
	expect(f.disposed).toBe(1)
})

test("a closing host refuses new clients and a closed port cannot receive late replies", async () => {
	const f = service(),
		refused = port()
	new SpeechPortRegistry(f.speech, { connect: () => false, disconnect() {} }).connect(refused.connection)
	expect(refused.disconnected).toBe(true)
	expect(f.loads).toBe(0)
	const p = port()
	const registry = new SpeechPortRegistry(f.speech, { connect: () => true, disconnect() {} })
	registry.connect(p.connection)
	p.receive({ id: 1, type: "load", voice: "en_US-ljspeech-medium" })
	p.close()
	await Bun.sleep(0)
	expect(p.replies).toEqual([])
	f.speech.dispose()
})
