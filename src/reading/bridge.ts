import type { ReaderHost } from "./host.ts"

declare global {
	interface Window {
		readAloudHost?: ReaderHost
	}
}

export function parentReaderHost(): ReaderHost | undefined {
	try {
		return window.parent !== window ? window.parent.readAloudHost : undefined
	} catch {
		return undefined
	} // The ordinary web-page parent is cross-origin.
}
