export interface ReaderRequest {
	session: string
	command: "document" | "selection" | "highlight" | "resize" | "close"
	start?: number
	end?: number
	height?: number
	width?: number
}

export type ReaderHost = (message: ReaderRequest) => Promise<unknown>

export interface ReaderChange {
	session: string
	revision: string
}

export function isReaderChange(value: unknown): value is ReaderChange {
	return (
		!!value &&
		typeof value === "object" &&
		"session" in value &&
		typeof value.session === "string" &&
		value.session.length <= 80 &&
		"revision" in value &&
		typeof value.revision === "string" &&
		value.revision.length <= 80
	)
}

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
