/** Only browser-supplied MessageSender fields belong in this check, never message payload fields. */
interface ExtensionSender {
	id?: string
	url?: string
	tab?: unknown
}

export function isExtensionPageSender(
	sender: ExtensionSender | undefined,
	extensionId: string,
	extensionRoot: string,
	paths: readonly string[],
): boolean {
	if (sender?.id !== extensionId || !sender.url) return false
	try {
		const url = new URL(sender.url)
		const own = new URL(extensionRoot)
		return (
			url.protocol === own.protocol &&
			url.host === own.host &&
			!url.username &&
			!url.password &&
			paths.includes(url.pathname)
		)
	} catch {
		return false
	}
}

/** Background workers/pages have no tab and can omit URL in browser-supplied sender metadata. */
export function isExtensionBackgroundSender(
	sender: ExtensionSender | undefined,
	extensionId: string,
	extensionRoot: string,
): boolean {
	if (sender?.id !== extensionId || sender.tab !== undefined) return false
	return (
		!sender.url ||
		isExtensionPageSender(sender, extensionId, extensionRoot, ["/background.js", "/_generated_background_page.html"])
	)
}
