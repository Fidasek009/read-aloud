import { browser } from "wxt/browser"

import { bindMediaSession } from "../../playback/media-session.ts"
import { speechWav } from "../../playback/wav.ts"
import { readingChunks, sentenceTarget } from "../../reading/document.ts"
import {
	isReaderChange,
	isReaderResponse,
	parentReaderHost,
	type ReaderCommand,
	type ReaderResponse,
} from "../../reading/host.ts"
import { languageLabel, qualityLabel, voiceChoice, voices } from "../../speech/catalog.ts"
import { SpeechClient } from "../../speech/client.ts"
import { firstBufferPerformance } from "../../speech/diagnostics.ts"
import {
	SpeechTextError,
	SpeechTimeoutError,
	SpeechTransportError,
	SpeechUnavailableError,
	SpeechVoiceError,
} from "../../speech/errors.ts"
import { isVoiceChange, type SpeechClip, voiceModelId } from "../../speech/protocol.ts"
import "./style.css"

const session = location.hash.slice(1)
const host = parentReaderHost()
// Firefox exposes runtime messaging, but not the tabs API, to this embedded extension frame.
const currentTab =
	host || import.meta.env.BROWSER === "firefox"
		? undefined
		: Promise.resolve()
				.then(() => browser.tabs.getCurrent())
				.catch(() => undefined)
const send = async (command: ReaderCommand): Promise<ReaderResponse> => {
	const request = { ...command, session }
	const tab = host ? undefined : await currentTab
	const response: unknown = host
		? await host(request)
		: tab?.id === undefined
			? await browser.runtime.sendMessage({ type: "reader", ...request })
			: await browser.tabs.sendMessage(tab.id, { type: "reader", ...request }, { frameId: 0 })
	if (!isReaderResponse(command, response))
		throw new SpeechTransportError("The page did not respond. Press Play to try again.")
	return response
}
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
class PlayerMessage extends Error {}
const volume = document.querySelector<HTMLInputElement>("#volume")!
const volumePanel = document.querySelector<HTMLDivElement>("#volume-panel")!
const panels = [document.querySelector<HTMLDivElement>("#speed-panel")!, volumePanel]
const volumeLevel = document.querySelector<HTMLOutputElement>("#volume-level")!
function updateVolume() {
	const level = Number(volume.value)
	// Keep the quiet half of the slider useful without restarting speech.
	for (const clip of [active, scheduled]) if (clip) clip.source.volume = (level / 100) ** 2
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
	epoch = 0
type PlaybackIntent = "play" | "pause" | "gesture"
type ResumableState =
	{ kind: "ready"; intent: "pause" | "gesture" } | { kind: "ended" } | { kind: "failed"; message: string }
type PlaybackState =
	| { kind: "preparing"; intent: PlaybackIntent }
	| { kind: "ready"; intent: "play" }
	| { kind: "pausing" }
	| { kind: "selecting"; previous: ResumableState }
	| { kind: "no-voices" }
	| ResumableState
	| { kind: "closed" }
let state: PlaybackState = { kind: "preparing", intent: "play" }
function currentState(): PlaybackState {
	return state
}
function setState(next: PlaybackState) {
	if (state.kind !== "closed") state = next
}
type QueuedClip = { clip: SpeechClip; offset: number; index: number }
type PlayingClip = QueuedClip & { source: HTMLAudioElement; url: string }
let active: PlayingClip | undefined
let scheduled: PlayingClip | undefined
let queue: QueuedClip[] = []
let generating = false,
	lastWord = -1
let began = performance.now(),
	firstBuffer = true
let checkingVoices = true,
	hasVoices = false,
	voiceRevision = 0
let highlightFrame = 0
const mediaControls = bindMediaSession(navigator.mediaSession, {
	play: () => {
		if (state.kind === "preparing") {
			setState({ kind: "preparing", intent: "play" })
			void resumeAudio(epoch)
			updateControls()
		} else if (!(state.kind === "ready" && state.intent === "play")) {
			play.click()
		}
	},
	pause: () => void pausePlayback(),
	previoustrack: () => previous.click(),
	nexttrack: () => next.click(),
	stop: () => button("close").click(),
})

function updateControls() {
	const playing = !!active && state.kind === "ready" && state.intent === "play" && !active.source.paused
	const busy = state.kind === "preparing" || state.kind === "selecting" || state.kind === "pausing"
	const ended = state.kind === "ended"
	const failed = state.kind === "failed"
	const awaitingGesture = state.kind === "ready" && state.intent === "gesture"
	mediaControls.update(
		state.kind === "closed" || state.kind === "no-voices" || failed
			? "none"
			: playing || (state.kind === "preparing" && state.intent === "play")
				? "playing"
				: "paused",
	)
	if (playing && !highlightFrame) highlightFrame = requestAnimationFrame(highlight)
	else if (!playing && highlightFrame) {
		cancelAnimationFrame(highlightFrame)
		highlightFrame = 0
	}
	document.querySelector("#play-icon")!.setAttribute("d", playing ? "M8 5v14M16 5v14" : "m8 5 11 7-11 7z")
	play.setAttribute("aria-label", ended ? "Read again" : playing ? "Pause" : "Play")
	play.title = ended ? "Read again" : playing ? "Pause" : "Play"
	play.disabled = !hasVoices || busy
	previous.disabled = !hasVoices || busy || cursor <= 0
	next.disabled = !hasVoices || busy || sentenceTarget(chunks, cursor, 1) < 0
	speed.disabled = !hasVoices || busy
	rate.disabled = !hasVoices || busy
	voiceSelect.disabled = !hasVoices || busy
	playback.hidden = !hasVoices
	button("close").title = hasVoices ? "Stop reading" : "Close"
	button("close").setAttribute("aria-label", hasVoices ? "Stop reading" : "Close")
	setup.hidden = hasVoices || (checkingVoices && !failed)
	bar.dataset.view = hasVoices ? "playback" : setup.hidden ? "loading" : "setup"
	message.classList.toggle(
		"quiet",
		hasVoices && state.kind !== "preparing" && !awaitingGesture && !failed && !skippedText,
	)
	voiceSelect.title =
		voiceSelect.selectedOptions[0]?.parentElement instanceof HTMLOptGroupElement
			? voiceSelect.selectedOptions[0].parentElement.label
			: "Voice"
	resizeBar()
}

function resizeBar() {
	if (state.kind === "closed") return
	let height = bar.getBoundingClientRect().bottom
	for (const panel of panels) {
		if (!panel.matches(":popover-open")) continue
		const anchor = (panel === volumePanel ? button("sound") : rate).getBoundingClientRect()
		const width = panel.getBoundingClientRect().width
		panel.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, anchor.left + anchor.width / 2 - width / 2))}px`
		panel.style.top = `${height + 8}px`
		height = panel.getBoundingClientRect().bottom + 12
	}
	void send({
		command: "resize",
		height: Math.ceil(height),
		width: hasVoices ? 460 : checkingVoices ? 320 : 400,
	}).catch(() => {})
}

function halt() {
	epoch++
	active?.source.pause()
	if (highlightFrame) cancelAnimationFrame(highlightFrame)
	highlightFrame = 0
	engine.cancelQueued()
	if (active) {
		disposeClip(active)
		active = undefined
	}
	if (scheduled) {
		disposeClip(scheduled)
		scheduled = undefined
	}
	queue = []
	generating = false
	lastWord = -1
	void send({ command: "highlight", start: 0, end: 0 }).catch(() => {})
}

async function begin(index: number, offset?: number) {
	if (state.kind === "closed" || !hasVoices) return
	const intent: PlaybackIntent = state.kind === "ready" || state.kind === "preparing" ? state.intent : "play"
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
	setState({ kind: "preparing", intent })
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
	if (state.kind === "closed") return
	halt()
	engine.dispose()
	const message =
		error instanceof PlayerMessage ||
		error instanceof SpeechTextError ||
		error instanceof SpeechTimeoutError ||
		error instanceof SpeechTransportError ||
		error instanceof SpeechUnavailableError ||
		error instanceof SpeechVoiceError
			? error.message
			: "Reading could not continue. Press Play to try again."
	setState({ kind: "failed", message })
	status.textContent = message
	updateControls()
}

async function resumeAudio(current: number) {
	try {
		await active?.source.play()
		if (current !== epoch || currentState().kind === "closed") return
		updateControls()
	} catch (error) {
		if (state.kind === "closed" || current !== epoch) return
		if (
			state.kind === "pausing" ||
			((state.kind === "preparing" || state.kind === "ready") && state.intent === "pause")
		)
			return
		if (error instanceof DOMException && error.name === "NotAllowedError") {
			setState({ kind: "ready", intent: "gesture" })
			if (currentState().kind === "closed" || current !== epoch) return
			status.textContent = "Press Play to start listening."
			updateControls()
		} else fail(error)
	}
}

async function fill(current: number, firstOffset?: number) {
	if (generating || current !== epoch) return
	generating = true
	try {
		while (current === epoch && queue.length + Number(!!scheduled) < 2) {
			const index = active ? cursor + queue.length + Number(!!scheduled) + 1 : cursor + queue.length
			const chunk = chunks[index]
			if (!chunk) break
			const offset = index === cursor && firstOffset !== undefined ? firstOffset : chunk.start
			const clip = await engine.synthesize(text.slice(offset, chunk.end), Number(speed.value))
			if (current !== epoch) return
			consecutiveSkipped = clip.skippedText && !clip.words.length ? consecutiveSkipped + 1 : 0
			if (consecutiveSkipped >= 3)
				throw new PlayerMessage("This voice cannot read this passage. Choose another voice or select different text.")
			queue.push({ clip, offset, index })
			if (!active) startNext(current)
			else scheduleNext(current)
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
	active = makeSource(item, current)
	activate(active, current)
	scheduleNext(current)
}

function disposeClip(clip: PlayingClip) {
	clip.source.onended = null
	clip.source.onerror = null
	clip.source.pause()
	clip.source.removeAttribute("src")
	clip.source.load()
	URL.revokeObjectURL(clip.url)
}

function makeSource(item: QueuedClip, current: number): PlayingClip {
	const url = URL.createObjectURL(speechWav(item.clip.pcm, item.clip.sampleRate))
	const source = new Audio(url)
	source.preload = "auto"
	source.volume = (Number(volume.value) / 100) ** 2
	const playing: PlayingClip = { ...item, source, url }
	source.onerror = () => {
		if (current === epoch) fail(new PlayerMessage("Audio could not play. Press Play to try again."))
	}
	source.onended = () => {
		if (current !== epoch || active !== playing) return
		disposeClip(playing)
		active = scheduled
		scheduled = undefined
		cursor = playing.index + 1
		if (active) {
			activate(active, current)
			scheduleNext(current)
		} else if (cursor >= chunks.length) {
			setState({ kind: "ended" })
			status.textContent = skippedText ? "Finished · Some text could not be read." : "Finished"
			updateControls()
			void send({ command: "highlight", start: 0, end: 0 })
		} else startNext(current)
		void fill(current)
	}
	source.load()
	return playing
}

function scheduleNext(current: number) {
	if (current !== epoch || !active || scheduled || !queue.length) return
	const item = queue.shift()!
	scheduled = makeSource(item, current)
}

function activate(item: PlayingClip, current: number) {
	cursor = item.index
	skippedText ||= item.clip.skippedText === true
	if (firstBuffer) {
		firstBuffer = false
		const measurement = firstBufferPerformance(engine.diagnostics, performance.now() - began)
		if (measurement) void browser.storage.local.set({ lastSpeechPerformance: measurement })
	}
	// A pause or selection already in progress owns the state transition.
	if (state.kind === "pausing" || state.kind === "selecting") {
		updateControls()
		return
	}
	const intent: PlaybackIntent = state.kind === "preparing" || state.kind === "ready" ? state.intent : "play"
	if (intent === "play" && item.source.paused) void resumeAudio(current)
	setState({ kind: "ready", intent })
	status.textContent =
		intent === "gesture"
			? "Press Play to start listening."
			: intent === "pause"
				? "Paused"
				: skippedText
					? "Skipped text this voice could not read."
					: "Reading"
	updateControls()
}

function highlight() {
	highlightFrame = 0
	if (active && state.kind === "ready" && state.intent === "play") {
		const seconds = active.source.currentTime
		const word = active.clip.words.find((word) => seconds >= word.from && seconds < word.to)
		if (word && active.offset + word.start !== lastWord) {
			lastWord = active.offset + word.start
			void send({ command: "highlight", start: lastWord, end: active.offset + word.end }).catch(() => {})
		}
		highlightFrame = requestAnimationFrame(highlight)
	}
}

async function pausePlayback() {
	if (state.kind !== "preparing" && !(state.kind === "ready" && state.intent === "play")) return
	const current = epoch
	// Preserve a pending pause even when the first audio buffer is still being prepared.
	if (state.kind === "preparing") setState({ kind: "preparing", intent: "pause" })
	else setState({ kind: "pausing" })
	status.textContent = "Paused"
	active?.source.pause()
	updateControls()
	try {
		if (current !== epoch || currentState().kind === "closed") return
		if (currentState().kind === "pausing") setState({ kind: "ready", intent: "pause" })
		updateControls()
	} catch (error) {
		if (current === epoch) fail(error)
	}
}

play.onclick = async () => {
	if (
		state.kind === "closed" ||
		state.kind === "preparing" ||
		state.kind === "selecting" ||
		state.kind === "pausing" ||
		state.kind === "no-voices"
	)
		return
	let attempt = epoch
	let selectionState: Extract<PlaybackState, { kind: "selecting" }> | undefined
	try {
		if (active && state.kind === "ready" && state.intent === "play") {
			await pausePlayback()
			return
		}
		const previous: ResumableState =
			state.kind === "ready" ? { kind: "ready", intent: state.intent === "gesture" ? "gesture" : "pause" } : state
		selectionState = { kind: "selecting", previous }
		setState(selectionState)
		updateControls()
		const current = epoch
		const selection: unknown = await send({ command: "selection" })
		if (currentState() !== selectionState || current !== epoch) return
		if (selection && typeof selection === "object" && "error" in selection && typeof selection.error === "string")
			throw new PlayerMessage("This selection could not be read. Select it again and press Play.")
		if (
			!selection ||
			typeof selection !== "object" ||
			!("text" in selection) ||
			(selection.text !== null && (typeof selection.text !== "string" || !selection.text.trim()))
		)
			throw new PlayerMessage("This selection could not be read. Please try again.")
		if (selection.text !== null || previous.kind === "ended" || previous.kind === "failed") {
			const restartIndex =
				selection.text !== null || previous.kind === "ended" ? 0 : Math.min(cursor, chunks.length - 1)
			if (typeof selection.text === "string") {
				text = selection.text
				chunks = readingChunks(text, voiceChoice(voiceSelect.value).voice.locale)
			}
			setState({ kind: "ready", intent: "play" })
			// begin stops the previous buffer before the audio context can resume it.
			void begin(restartIndex)
			attempt = epoch
			await resumeAudio(attempt)
			return
		}
		setState({ kind: "ready", intent: "play" })
		await resumeAudio(current)
		if (currentState().kind === "closed" || current !== epoch) return
		if (!active && !generating) void begin(Math.min(cursor, chunks.length - 1))
		status.textContent = active
			? skippedText
				? "Skipped text this voice could not read."
				: "Reading"
			: "Preparing voice…"
		updateControls()
	} catch (error) {
		if (currentState().kind !== "closed" && attempt === epoch) fail(error)
	} finally {
		if (selectionState && currentState() === selectionState) setState(selectionState.previous)
		if (currentState().kind !== "closed") updateControls()
	}
}
previous.onclick = () => void begin(Math.max(0, sentenceTarget(chunks, cursor, -1)))
next.onclick = () => {
	const index = sentenceTarget(chunks, cursor, 1)
	if (index >= 0) void begin(index)
}
button("close").onclick = () => {
	setState({ kind: "closed" })
	mediaControls.dispose()
	halt()
	engine.dispose()
	void send({ command: "close" })
}
function updateSpeed() {
	rate.textContent = `${Number(speed.value)}×`
	rate.title = `Reading speed · ${rate.textContent}`
	rate.setAttribute("aria-label", `Reading speed, ${Number(speed.value)}×`)
	speedLevel.value = rate.textContent
	speed.setAttribute("aria-valuetext", `${Number(speed.value)}× normal speed`)
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
		throw new PlayerMessage("Your voices could not be loaded. Open Voices and try again.")
	const installed = new Set<string>(response)
	const preferences = await browser.storage.local.get(["voice", "speed"])
	if (state.kind === "closed" || current !== voiceRevision) return hasVoices
	const previousChoice = voiceSelect.value
	voiceSelect.replaceChildren()
	for (const voice of voices.filter((voice) => installed.has(voice.id))) {
		const group = document.createElement("optgroup")
		group.label = `${voice.name} · ${qualityLabel(voice.quality)} · ${languageLabel(voice)}`
		const names = new Map(Object.entries(voice.speakerNames ?? {}).map(([name, id]) => [id, name]))
		for (let speaker = 0; speaker < voice.speakers; speaker++) {
			const option = document.createElement("option")
			option.value = speaker ? `${voice.id}#${speaker}` : voice.id
			option.textContent =
				voice.speakers > 1
					? `${voice.name} · ${names.get(speaker) ?? `Speaker ${speaker + 1}`}`
					: `${voice.name} · ${qualityLabel(voice.quality)}`
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
	if (state.kind === "closed") return
	const wasWaiting = !hasVoices
	const previousChoice = voiceSelect.value
	const pending = refreshVoices()
	const revision = voiceRevision
	const available = await pending
	if (currentState().kind === "closed" || revision !== voiceRevision) return
	const stillInstalled = Array.from(voiceSelect.options).some((option) => voiceModelId(option.value) === id)
	if (
		deleted &&
		id === voiceModelId(previousChoice) &&
		id === voiceModelId(engine.voice) &&
		!stillInstalled &&
		available
	) {
		halt()
		engine.dispose()
		const message = "Voice removed. Press Play to use another downloaded voice."
		setState({ kind: "failed", message })
		status.textContent = message
	}
	if (!available) {
		halt()
		engine.dispose()
		setState({ kind: "no-voices" })
		status.textContent = "No voice downloaded."
	} else if (wasWaiting && !deleted && text.trim()) {
		setState({ kind: "ready", intent: "play" })
		chunks = readingChunks(text, voiceChoice(voiceSelect.value).voice.locale)
		await begin(0)
	}
	updateControls()
}
browser.storage.onChanged.addListener((changes, area) => {
	const change: unknown = changes.voiceChange?.newValue
	if (area === "local" && isVoiceChange(change)) void voicesChanged(change.id, change.deleted).catch(fail)
	const reset: unknown = changes.readerChange?.newValue
	if (state.kind !== "closed" && area === "local" && isReaderChange(reset) && reset.session === session) {
		halt()
		void initialize()
	}
})
window.addEventListener("pagehide", () => {
	setState({ kind: "closed" })
	mediaControls.dispose()
	halt()
	engine.dispose()
})
new ResizeObserver(resizeBar).observe(bar)
window.addEventListener("keydown", (event) => {
	if (event.key === "Escape" && !panels.some((panel) => panel.matches(":popover-open"))) button("close").click()
})

async function initialize() {
	if (currentState().kind === "closed") return
	const generation = epoch
	setState({ kind: "preparing", intent: "play" })
	status.textContent = "Getting ready…"
	updateControls()
	try {
		const source: unknown = await send({ command: "document" })
		if (currentState().kind === "closed" || generation !== epoch) return
		if (
			!source ||
			typeof source !== "object" ||
			!("text" in source) ||
			typeof source.text !== "string" ||
			!source.text.trim()
		)
			throw new PlayerMessage("Start reading from a page or a text selection.")
		text = source.text
		let available: boolean
		let preferences: Record<string, unknown>
		for (;;) {
			const pending = refreshVoices()
			const revision = voiceRevision
			available = await pending
			preferences = await browser.storage.local.get(["speed", "volume"])
			if (currentState().kind === "closed" || generation !== epoch) return
			if (revision === voiceRevision) break
		}
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
			setState({ kind: "no-voices" })
			status.textContent = "No voice downloaded."
			updateControls()
			return
		}
		setState({ kind: "ready", intent: "play" })
		await begin(0)
	} catch (error) {
		if (currentState().kind !== "closed" && generation === epoch) fail(error)
	}
}
void initialize()
window.addEventListener("read-aloud-source-changed", () => {
	halt()
	void initialize()
})
