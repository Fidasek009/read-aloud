import { browser } from "wxt/browser"

import { readingChunks, sentenceTarget } from "../../reading/document.ts"
import { isReaderChange, parentReaderHost, type ReaderRequest } from "../../reading/host.ts"
import { languageLabel, voiceChoice, voices } from "../../speech/catalog.ts"
import { SpeechClient } from "../../speech/client.ts"
import { isVoiceChange, type SpeechClip } from "../../speech/protocol.ts"
import "./style.css"

const session = location.hash.slice(1)
const host = parentReaderHost()
const send = (command: ReaderRequest["command"], payload: object = {}) =>
	host
		? host({ session, command, ...payload })
		: browser.runtime.sendMessage({ type: "reader", session, command, ...payload })
const button = (id: string) => document.querySelector<HTMLButtonElement>(`#${id}`)!
const play = button("play"),
	previous = button("previous"),
	next = button("next")
const speed = document.querySelector<HTMLInputElement>("#speed")!
const rate = button("rate")
const speedLevel = document.querySelector<HTMLOutputElement>("#speed-level")!
const voiceSelect = document.querySelector<HTMLSelectElement>("#voice")!
const status = document.querySelector<HTMLSpanElement>("#status")!
const bar = document.querySelector<HTMLDivElement>("#bar")!
const playback = document.querySelector<HTMLDivElement>("#playback")!
const message = document.querySelector<HTMLDivElement>("#message")!
const setup = document.querySelector<HTMLAnchorElement>("#setup")!
const engine = new SpeechClient()
const context = new AudioContext()
const output = context.createGain()
output.connect(context.destination)
const volume = document.querySelector<HTMLInputElement>("#volume")!
const volumePanel = document.querySelector<HTMLDivElement>("#volume-panel")!
const panels = [document.querySelector<HTMLDivElement>("#speed-panel")!, volumePanel]
const volumeLevel = document.querySelector<HTMLOutputElement>("#volume-level")!
function updateVolume() {
	const level = Number(volume.value)
	// A perceptual taper makes the quiet half of the slider useful. Smooth gain
	// changes at the output, so volume never restarts synthesis or alters pitch.
	output.gain.setTargetAtTime((level / 100) ** 2, context.currentTime, 0.015)
	volumeLevel.value = `${level}%`
	volume.setAttribute("aria-valuetext", `${level} percent`)
	button("sound").title = `Volume · ${level}%`
	document
		.querySelector("#sound-waves")!
		.setAttribute(
			"d",
			level === 0
				? "m16 9 6 6m0-6-6 6"
				: level < 50
					? "M15 8a6 6 0 0 1 0 8"
					: "M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14",
		)
}
volume.oninput = updateVolume
volume.onchange = () => void browser.storage.local.set({ volume: Number(volume.value) })
for (const panel of panels) panel.addEventListener("toggle", resizeBar)
// Native light dismissal is scoped to this iframe's document.
window.addEventListener("blur", () => {
	for (const panel of panels) if (panel.matches(":popover-open")) panel.hidePopover()
})
let skippedText = false,
	consecutiveSkipped = 0
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
let checkingVoices = true,
	hasVoices = false,
	preparing = false,
	selecting = false,
	failed = false,
	voiceRevision = 0
let closed = false,
	initializationRevision = 0

function updateControls() {
	const playing = !!active && !paused && !ended && context.state === "running"
	document.querySelector("#play-icon")!.setAttribute("d", playing ? "M8 5v14M16 5v14" : "m8 5 11 7-11 7z")
	play.setAttribute("aria-label", playing ? "Pause" : "Play")
	play.title = ended ? "Read again" : playing ? "Pause" : "Play"
	play.setAttribute("aria-pressed", String(playing))
	play.disabled = !hasVoices || preparing || selecting
	previous.disabled = !hasVoices || preparing || selecting || cursor <= 0
	next.disabled = !hasVoices || preparing || selecting || sentenceTarget(chunks, cursor, 1) < 0
	speed.disabled = !hasVoices
	voiceSelect.disabled = !hasVoices
	playback.hidden = !hasVoices
	button("close").title = hasVoices ? "Stop reading" : "Close"
	button("close").setAttribute("aria-label", hasVoices ? "Stop reading" : "Close")
	setup.hidden = hasVoices || (checkingVoices && !failed)
	bar.dataset.view = hasVoices ? "playback" : setup.hidden ? "loading" : "setup"
	message.classList.toggle("quiet", hasVoices && !preparing && !awaitingGesture && !failed && !skippedText)
	voiceSelect.title =
		voiceSelect.selectedOptions[0]?.parentElement instanceof HTMLOptGroupElement
			? voiceSelect.selectedOptions[0].parentElement.label
			: "Voice"
	resizeBar()
}

function resizeBar() {
	if (closed) return
	let height = bar.getBoundingClientRect().bottom
	for (const panel of panels) {
		if (!panel.matches(":popover-open")) continue
		const anchor = (panel === volumePanel ? button("sound") : rate).getBoundingClientRect()
		const width = panel.getBoundingClientRect().width
		panel.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, anchor.left + anchor.width / 2 - width / 2))}px`
		panel.style.top = `${height + 8}px`
		height = panel.getBoundingClientRect().bottom + 12
	}
	void send("resize", {
		height: Math.ceil(height),
		width: hasVoices ? 460 : checkingVoices ? 320 : 400,
	}).catch(() => {})
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
	generating = false
	lastWord = -1
	void send("highlight", { start: 0, end: 0 }).catch(() => {})
}

async function begin(index: number, offset?: number) {
	if (closed || !hasVoices) return
	if (failed) {
		paused = false
		awaitingGesture = false
	}
	halt()
	began = performance.now()
	firstBuffer = true
	skippedText = false
	consecutiveSkipped = 0
	const current = epoch
	cursor = Math.min(Math.max(0, index), chunks.length - 1)
	const selectedChunk = chunks[cursor]
	const resumeOffset =
		selectedChunk && offset !== undefined && offset >= selectedChunk.start && offset < selectedChunk.end
			? offset
			: undefined
	ended = false
	preparing = true
	failed = false
	status.textContent = "Preparing voice…"
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
	if (closed) return
	halt()
	engine.dispose()
	status.textContent = error instanceof Error ? error.message : "Reading could not continue."
	paused = true
	preparing = false
	failed = true
	updateControls()
}

async function resumeAudio(current: number) {
	try {
		await context.resume()
	} catch (error) {
		if (!closed && current === epoch) fail(error)
	}
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
			consecutiveSkipped = clip.skippedText && !clip.words.length ? consecutiveSkipped + 1 : 0
			if (consecutiveSkipped >= 3)
				throw new Error("This voice cannot read this passage. Choose another voice or select different text.")
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
	skippedText ||= item.clip.skippedText === true
	const buffer = context.createBuffer(1, item.clip.pcm.length, item.clip.sampleRate)
	buffer.copyToChannel(item.clip.pcm, 0)
	const source = context.createBufferSource()
	source.buffer = buffer
	source.connect(output)
	active = { source, started: context.currentTime, clip: item.clip, offset: item.offset }
	preparing = false
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
			status.textContent = skippedText ? "Finished · Some text could not be read." : "Finished"
			updateControls()
			void send("highlight", { start: 0, end: 0 })
			return
		}
		startNext(current)
		void fill(current)
	}
	source.start()
	if (!paused && context.state !== "running") {
		if (navigator.userActivation.hasBeenActive) void resumeAudio(current)
		else {
			paused = true
			awaitingGesture = true
		}
	}
	status.textContent = awaitingGesture
		? "Press Play to start listening."
		: paused
			? "Paused"
			: skippedText
				? "Skipped text this voice could not read."
				: "Reading"
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
	if (selecting || closed) return
	let attempt = epoch
	awaitingGesture = false
	try {
		if (active && !paused && !ended && context.state === "running") {
			paused = true
			await context.suspend()
			status.textContent = "Paused"
			updateControls()
			return
		}
		selecting = true
		updateControls()
		const current = epoch
		const selection: unknown = await send("selection")
		if (closed || current !== epoch) return
		if (selection && typeof selection === "object" && "error" in selection && typeof selection.error === "string")
			throw new Error(selection.error)
		if (
			!selection ||
			typeof selection !== "object" ||
			!("text" in selection) ||
			(selection.text !== null && (typeof selection.text !== "string" || !selection.text.trim()))
		)
			throw new Error("This selection could not be read. Please try again.")
		if (selection.text !== null || ended || failed) {
			const restartIndex = selection.text !== null || ended ? 0 : Math.min(cursor, chunks.length - 1)
			if (typeof selection.text === "string") {
				text = selection.text
				chunks = readingChunks(text, voiceChoice(voiceSelect.value).voice.locale)
			}
			paused = false
			// begin stops the previous buffer before the audio context can resume it.
			void begin(restartIndex)
			attempt = epoch
			await resumeAudio(attempt)
			return
		}
		paused = false
		await resumeAudio(current)
		if (closed || current !== epoch) return
		if (!active && !generating) void begin(Math.min(cursor, chunks.length - 1))
		status.textContent = active
			? skippedText
				? "Skipped text this voice could not read."
				: "Reading"
			: "Preparing voice…"
		updateControls()
	} catch (error) {
		if (!closed && attempt === epoch) fail(error)
	} finally {
		selecting = false
		if (!closed) updateControls()
	}
}
previous.onclick = () => void begin(Math.max(0, sentenceTarget(chunks, cursor, -1)))
next.onclick = () => {
	const index = sentenceTarget(chunks, cursor, 1)
	if (index >= 0) void begin(index)
}
button("close").onclick = () => {
	closed = true
	halt()
	engine.dispose()
	void context.close()
	void send("close")
}
function updateSpeed() {
	rate.textContent = `${Number(speed.value)}×`
	rate.title = `Reading speed · ${rate.textContent}`
	rate.setAttribute("aria-label", `Reading speed, ${Number(speed.value)} times normal`)
	speedLevel.value = rate.textContent
	speed.setAttribute("aria-valuetext", `${Number(speed.value)} times normal speed`)
}
speed.oninput = updateSpeed
speed.onchange = () => {
	void browser.storage.local.set({ speed: Number(speed.value) })
	void begin(Math.min(cursor, chunks.length - 1), lastWord < 0 ? undefined : lastWord)
}
voiceSelect.onchange = () => {
	void browser.storage.local.set({ voice: voiceSelect.value })
	const position = chunks[cursor]?.start ?? 0
	chunks = readingChunks(text, voiceChoice(voiceSelect.value).voice.locale)
	cursor = Math.max(
		0,
		chunks.findIndex((chunk) => chunk.end > position),
	)
	void begin(Math.min(cursor, chunks.length - 1))
}

async function refreshVoices() {
	const current = ++voiceRevision
	const response: unknown = await browser.runtime.sendMessage({ type: "installed-voices" })
	if (!Array.isArray(response) || !response.every((id) => typeof id === "string"))
		throw new Error("Your voices could not be loaded. Open Voices and try again.")
	const installed = new Set<string>(response)
	const preferences = await browser.storage.local.get(["voice", "speed"])
	if (closed || current !== voiceRevision) return hasVoices
	const previousChoice = voiceSelect.value
	voiceSelect.replaceChildren()
	for (const voice of voices.filter((voice) => installed.has(voice.id))) {
		const group = document.createElement("optgroup")
		group.label = `${voice.name} · ${voice.quality.replace("x_low", "extra low")} · ${languageLabel(voice)}`
		const names = new Map(Object.entries(voice.speakerNames ?? {}).map(([name, id]) => [id, name]))
		for (let speaker = 0; speaker < voice.speakers; speaker++) {
			const option = document.createElement("option")
			option.value = speaker ? `${voice.id}#${speaker}` : voice.id
			option.textContent =
				voice.speakers > 1
					? `${voice.name} · ${names.get(speaker) ?? `Speaker ${speaker + 1}`}`
					: `${voice.name} · ${voice.quality.replace("x_low", "extra low")}`
			group.append(option)
		}
		voiceSelect.append(group)
	}
	for (const preferred of [preferences.voice, previousChoice]) {
		if (typeof preferred === "string" && Array.from(voiceSelect.options).some((option) => option.value === preferred)) {
			voiceSelect.value = preferred
			break
		}
	}
	hasVoices = voiceSelect.options.length > 0
	checkingVoices = false
	updateControls()
	return hasVoices
}

async function voicesChanged(id: string, deleted: boolean) {
	if (closed) return
	const wasWaiting = !hasVoices
	if (deleted && id === voiceSelect.value.split("#")[0]) {
		halt()
		engine.dispose()
		paused = true
		preparing = false
		failed = true
		status.textContent = "Voice removed. Press Play to use another downloaded voice."
	}
	if (!(await refreshVoices())) {
		halt()
		engine.dispose()
		paused = true
		preparing = false
		failed = false
		awaitingGesture = false
		status.textContent = "No voice downloaded."
	} else if (wasWaiting && !deleted && text.trim()) {
		paused = false
		chunks = readingChunks(text, voiceChoice(voiceSelect.value).voice.locale)
		await begin(0)
	}
	updateControls()
}
browser.storage.onChanged.addListener((changes, area) => {
	const change: unknown = changes.voiceChange?.newValue
	if (area === "local" && isVoiceChange(change)) void voicesChanged(change.id, change.deleted).catch(fail)
	const reset: unknown = changes.readerChange?.newValue
	if (!closed && area === "local" && isReaderChange(reset) && reset.session === session) {
		halt()
		void initialize()
	}
})
window.addEventListener("pagehide", () => {
	closed = true
	halt()
	engine.dispose()
	void context.close()
})
new ResizeObserver(resizeBar).observe(bar)
window.addEventListener("keydown", (event) => {
	if (event.key === "Escape" && !panels.some((panel) => panel.matches(":popover-open"))) button("close").click()
})

async function initialize() {
	const current = ++initializationRevision
	const generation = epoch
	preparing = true
	status.textContent = "Getting ready…"
	updateControls()
	try {
		const source: unknown = await send("document")
		if (closed || current !== initializationRevision || generation !== epoch) return
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
		const preferences = await browser.storage.local.get(["speed", "volume"])
		if (closed || current !== initializationRevision || generation !== epoch) return
		if (typeof preferences.speed === "number" && preferences.speed >= 0.5 && preferences.speed <= 2)
			speed.value = String(preferences.speed)
		updateSpeed()
		if (
			typeof preferences.volume === "number" &&
			Number.isFinite(preferences.volume) &&
			preferences.volume >= 0 &&
			preferences.volume <= 100
		)
			volume.value = String(preferences.volume)
		updateVolume()
		chunks = readingChunks(text, available ? voiceChoice(voiceSelect.value).voice.locale : "en")
		if (!available) {
			paused = true
			preparing = false
			failed = false
			awaitingGesture = false
			status.textContent = "No voice downloaded."
			updateControls()
			return
		}
		paused = false
		awaitingGesture = false
		await begin(0)
	} catch (error) {
		if (!closed && current === initializationRevision && generation === epoch) fail(error)
	}
}
requestAnimationFrame(highlight)
context.onstatechange = updateControls
void initialize()
window.addEventListener("read-aloud-source-changed", () => {
	halt()
	void initialize()
})
