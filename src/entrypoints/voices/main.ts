import { browser } from "wxt/browser"

import { localKeys } from "../../extension/storage.ts"
import { languageLabel, qualityLabel, voices } from "../../speech/catalog.ts"
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
const installed = new Set<string>()
const rows = new Map<string, HTMLElement>()
const deleting = new Set<string>()
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
for (const quality of [...new Set(voices.map((voice) => voice.quality))].sort((a, b) =>
	qualityLabel(a).localeCompare(qualityLabel(b)),
))
	qualityFilter.add(new Option(qualityLabel(quality), quality))

async function refreshInstalled() {
	const current = ++renderRevision
	const latest = await installedVoices()
	if (current !== renderRevision) return
	installed.clear()
	for (const id of latest) installed.add(id)
	render()
}
function updateRow(row: HTMLElement, voice: (typeof voices)[number]) {
	const action = row.querySelector<HTMLButtonElement>('[data-action="download"]')!
	const progress = row.querySelector<HTMLProgressElement>("progress")!
	const notice = row.querySelector<HTMLParagraphElement>(".download-status")!
	const downloading = downloads.get(voice.id)
	const outcome = notices.get(voice.id)
	const quality = qualityLabel(voice.quality)
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
	action.disabled = deleting.has(voice.id) || (!!voice.unsupported && !installed.has(voice.id))
	action.setAttribute("aria-label", `${action.textContent} ${voice.name} ${quality}`)
	progress.hidden = !downloading
	if (downloading?.fraction) progress.value = downloading.fraction
	else progress.removeAttribute("value")
	notice.classList.toggle("error", outcome?.error ?? false)
	notice.textContent = outcome?.message ?? ""
	notice.hidden = !outcome
}
function render() {
	const query = search.value.toLocaleLowerCase().trim()
	const shown = sorted.filter(
		(voice) =>
			(!language.value || voice.locale === language.value) &&
			(!qualityFilter.value || voice.quality === qualityFilter.value) &&
			`${voice.name} ${voice.id} ${voice.language} ${voice.nativeLanguage} ${voice.quality}`
				.toLocaleLowerCase()
				.includes(query),
	)
	const resultCount = shown.length
		? `${shown.length} of ${voices.length} models · ${installed.size} downloaded`
		: "No models match these filters."
	if (count.textContent !== resultCount) count.textContent = resultCount
	const shownIds = new Set(shown.map((voice) => voice.id))
	for (const [id, row] of rows) row.hidden = !shownIds.has(id)
	for (const voice of shown) {
		const existing = rows.get(voice.id)
		if (existing) {
			updateRow(existing, voice)
			continue
		}
		const row = document.createElement("section")
		row.dataset.voice = voice.id
		const description = document.createElement("div")
		const title = document.createElement("h2")
		title.textContent = voice.name
		const detail = document.createElement("p")
		const quality = qualityLabel(voice.quality)
		detail.textContent = `${languageLabel(voice)} · ${quality} · ${Math.round(voice.bytes / 1e6)} MB${voice.speakers > 1 ? ` · ${voice.speakers} speakers` : ""}`
		const terms = document.createElement("a")
		terms.className = "terms"
		terms.textContent = "License"
		terms.setAttribute("aria-label", `${voice.name}, ${languageLabel(voice)}, ${quality}: license (opens in a new tab)`)
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
		const progress = document.createElement("progress")
		progress.max = 1
		progress.setAttribute("aria-label", `Downloading ${voice.name}`)
		const notice = document.createElement("p")
		notice.id = `download-status-${voice.id}`
		notice.className = "download-status"
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
				deleting.add(voice.id)
				action.disabled = true
				try {
					await deleteVoice(voice.id, () =>
						browser.storage.local.set({
							[localKeys.voiceChange]: { id: voice.id, deleted: true, revision: crypto.randomUUID() },
						}),
					)
				} catch {
					downloadNotice(voice.id, "The voice could not be deleted. Please try again.", true)
				} finally {
					deleting.delete(voice.id)
				}
				await refreshInstalled()
				return
			}
			const task = { controller: new AbortController(), fraction: 0 }
			downloads.set(voice.id, task)
			action.textContent = "Cancel"
			action.setAttribute("aria-label", `Cancel downloading ${voice.name}`)
			progress.hidden = false
			progress.removeAttribute("value")
			try {
				await downloadVoice(
					voice.id,
					task.controller.signal,
					(value) => {
						task.fraction = value
						const visible = list.querySelector<HTMLProgressElement>(`[data-voice="${voice.id}"] progress`)
						if (visible) visible.value = value
						if (value === 1) downloadNotice(voice.id, "Finishing download…")
					},
					async () => {
						const preferences = await browser.storage.local.get(localKeys.voice)
						await browser.storage.local.set({
							...(!preferences[localKeys.voice] ? { [localKeys.voice]: voice.id } : {}),
							[localKeys.voiceChange]: { id: voice.id, deleted: false, revision: crypto.randomUUID() },
						})
					},
				)
				downloadNotice(voice.id)
			} catch (error) {
				const cancelled =
					task.controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")
				const message = cancelled
					? "Download cancelled."
					: error instanceof DOMException && error.name === "QuotaExceededError"
						? "Not enough storage. Delete a downloaded voice and try again."
						: error instanceof Error
							? error.message
							: "Download failed."
				downloadNotice(voice.id, message, !cancelled)
			} finally {
				downloads.delete(voice.id)
				await refreshInstalled()
			}
		}
		row.append(description, sample, action, progress, notice)
		updateRow(row, voice)
		rows.set(voice.id, row)
		list.append(row)
	}
}
search.oninput = render
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
const stopWatchingVoices = onVoicesChanged((id) => {
	// This page refreshes its own operation once its final button state is ready.
	if (!downloads.has(id) && !deleting.has(id)) void refreshInstalled()
})
window.addEventListener("pagehide", () => {
	stopWatchingVoices()
	for (const task of downloads.values()) task.controller.abort()
	stopPreview()
})
void refreshInstalled()
