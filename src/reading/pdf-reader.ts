/** Match our reader document, optionally restricted to the original source document and tab. */
export function isPdfReaderUrl(
	value: string | undefined,
	extensionRoot: string,
	sourceUrl?: string,
	sourceTab?: number,
): boolean {
	if (!value) return false
	try {
		const url = new URL(value)
		const own = new URL(extensionRoot)
		if (url.protocol !== own.protocol || url.host !== own.host || url.pathname !== "/pdf.html") return false
		const rawSource = url.searchParams.get("src")
		if (!rawSource) return false
		const actualSource = new URL(rawSource)
		if (actualSource.protocol !== "https:" && actualSource.protocol !== "http:" && actualSource.protocol !== "file:")
			return false
		if (sourceUrl) {
			const expectedSource = new URL(sourceUrl)
			actualSource.hash = expectedSource.hash = ""
			if (actualSource.href !== expectedSource.href) return false
		}
		const originalTab = url.searchParams.get("source")
		if (!originalTab || !/^(?:0|[1-9]\d*)$/u.test(originalTab)) return false
		return sourceTab === undefined || originalTab === String(sourceTab)
	} catch {
		return false
	}
}

export function isPdfReaderContext(
	context: { tabId: number; frameId: number; documentUrl?: string | undefined },
	tabId: number,
	extensionRoot: string,
	sourceUrl?: string,
	sourceTab?: number,
): boolean {
	return (
		context.tabId === tabId &&
		context.frameId === 0 &&
		isPdfReaderUrl(context.documentUrl, extensionRoot, sourceUrl, sourceTab)
	)
}
