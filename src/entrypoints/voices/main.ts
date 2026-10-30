import { browser } from "wxt/browser"

import { voices } from "../../speech/catalog.ts"
import { deleteVoice, downloadVoice, installedVoices, onVoicesChanged } from "../../speech/vault.ts"
import "./style.css"

const list = document.querySelector<HTMLDivElement>("#voices")!
const status = document.querySelector<HTMLParagraphElement>("#status")!
const audio = new Audio()
audio.preload = "none"
audio.crossOrigin = "anonymous"
let preview: HTMLButtonElement | undefined
let previewRequest = 0
const downloads = new Map<string, AbortController>()

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

async function render() {
	stopPreview()
	const installed = new Set(await installedVoices())
	list.replaceChildren()
	for (const voice of voices) {
		const row = document.createElement("section")
		const description = document.createElement("div")
		const title = document.createElement("h2")
		title.textContent = voice.name
		const detail = document.createElement("p")
		detail.textContent = `${voice.language} · Medium · ${Math.round(voice.bytes / 1e6)} MB`
		description.append(title, detail)
		const sample = document.createElement("button")
		sample.textContent = "Listen"
		sample.dataset.voiceName = voice.name
		sample.setAttribute("aria-label", `Listen to ${voice.name}`)
		sample.setAttribute("aria-pressed", "false")
		sample.onclick = async () => {
			if (preview === sample) {
				stopPreview()
				return
			}
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
		action.className = "primary"
		action.textContent = installed.has(voice.id) ? "Delete" : "Download"
		action.setAttribute("aria-label", `${action.textContent} ${voice.name}`)
		const progress = document.createElement("progress")
		progress.max = 1
		progress.hidden = true
		progress.setAttribute("aria-label", `Downloading ${voice.name}`)
		action.onclick = async () => {
			if (downloads.has(voice.id)) {
				downloads.get(voice.id)!.abort()
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
			const controller = new AbortController()
			downloads.set(voice.id, controller)
			action.textContent = "Cancel"
			action.setAttribute("aria-label", `Cancel downloading ${voice.name}`)
			progress.hidden = false
			try {
				await downloadVoice(voice.id, controller.signal, (value) => {
					progress.value = value
				})
				const preferences = await browser.storage.local.get("voice")
				if (!preferences.voice) await browser.storage.local.set({ voice: voice.id })
				status.textContent = `${voice.name} is ready. Select text and choose Read selection from the right-click menu.`
			} catch (error) {
				status.textContent = controller.signal.aborted
					? "Download cancelled."
					: error instanceof Error
						? error.message
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
audio.onended = stopPreview
audio.onerror = () => {
	if (preview && audio.error) {
		stopPreview()
		status.textContent = "Preview unavailable. Check your connection and try again."
	}
}
onVoicesChanged(() => {
	if (!downloads.size) void render()
})
window.addEventListener("pagehide", () => {
	for (const controller of downloads.values()) controller.abort()
	stopPreview()
})
void render()
