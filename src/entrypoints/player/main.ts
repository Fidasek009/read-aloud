import { browser } from "wxt/browser"

import { readingChunks, sentenceTarget } from "../../reading/document.ts"
import { parentReaderHost } from "../../reading/host.ts"
import { voiceChoice, voices } from "../../speech/catalog.ts"
import { SpeechClient } from "../../speech/client.ts"
import { type SpeechClip } from "../../speech/protocol.ts"
import { installedVoices, onVoicesChanged } from "../../speech/vault.ts"
import "./style.css"

const session = location.hash.slice(1)
const host = parentReaderHost()
const send = (command: string, payload: object = {}) =>
	host
		? host({ session, command, ...payload })
		: browser.runtime.sendMessage({ type: "reader", session, command, ...payload })
const button = (id: string) => document.querySelector<HTMLButtonElement>(`#${id}`)!
const play = button("play"),
	previous = button("previous"),
	next = button("next")
const speed = document.querySelector<HTMLInputElement>("#speed")!
const rate = document.querySelector<HTMLSpanElement>("#rate")!
const voiceSelect = document.querySelector<HTMLSelectElement>("#voice")!
const status = document.querySelector<HTMLSpanElement>("#status")!
const engine = new SpeechClient()
const context = new AudioContext()
let text = "",
	chunks = readingChunks(""),
	cursor = 0,
	epoch = 0,
	paused = false,
	awaitingGesture = false
let active: { source: AudioBufferSourceNode; started: number; clip: SpeechClip; offset: number } | undefined
let queue: { clip: SpeechClip; offset: number; index: number }[] = []
let generating = false,
	ended = false,
	lastWord = -1
let began = performance.now(),
	firstBuffer = true

function updateControls() {
	document.querySelector("#play-icon")!.setAttribute("d", paused || ended ? "m8 5 11 7-11 7z" : "M8 5v14M16 5v14")
	play.setAttribute("aria-label", paused || ended ? "Play" : "Pause")
	play.title = paused || ended ? "Play" : "Pause"
	play.setAttribute("aria-pressed", String(!paused && !ended))
	previous.disabled = cursor <= 0
	next.disabled = sentenceTarget(chunks, cursor, 1) < 0
}

function halt() {
	epoch++
	engine.cancelQueued()
	if (active) {
		active.source.onended = null
		active.source.stop()
		active = undefined
	}
	queue = []
	lastWord = -1
	void send("highlight", { start: 0, end: 0 }).catch(() => {})
}

async function begin(index: number, offset?: number) {
	halt()
	began = performance.now()
	firstBuffer = true
	const current = epoch
	cursor = Math.min(Math.max(0, index), chunks.length - 1)
	const selectedChunk = chunks[cursor]
	const resumeOffset =
		selectedChunk && offset !== undefined && offset >= selectedChunk.start && offset < selectedChunk.end
			? offset
			: undefined
	ended = false
	status.textContent = "Preparing voice on your device…"
	updateControls()
	try {
		await engine.load(voiceSelect.value)
		if (current !== epoch) return
		generating = false
		void fill(current, resumeOffset)
	} catch (error) {
		if (current === epoch) fail(error)
	}
}

function fail(error: unknown) {
	halt()
	engine.dispose()
	status.textContent = error instanceof Error ? error.message : "Reading could not continue."
	paused = true
	updateControls()
}

async function fill(current: number, firstOffset?: number) {
	if (generating || current !== epoch) return
	generating = true
	try {
		while (current === epoch && queue.length < 2) {
			const index = active ? cursor + queue.length + 1 : cursor + queue.length
			const chunk = chunks[index]
			if (!chunk) break
			const offset = index === cursor && firstOffset !== undefined ? firstOffset : chunk.start
			const clip = await engine.synthesize(text.slice(offset, chunk.end), Number(speed.value))
			if (current !== epoch) return
			queue.push({ clip, offset, index })
			if (!active) startNext(current)
		}
	} catch (error) {
		if (current === epoch) fail(error)
	} finally {
		if (current === epoch) generating = false
	}
}

function startNext(current: number) {
	if (current !== epoch || active) return
	const item = queue.shift()
	if (!item) return
	cursor = item.index
	const buffer = context.createBuffer(1, item.clip.pcm.length, item.clip.sampleRate)
	buffer.copyToChannel(item.clip.pcm, 0)
	const source = context.createBufferSource()
	source.buffer = buffer
	source.connect(context.destination)
	active = { source, started: context.currentTime, clip: item.clip, offset: item.offset }
	if (firstBuffer) {
		firstBuffer = false
		void browser.storage.local.set({
			lastSpeechPerformance: {
				...engine.diagnostics,
				timeToFirstBufferMs: performance.now() - began,
				audioContextState: context.state,
				recordedAt: new Date().toISOString(),
			},
		})
	}
	source.onended = () => {
		if (current !== epoch) return
		active = undefined
		cursor++
		if (cursor >= chunks.length) {
			ended = true
			status.textContent = "Finished"
			updateControls()
			void send("highlight", { start: 0, end: 0 })
			return
		}
		startNext(current)
		void fill(current)
	}
	source.start()
	if (!paused && context.state !== "running") {
		if (navigator.userActivation.hasBeenActive) void context.resume().catch(fail)
		else {
			paused = true
			awaitingGesture = true
		}
	}
	status.textContent = awaitingGesture ? "Press Play to start listening." : paused ? "Paused" : "Reading on your device"
	updateControls()
}

function highlight() {
	if (active && !paused && context.state === "running") {
		const seconds = context.currentTime - active.started
		const word = active.clip.words.find((word) => seconds >= word.from && seconds < word.to)
		if (word && active.offset + word.start !== lastWord) {
			lastWord = active.offset + word.start
			void send("highlight", { start: lastWord, end: active.offset + word.end }).catch(() => {})
		}
	}
	requestAnimationFrame(highlight)
}

play.onclick = async () => {
	awaitingGesture = false
	try {
		if (ended) {
			paused = false
			await context.resume()
			void begin(0)
			return
		}
		paused = !paused
		if (paused) await context.suspend()
		else await context.resume()
		if (!paused && !active && !generating) void begin(Math.min(cursor, chunks.length - 1))
		status.textContent = paused ? "Paused" : active ? "Reading on your device" : "Preparing voice on your device…"
		updateControls()
	} catch (error) {
		fail(error)
	}
}
previous.onclick = () => void begin(Math.max(0, sentenceTarget(chunks, cursor, -1)))
next.onclick = () => {
	const index = sentenceTarget(chunks, cursor, 1)
	if (index >= 0) void begin(index)
}
button("close").onclick = () => {
	halt()
	engine.dispose()
	void context.close()
	void send("close")
}
speed.oninput = () => {
	rate.textContent = `${Number(speed.value)}×`
	speed.setAttribute("aria-valuetext", `${Number(speed.value)} times normal speed`)
}
speed.onchange = () => {
	void browser.storage.local.set({ speed: Number(speed.value) })
	void begin(Math.min(cursor, chunks.length - 1), lastWord < 0 ? undefined : lastWord)
}
voiceSelect.onchange = () => {
	void browser.storage.local.set({ voice: voiceSelect.value })
	void begin(Math.min(cursor, chunks.length - 1))
}

async function refreshVoices() {
	const installed = new Set(await installedVoices())
	const preferences = await browser.storage.local.get(["voice", "speed"])
	voiceSelect.replaceChildren()
	for (const voice of voices.filter((voice) => installed.has(voice.id))) {
		const group = document.createElement("optgroup")
		group.label = `${voice.name} · ${voice.quality.replace("x_low", "extra low")} · ${voice.language}`
		const names = new Map(Object.entries(voice.speakerNames ?? {}).map(([name, id]) => [id, name]))
		for (let speaker = 0; speaker < voice.speakers; speaker++) {
			const option = document.createElement("option")
			option.value = speaker ? `${voice.id}#${speaker}` : voice.id
			option.textContent =
				voice.speakers > 1 ? `${voice.name} · ${names.get(speaker) ?? `Speaker ${speaker + 1}`}` : group.label
			group.append(option)
		}
		voiceSelect.append(group)
	}
	if (typeof preferences.voice === "string" && installed.has(preferences.voice.split("#")[0]!))
		voiceSelect.value = preferences.voice
	return installed.size > 0
}

onVoicesChanged(async (id, deleted) => {
	if (deleted && id === voiceSelect.value.split("#")[0]) {
		halt()
		engine.dispose()
		paused = true
		status.textContent = "This voice was deleted. Choose a downloaded voice."
		updateControls()
	}
	if (await refreshVoices()) {
		play.disabled = false
		updateControls()
	}
})
browser.runtime.onMessage.addListener((message: unknown, sender) => {
	if (
		sender.id === browser.runtime.id &&
		!sender.tab &&
		message &&
		typeof message === "object" &&
		"type" in message &&
		message.type === "reset-reader" &&
		"session" in message &&
		message.session === session
	) {
		halt()
		void initialize().catch(fail)
		return Promise.resolve({ ok: true })
	}
})
window.addEventListener("pagehide", () => {
	halt()
	engine.dispose()
	void context.close()
})
new ResizeObserver(() => {
	void send("resize", { height: Math.ceil(document.querySelector("#bar")!.getBoundingClientRect().height) }).catch(
		() => {},
	)
}).observe(document.querySelector("#bar")!)
window.addEventListener("keydown", (event) => {
	if (event.key === "Escape") button("close").click()
})

async function initialize() {
	const source: unknown = await send("document")
	if (
		!source ||
		typeof source !== "object" ||
		!("text" in source) ||
		typeof source.text !== "string" ||
		!source.text.trim()
	)
		throw new Error("Start reading from a page or a text selection.")
	text = source.text
	const available = await refreshVoices()
	const preferences = await browser.storage.local.get("speed")
	if (typeof preferences.speed === "number" && preferences.speed >= 0.5 && preferences.speed <= 2)
		speed.value = String(preferences.speed)
	rate.textContent = `${Number(speed.value)}×`
	chunks = readingChunks(text, available ? voiceChoice(voiceSelect.value).voice.locale : "en")
	if (!available) {
		paused = true
		play.disabled = true
		previous.disabled = true
		next.disabled = true
		status.textContent = "Download a voice to start listening."
		return
	}
	await begin(0)
}
requestAnimationFrame(highlight)
void initialize().catch(fail)
window.addEventListener("read-aloud-source-changed", () => {
	halt()
	void initialize().catch(fail)
})
