export interface ReaderRequest {
	session: string
	command: "document" | "selection" | "highlight" | "resize" | "close"
	start?: number
	end?: number
	height?: number
	width?: number
}

export type ReaderHost = (message: ReaderRequest) => Promise<unknown>

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
