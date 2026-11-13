import { browser } from "wxt/browser"

/** Permission prompts stay attached to trusted clicks; every pending UI wait is abortable. */
function askAccess({
	status,
	signal,
	message,
	label,
	request,
	allowFileChoice = false,
}: {
	status: HTMLElement
	signal: AbortSignal
	message: string
	label: string
	request: (explain: (message: string) => void) => Promise<Response | undefined>
	allowFileChoice?: boolean
}): Promise<Response | undefined> {
	signal.throwIfAborted()
	const explanation = document.createTextNode(message)
	const allow = document.createElement("button")
	allow.textContent = label
	status.replaceChildren(explanation, " ", allow)
	return new Promise((resolve, reject) => {
		const abort = () => {
			cleanup()
			reject(signal.reason)
		}
		const finish = (response: Response | undefined) => {
			cleanup()
			resolve(response)
		}
		const cleanup = () => {
			signal.removeEventListener("abort", abort)
			allow.onclick = null
			if (fallback) fallback.onclick = null
		}
		const fallback = allowFileChoice ? document.createElement("button") : undefined
		if (fallback) {
			fallback.textContent = "Choose file instead"
			fallback.onclick = () => finish(undefined)
			status.append(" ", fallback)
		}
		signal.addEventListener("abort", abort, { once: true })
		allow.onclick = () => {
			allow.disabled = true
			void request((message) => {
				explanation.textContent = message + " "
			})
				.then((response) => {
					if (response) finish(response)
				})
				.catch(() => {
					explanation.textContent = "Access could not be granted. Check your browser’s extension settings. "
				})
				.finally(() => {
					allow.disabled = false
					allow.textContent = "Try again"
				})
		}
	})
}

async function chooseFile(status: HTMLElement, signal: AbortSignal): Promise<Response> {
	signal.throwIfAborted()
	status.textContent =
		import.meta.env.BROWSER === "firefox"
			? "Firefox could not read this local file directly. Choose this PDF to read it on your device."
			: "Choose this PDF to open it locally."
	const input = document.createElement("input")
	input.type = "file"
	input.accept = "application/pdf,.pdf"
	input.setAttribute("aria-label", "Choose PDF")
	status.append(" ", input)
	const file = await new Promise<File>((resolve, reject) => {
		const abort = () => {
			input.onchange = null
			reject(signal.reason)
		}
		signal.addEventListener("abort", abort, { once: true })
		input.onchange = () => {
			const selected = input.files?.[0]
			if (!selected) return
			signal.removeEventListener("abort", abort)
			input.onchange = null
			resolve(selected)
		}
	})
	status.textContent = "Opening PDF…"
	return new Response(file)
}

async function localPdf(url: URL, signal: AbortSignal, status: HTMLElement): Promise<Response> {
	const read = () => fetch(url, { signal })
	try {
		const response = await read()
		if (response.ok) return response
	} catch {
		signal.throwIfAborted()
	}
	if (import.meta.env.BROWSER !== "firefox") {
		const response = await askAccess({
			status,
			signal,
			message: "Allow local file access to open this PDF directly.",
			label: "Allow local file access",
			async request(explain) {
				const granted = await browser.permissions.request({ origins: ["file:///*"] })
				if (!granted) return undefined
				try {
					const response = await read()
					if (response.ok) return response
				} catch {
					signal.throwIfAborted()
				}
				const allowed = await browser.extension.isAllowedFileSchemeAccess()
				explain(
					allowed
						? "The browser blocked reading this local file directly."
						: "Enable local file access for Syllune in your browser's extension settings, then try again.",
				)
				return undefined
			},
			allowFileChoice: true,
		})
		if (response) {
			status.textContent = "Opening PDF…"
			return response
		}
	}
	return chooseFile(status, signal)
}

export async function fetchPdf(url: URL, signal: AbortSignal, status: HTMLElement): Promise<Response> {
	if (url.protocol === "file:") return localPdf(url, signal, status)
	const load = () =>
		fetch(url, {
			credentials: "include",
			referrerPolicy: "no-referrer",
			signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
		})
	try {
		return await load()
	} catch (cause) {
		signal.throwIfAborted()
		const origins = [`${url.protocol}//${url.hostname}/*`]
		if (await browser.permissions.contains({ origins }))
			throw new Error("The PDF could not be reached. Check your connection and the original PDF tab, then try again.", {
				cause,
			})
		// activeTab belongs to the source tab; a new reader needs its own host grant.
		const response = await askAccess({
			status,
			signal,
			message: `Allow access to ${url.hostname} to open this PDF.`,
			label: "Allow access and open PDF",
			async request(explain) {
				if (!(await browser.permissions.request({ origins }))) {
					explain(`Access to ${url.hostname} is needed to open this PDF.`)
					return undefined
				}
				try {
					return await load()
				} catch {
					signal.throwIfAborted()
					explain("The PDF could not be reached. Open it on its original site, then try again.")
					return undefined
				}
			},
		})
		if (!response) throw new Error("The PDF could not be opened.")
		status.textContent = "Opening PDF…"
		return response
	}
}
