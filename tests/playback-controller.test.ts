import { expect, test } from "bun:test"

import type { PlaybackAudio } from "../src/playback/audio.ts"
import type { SpeechClip } from "../src/speech/protocol.ts"

import { PlaybackController, type PlaybackEngine } from "../src/playback/controller.ts"
import { speechFailure } from "../src/speech/errors.ts"

const clip: SpeechClip = {
	pcm: new Float32Array([0, 0.5]),
	sampleRate: 22050,
	words: [{ start: 0, end: 5, from: 0, to: 1 }],
}
function deferred<T>() {
	let resolve!: (value: T) => void, reject!: (error: unknown) => void
	const promise = new Promise<T>((yes, no) => {
		resolve = yes
		reject = no
	})
	return { promise, resolve, reject }
}
async function settle() {
	for (let i = 0; i < 20; i++) await Promise.resolve()
}
class FakeAudio implements PlaybackAudio {
	paused = true
	currentTime = 0
	volume = 1
	disposed = false
	plays = 0
	onended: (() => void) | null = null
	onerror: (() => void) | null = null
	onplaying: (() => void) | null = null
	async play() {
		this.plays++
		this.paused = false
		this.onplaying?.()
	}
	pause() {
		this.paused = true
	}
	dispose() {
		this.disposed = true
		this.pause()
	}
	end() {
		this.onended?.()
	}
}
function fixture(options: { load?: () => Promise<void>; synthesize?: (text: string) => Promise<SpeechClip> } = {}) {
	const inputs: string[] = [],
		audios: FakeAudio[] = [],
		highlights: number[][] = [],
		buffers: number[] = [],
		audioTimes: number[] = []
	let now = 0,
		disposals = 0
	const engine: PlaybackEngine = {
		diagnostics: { backend: "cpu" },
		load: options.load ?? (async () => {}),
		synthesize: async (text) => {
			inputs.push(text)
			return options.synthesize ? options.synthesize(text) : clip
		},
		cancelQueued() {},
		dispose() {
			disposals++
		},
	}
	const controller = new PlaybackController(
		engine,
		() => {
			const output = new FakeAudio()
			audios.push(output)
			return output
		},
		{
			change() {},
			highlight: (start, end) => highlights.push([start, end]),
			firstBuffer: (_, elapsed) => buffers.push(elapsed),
			firstAudio: (_, elapsed) => audioTimes.push(elapsed),
		},
		() => now,
	)
	return {
		controller,
		inputs,
		audios,
		highlights,
		buffers,
		audioTimes,
		advance: (ms: number) => {
			now += ms
		},
		disposals: () => disposals,
	}
}
const scope = "First sentence. Second sentence. Third sentence. Fourth sentence."

test("pause during preparation owns the first buffer; media play resumes once", async () => {
	const loading = deferred<void>()
	const f = fixture({ load: () => loading.promise })
	const start = f.controller.setScope(scope, "voice", "en", 1)
	f.controller.pause()
	loading.resolve()
	await start
	await settle()
	expect(f.audios[0]!.paused).toBe(true)
	expect(f.controller.state).toEqual({ kind: "ready", intent: "pause" })
	f.controller.mediaPlay()
	await settle()
	expect(f.controller.playing).toBe(true)
	f.controller.mediaPlay()
	await settle()
	expect(f.audios[0]!.plays).toBe(1)
})

test("closing during synthesis prevents late audio and releases queued outputs", async () => {
	const synthesis = deferred<SpeechClip>()
	const f = fixture({ synthesize: () => synthesis.promise })
	await f.controller.setScope(scope, "voice", "en", 1)
	f.controller.close()
	synthesis.resolve(clip)
	await settle()
	expect(f.audios).toHaveLength(0)
	expect(f.controller.state.kind).toBe("closed")
	expect(f.disposals()).toBe(1)
})

test("a new selection replaces the scope and its sentence navigation", async () => {
	const f = fixture()
	await f.controller.setScope(scope, "voice", "en", 1)
	await settle()
	f.controller.pause()
	const oldAudio = f.audios[0]!
	await f.controller.play(async () => "Only this sentence.")
	await settle()
	expect(oldAudio.disposed).toBe(true)
	expect(f.inputs.at(-1)).toBe("Only this sentence.")
	expect(f.controller.canNext).toBe(false)
	f.audios.at(-1)!.end()
	await settle()
	expect(f.controller.state.kind).toBe("ended")
})

test("closing while a selection request is pending cannot replace a scope", async () => {
	const f = fixture(),
		selection = deferred<string | null>()
	await f.controller.setScope(scope, "voice", "en", 1)
	await settle()
	f.controller.pause()
	const pending = f.controller.play(() => selection.promise)
	f.controller.close()
	selection.resolve("Must not play.")
	await pending
	await settle()
	expect(f.inputs).not.toContain("Must not play.")
	expect(f.controller.closed).toBe(true)
})

test("shared-model cancellation pauses without a failure or disposing the client", async () => {
	const f = fixture({
		synthesize: async () => {
			throw speechFailure("cancelled")
		},
	})
	await f.controller.setScope(scope, "voice", "en", 1)
	await settle()
	expect(f.controller.state).toEqual({ kind: "ready", intent: "pause" })
	expect(f.disposals()).toBe(0)
})

test("a failed passage recovers when Play supplies a new selection", async () => {
	let reject = true
	const f = fixture({
		synthesize: async () => {
			if (reject) throw speechFailure("unavailable")
			return clip
		},
	})
	await f.controller.setScope(scope, "voice", "en", 1)
	await settle()
	expect(f.controller.state.kind).toBe("failed")
	reject = false
	await f.controller.play(async () => "Recovered selection.")
	await settle()
	expect(f.controller.playing).toBe(true)
	expect(f.inputs.at(-1)).toBe("Recovered selection.")
})

test("read-ahead advances one sentence and changes volume without restarting audio", async () => {
	const f = fixture()
	await f.controller.setScope(scope, "voice", "en", 1)
	await settle()
	expect(f.audios).toHaveLength(2)
	f.controller.setVolume(50)
	expect(f.audios.map((audio) => audio.volume)).toEqual([0.25, 0.25])
	f.audios[0]!.end()
	await settle()
	expect(f.audios[1]!.plays).toBe(1)
	await f.controller.step(-1)
	await settle()
	expect(f.inputs.at(-3)).toBe("First sentence. ")
})

test("first audio follows native playing readiness and includes pre-load action time", async () => {
	const loading = deferred<void>()
	const f = fixture({ load: () => loading.promise })
	f.advance(150)
	const start = f.controller.setScope("First sentence.", "voice", "en", 1, 0)
	f.advance(500)
	loading.resolve()
	await start
	await settle()
	expect(f.buffers).toEqual([650])
	expect(f.audioTimes).toEqual([650])
	f.controller.updateHighlight()
	expect(f.highlights.at(-1)).toEqual([0, 5])
})
