import type { browser } from "wxt/browser"

interface AudioObservation {
	sources: number
	stops: number
	starts: { when: number; duration: number; requestedAt: number }[]
	lastStop: number
	gain?: GainNode
}

type ProbeWindow = Window &
	typeof globalThis & {
		__probeAudio: AudioObservation
		browser?: Pick<typeof browser, "storage">
		chrome?: Pick<typeof browser, "storage">
	}

/** Self-contained: serialized into the copied test package, never the shipped extension. */
function installAudioObservation() {
	const probeWindow = window as ProbeWindow
	const NativeAudioContext = window.AudioContext
	const audio: AudioObservation = { sources: 0, stops: 0, starts: [], lastStop: 0 }
	probeWindow.__probeAudio = audio
	window.addEventListener("error", (event) => {
		document.documentElement.dataset.probeError = String(event.message)
	})
	window.addEventListener("unhandledrejection", (event) => {
		document.documentElement.dataset.probeRejection = String(event.reason)
	})
	const extension = probeWindow.browser ?? probeWindow.chrome
	if (!extension) throw new Error("Extension storage API is unavailable")
	extension.storage.onChanged.addListener((changes, area) => {
		const change: unknown = changes.readerChange?.newValue
		if (change && typeof change === "object" && "session" in change)
			document.body.dataset.probeControlChange = `${area}:${change.session === location.hash.slice(1)}`
	})
	window.AudioContext = class extends NativeAudioContext {
		override createGain() {
			const gain = super.createGain()
			audio.gain = gain
			return gain
		}
		override createBufferSource() {
			if (document.body.hasAttribute("data-probe-fail-buffer")) {
				document.body.removeAttribute("data-probe-fail-buffer")
				throw new Error("Internal test diagnostic")
			}
			audio.sources++
			const source = super.createBufferSource()
			const stop = source.stop.bind(source)
			const start = source.start.bind(source)
			source.stop = (...args: Parameters<AudioBufferSourceNode["stop"]>) => {
				audio.stops++
				audio.lastStop = performance.now()
				return stop(...args)
			}
			source.start = (when = 0, ...args: [offset?: number, duration?: number]) => {
				if (!source.buffer) throw new Error("Audio source has no buffer")
				audio.starts.push({ when, duration: source.buffer.duration, requestedAt: performance.now() })
				return start(when, ...args)
			}
			return source
		}
	}
}

/** Observe the real output graph; allow one explicit output failure in copied test packages only. */
export async function observePlayerAudio(directory: string) {
	await Bun.write(`${directory}/probe-audio.js`, `(${installAudioObservation.toString()})()`)
	const html = Bun.file(`${directory}/player.html`)
	await Bun.write(html, (await html.text()).replace("<head>", '<head><script src="probe-audio.js"></script>'))
}

/** Run during active playback; native keyboard dismissal is checked by each browser driver. */
async function verifyVolume() {
	const probeWindow = window as ProbeWindow
	const settle = async (predicate: () => boolean) => {
		const deadline = performance.now() + 1500
		while (!predicate() && performance.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25))
	}
	const recordedAt = (stored: unknown) => {
		if (stored && typeof stored === "object" && "lastSpeechPerformance" in stored) {
			const measurement = stored.lastSpeechPerformance
			if (measurement && typeof measurement === "object" && "recordedAt" in measurement)
				if (typeof measurement.recordedAt === "string") return measurement.recordedAt
		}
		throw new Error("Playback has no performance measurement")
	}
	const extension = probeWindow.browser ?? probeWindow.chrome
	if (!extension) throw new Error("Extension storage API is unavailable")
	const audio = probeWindow.__probeAudio
	const gainNode = audio.gain
	if (!gainNode) throw new Error("Playback has no output gain node")
	const bar = document.querySelector<HTMLElement>("#bar")
	const volume = document.querySelector<HTMLInputElement>("#volume")
	const sound = document.querySelector<HTMLButtonElement>("#sound")
	const panel = document.querySelector<HTMLElement>("#volume-panel")
	const voice = document.querySelector<HTMLSelectElement>("#voice")
	if (!bar || !volume || !sound || !panel || !voice) throw new Error("Playback controls are missing")
	const before = audio.stops
	const barHeight = bar.getBoundingClientRect().height
	const previous = recordedAt(await extension.storage.local.get("lastSpeechPerformance"))
	sound.click()
	await new Promise((resolve) => setTimeout(resolve, 150))
	if (!panel.matches(":popover-open") || document.activeElement !== volume)
		throw new Error("Volume did not open and focus its native slider")
	const rect = panel.getBoundingClientRect()
	if (
		rect.bottom > innerHeight ||
		rect.top < barHeight + 7 ||
		bar.getBoundingClientRect().height !== barHeight ||
		voice.getBoundingClientRect().width > 148
	)
		throw new Error("Volume panel clipped or voice selector is too wide")
	volume.value = "50"
	volume.dispatchEvent(new Event("input"))
	volume.dispatchEvent(new Event("change"))
	await settle(() => Math.abs(gainNode.gain.value - 0.25) <= 0.01)
	const gain = gainNode.gain.value
	if (Math.abs(gain - 0.25) > 0.01) throw new Error(`Output gain did not follow volume: ${gain}`)
	const stored: unknown = await extension.storage.local.get(["volume", "lastSpeechPerformance"])
	if (
		!stored ||
		typeof stored !== "object" ||
		!("volume" in stored) ||
		stored.volume !== 50 ||
		recordedAt(stored) !== previous ||
		audio.stops !== before
	)
		throw new Error("Volume restarted synthesis/audio or did not persist")
	volume.value = "0"
	volume.dispatchEvent(new Event("input"))
	await settle(() => gainNode.gain.value <= 0.001)
	if (gainNode.gain.value > 0.001)
		throw new Error(
			`Zero volume did not mute output: ${JSON.stringify({ gain: gainNode.gain.value, state: gainNode.context.state, time: gainNode.context.currentTime })}`,
		)
	volume.value = "75"
	volume.dispatchEvent(new Event("input"))
	volume.dispatchEvent(new Event("change"))
	return {
		perceptualGain: gain,
		muted: true,
		persisted: true,
		sourceUnchanged: true,
		sliderFocused: true,
		voiceWidth: voice.getBoundingClientRect().width,
	}
}

async function verifySpeedPanel() {
	const bar = document.querySelector<HTMLElement>("#bar")
	const rate = document.querySelector<HTMLButtonElement>("#rate")
	const panel = document.querySelector<HTMLElement>("#speed-panel")
	const volumePanel = document.querySelector<HTMLElement>("#volume-panel")
	if (!bar || !rate || !panel || !volumePanel) throw new Error("Playback controls are missing")
	const barHeight = bar.getBoundingClientRect().height
	rate.click()
	const deadline = performance.now() + 1500
	while (performance.now() < deadline) {
		const rect = panel.getBoundingClientRect()
		if (panel.matches(":popover-open") && rect.bottom <= innerHeight && rect.top >= barHeight + 7) break
		await new Promise((resolve) => setTimeout(resolve, 25))
	}
	if (!panel.matches(":popover-open") || document.activeElement?.id !== "speed" || volumePanel.matches(":popover-open"))
		throw new Error("Speed panel did not replace volume and focus its slider")
	const rect = panel.getBoundingClientRect()
	if (rect.top < barHeight + 7 || rect.bottom > innerHeight || bar.getBoundingClientRect().height !== barHeight)
		throw new Error("Speed panel enlarged the bar or clipped")
	panel.hidePopover()
	return { floating: true, barHeightUnchanged: true, sliderFocused: true }
}

function failPlayback() {
	document.body.setAttribute("data-probe-fail-buffer", "")
	const speed = document.querySelector<HTMLInputElement>("#speed")
	if (!speed) throw new Error("Playback speed control is missing")
	speed.dispatchEvent(new Event("change"))
}

// Drivers still consume expressions, but every assertion above is checked by TypeScript.
export const checkVolume = `(${verifyVolume.toString()})()`
export const checkSpeedPanel = `(${verifySpeedPanel.toString()})()`
export const failNextPlayback = `(${failPlayback.toString()})()`
