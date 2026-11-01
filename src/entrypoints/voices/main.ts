import { browser } from "wxt/browser"

import { languageLabel, voices } from "../../speech/catalog.ts"
import { deleteVoice, downloadVoice, installedVoices, onVoicesChanged } from "../../speech/vault.ts"
import "./style.css"

const list = document.querySelector<HTMLDivElement>("#voices")!
const status = document.querySelector<HTMLParagraphElement>("#status")!
const search = document.querySelector<HTMLInputElement>("#search")!
const language = document.querySelector<HTMLSelectElement>("#language")!
const qualityFilter = document.querySelector<HTMLSelectElement>("#quality")!
const count = document.querySelector<HTMLParagraphElement>("#count")!
const audio = new Audio()
audio.preload = "none"
audio.crossOrigin = "anonymous"
let preview: HTMLButtonElement | undefined
let previewRequest = 0
let renderRevision = 0
const downloads = new Map<string, { controller: AbortController; fraction: number }>()
const notices = new Map<string, { message: string; error: boolean }>()

function downloadNotice(id: string, message?: string, error = false) {
	if (message) notices.set(id, { message, error })
	else notices.delete(id)
	const notice = list.querySelector<HTMLParagraphElement>(`[data-voice="${id}"] .download-status`)
	if (notice) {
		notice.textContent = message ?? ""
		notice.hidden = !message
		notice.classList.toggle("error", error)
	}
}

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
for (const [locale, name] of [...new Map(voices.map((voice) => [voice.locale, languageLabel(voice)]))].sort((a, b) =>
	a[1].localeCompare(b[1]),
)) {
	language.add(new Option(name, locale))
}
async function render() {
	const current = ++renderRevision
	const installed = new Set(await installedVoices())
	if (current !== renderRevision) return
	const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null
	const focusVoice = focused?.closest<HTMLElement>("[data-voice]")?.dataset.voice
	const focusAction = focused?.dataset.action
	stopPreview()
	list.replaceChildren()
	const query = search.value.toLocaleLowerCase().trim()
	const shown = sorted.filter(
		(voice) =>
			(!language.value || voice.locale === language.value) &&
			(!qualityFilter.value || voice.quality === qualityFilter.value) &&
			`${voice.name} ${voice.id} ${voice.language} ${voice.nativeLanguage} ${voice.quality}`
				.toLocaleLowerCase()
				.includes(query),
	)
	count.textContent = shown.length
		? `${shown.length} of ${voices.length} models · ${installed.size} downloaded`
		: "No models match these filters."
	for (const voice of shown) {
		const row = document.createElement("section")
		row.dataset.voice = voice.id
		const description = document.createElement("div")
		const title = document.createElement("h2")
		title.textContent = voice.name
		const detail = document.createElement("p")
		const quality = voice.quality === "x_low" ? "Extra low" : voice.quality[0]!.toUpperCase() + voice.quality.slice(1)
		detail.textContent = `${languageLabel(voice)} · ${quality} · ${Math.round(voice.bytes / 1e6)} MB${voice.speakers > 1 ? ` · ${voice.speakers} speakers` : ""}`
		const terms = document.createElement("a")
		terms.className = "terms"
		terms.textContent = "License"
		terms.setAttribute(
			"aria-label",
			`License and training terms for ${voice.name}, ${voice.language}, ${quality} quality (opens in a new tab)`,
		)
		terms.title = "View license and training terms"
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
		sample.dataset.action = "preview"
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
		action.dataset.action = "download"
		const downloading = downloads.get(voice.id)
		const outcome = notices.get(voice.id)
		action.className = installed.has(voice.id) ? "danger" : "primary"
		action.textContent = downloading
			? "Cancel"
			: installed.has(voice.id)
				? "Delete"
				: voice.unsupported
					? "Unavailable"
					: outcome?.error
						? "Retry"
						: "Download"
		action.disabled = !!voice.unsupported && !installed.has(voice.id)
		action.setAttribute("aria-label", `${action.textContent} ${voice.name} ${quality}`)
		const progress = document.createElement("progress")
		progress.max = 1
		progress.hidden = !downloading
		if (downloading?.fraction) progress.value = downloading.fraction
		else progress.removeAttribute("value")
		progress.setAttribute("aria-label", `Downloading ${voice.name}`)
		const notice = document.createElement("p")
		notice.id = `download-status-${voice.id}`
		notice.className = "download-status"
		notice.classList.toggle("error", outcome?.error ?? false)
		notice.textContent = outcome?.message ?? ""
		notice.hidden = !outcome
		action.setAttribute("aria-describedby", notice.id)
		action.onclick = async () => {
			const running = downloads.get(voice.id)
			if (running) {
				running.controller.abort()
				return
			}
			status.textContent = ""
			downloadNotice(voice.id)
			if (installed.has(voice.id)) {
				action.disabled = true
				try {
					await deleteVoice(voice.id)
					await browser.storage.local.set({
						voiceChange: { id: voice.id, deleted: true, revision: crypto.randomUUID() },
					})
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
			progress.removeAttribute("value")
			try {
				await downloadVoice(voice.id, task.controller.signal, (value) => {
					task.fraction = value
					const visible = list.querySelector<HTMLProgressElement>(`[data-voice="${voice.id}"] progress`)
					if (visible) visible.value = value
					if (value === 1) {
						downloadNotice(voice.id, "Finishing download…")
						status.textContent = `${voice.name}: Finishing download…`
					}
				})
				const preferences = await browser.storage.local.get("voice")
				await browser.storage.local.set({
					...(!preferences.voice ? { voice: voice.id } : {}),
					voiceChange: { id: voice.id, deleted: false, revision: crypto.randomUUID() },
				})
				downloadNotice(voice.id)
				status.textContent = `${voice.name} is ready. Select text and choose Read selection from the right-click menu.`
			} catch (error) {
				const cancelled =
					task.controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")
				const message = task.controller.signal.aborted
					? "Download cancelled."
					: error instanceof DOMException && error.name === "QuotaExceededError"
						? "Not enough storage. Delete a downloaded voice and try again."
						: error instanceof Error
							? /network|fetch/iu.test(error.message)
								? "Download failed. Check your connection and try again."
								: error.message
							: "Download failed."
				downloadNotice(voice.id, message, !cancelled)
				status.textContent = `${voice.name}: ${message}`
			} finally {
				downloads.delete(voice.id)
				await render()
			}
		}
		row.append(description, sample, action, progress, notice)
		list.append(row)
	}
	if (focusVoice && focusAction && focused && !focused.isConnected && document.hasFocus()) {
		list
			.querySelector<HTMLButtonElement>(`[data-voice="${focusVoice}"] [data-action="${focusAction}"]`)
			?.focus({ preventScroll: true })
	}
}
search.oninput = () => void render()
language.onchange = () => {
	language.title = language.selectedOptions[0]?.textContent ?? "All languages"
	void render()
}
qualityFilter.onchange = () => void render()
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
