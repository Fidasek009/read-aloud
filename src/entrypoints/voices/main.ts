import { browser } from "wxt/browser"

import { voices } from "../../speech/catalog.ts"
import { deleteVoice, downloadVoice, installedVoices, onVoicesChanged } from "../../speech/vault.ts"
import "./style.css"

const list = document.querySelector<HTMLDivElement>("#voices")!
const status = document.querySelector<HTMLParagraphElement>("#status")!
const search = document.querySelector<HTMLInputElement>("#search")!
const count = document.querySelector<HTMLParagraphElement>("#count")!
const audio = new Audio()
audio.preload = "none"
audio.crossOrigin = "anonymous"
let preview: HTMLButtonElement | undefined
let previewRequest = 0
let renderRevision = 0
const downloads = new Map<string, { controller: AbortController; fraction: number }>()

function stopPreview() {
	previewRequest++
	audio.pause()
	audio.removeAttribute("src")
	audio.load()
	if (preview) {
		preview.textContent = "Listen"
		preview.setAttribute("aria-pressed", "false")
		preview.setAttribute("aria-label", `Listen to ${preview.dataset.voiceName}`)
	}
	preview = undefined
}
const priority = (id: string) => (id === "en_US-ljspeech-medium" ? 0 : id === "cs_CZ-jirka-medium" ? 1 : 2)
const sorted = [...voices].sort(
	(a, b) =>
		priority(a.id) - priority(b.id) ||
		a.language.localeCompare(b.language) ||
		a.name.localeCompare(b.name) ||
		a.quality.localeCompare(b.quality),
)
async function render() {
	const current = ++renderRevision
	const installed = new Set(await installedVoices())
	if (current !== renderRevision) return
	stopPreview()
	list.replaceChildren()
	const query = search.value.toLocaleLowerCase().trim()
	const shown = sorted.filter((voice) =>
		`${voice.name} ${voice.id} ${voice.language} ${voice.nativeLanguage} ${voice.quality}`
			.toLocaleLowerCase()
			.includes(query),
	)
	count.textContent = `${shown.length} of ${voices.length} models · ${installed.size} downloaded`
	for (const voice of shown) {
		const row = document.createElement("section")
		row.dataset.voice = voice.id
		const description = document.createElement("div")
		const title = document.createElement("h2")
		title.textContent = voice.name
		const detail = document.createElement("p")
		const quality = voice.quality === "x_low" ? "Extra low" : voice.quality[0]!.toUpperCase() + voice.quality.slice(1)
		detail.textContent = `${voice.language} · ${quality} · ${Math.round(voice.bytes / 1e6)} MB${voice.speakers > 1 ? ` · ${voice.speakers} speakers` : ""}`
		const terms = document.createElement("a")
		terms.className = "terms"
		terms.textContent = `Model terms: ${voice.license}${voice.inheritedTerms ? " · inherited training terms" : ""}`
		terms.href = voice.termsUrl
		terms.target = "_blank"
		terms.rel = "noopener noreferrer"
		description.append(title, detail, terms)
		if (voice.unsupported) {
			const warning = document.createElement("p")
			warning.className = "compatibility"
			warning.textContent = `${voice.unsupported}. Playback is not available yet.`
			description.append(warning)
		}
		const sample = document.createElement("button")
		sample.textContent = "Listen"
		sample.disabled = !voice.previewUrl
		sample.title = voice.previewUrl ? "Play an online sample" : "No prerecorded sample is available"
		sample.dataset.voiceName = voice.name
		sample.setAttribute("aria-label", `Listen to ${voice.name}`)
		sample.setAttribute("aria-pressed", "false")
		sample.onclick = async () => {
			if (preview === sample) {
				stopPreview()
				return
			}
			if (!voice.previewUrl) return
			stopPreview()
			const request = previewRequest
			status.textContent = ""
			preview = sample
			sample.textContent = "Loading…"
			audio.src = voice.previewUrl
			try {
				await audio.play()
				if (request !== previewRequest) return
				sample.textContent = "Pause sample"
				sample.setAttribute("aria-label", `Pause sample for ${voice.name}`)
				sample.setAttribute("aria-pressed", "true")
			} catch {
				if (request !== previewRequest) return
				stopPreview()
				status.textContent = "Preview unavailable. Check your connection and try again."
			}
		}
		const action = document.createElement("button")
		const downloading = downloads.get(voice.id)
		action.className = installed.has(voice.id) ? "danger" : "primary"
		action.textContent = downloading
			? "Cancel"
			: installed.has(voice.id)
				? "Delete"
				: voice.unsupported
					? "Unavailable"
					: "Download"
		action.disabled = !!voice.unsupported && !installed.has(voice.id)
		action.setAttribute("aria-label", `${action.textContent} ${voice.name} ${quality}`)
		const progress = document.createElement("progress")
		progress.max = 1
		progress.hidden = !downloading
		progress.value = downloading?.fraction ?? 0
		progress.setAttribute("aria-label", `Downloading ${voice.name}`)
		action.onclick = async () => {
			const running = downloads.get(voice.id)
			if (running) {
				running.controller.abort()
				return
			}
			status.textContent = ""
			if (installed.has(voice.id)) {
				action.disabled = true
				try {
					await deleteVoice(voice.id)
					status.textContent = `${voice.name} deleted.`
				} catch {
					status.textContent = "The voice could not be deleted. Please try again."
				}
				await render()
				return
			}
			const task = { controller: new AbortController(), fraction: 0 }
			downloads.set(voice.id, task)
			action.textContent = "Cancel"
			action.setAttribute("aria-label", `Cancel downloading ${voice.name}`)
			progress.hidden = false
			try {
				await downloadVoice(voice.id, task.controller.signal, (value) => {
					task.fraction = value
					const visible = list.querySelector<HTMLProgressElement>(`[data-voice="${voice.id}"] progress`)
					if (visible) visible.value = value
				})
				const preferences = await browser.storage.local.get("voice")
				if (!preferences.voice) await browser.storage.local.set({ voice: voice.id })
				status.textContent = `${voice.name} is ready. Select text and choose Read selection from the right-click menu.`
			} catch (error) {
				status.textContent = task.controller.signal.aborted
					? "Download cancelled."
					: error instanceof Error
						? /network|fetch/iu.test(error.message)
							? "Download failed. Check your connection and try again."
							: error.message
						: "Download failed."
			} finally {
				downloads.delete(voice.id)
				await render()
			}
		}
		row.append(description, sample, action, progress)
		list.append(row)
	}
}
search.oninput = () => void render()
audio.onended = stopPreview
audio.onerror = () => {
	if (preview && audio.error) {
		stopPreview()
		status.textContent = "Preview unavailable. Check your connection and try again."
	}
}
onVoicesChanged(() => void render())
window.addEventListener("pagehide", () => {
	for (const task of downloads.values()) task.controller.abort()
	stopPreview()
})
void render()
