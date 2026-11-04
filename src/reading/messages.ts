import { isReaderRequest, type ReaderRequest } from "./host.ts"

export const readingMessages = {
	reader: "reader",
	start: "start-reading",
	stop: "stop-reading",
	sourceChanged: "read-aloud-source-changed",
} as const

export type ReaderMessage = ReaderRequest & { type: typeof readingMessages.reader }
export type StartReadingMessage = { type: typeof readingMessages.start; mode: "article" | "selection"; reveal: boolean }
export type StopReadingMessage = { type: typeof readingMessages.stop }

export function readerMessage(request: ReaderRequest): ReaderMessage {
	return { type: readingMessages.reader, ...request }
}

export function startReadingMessage(mode: StartReadingMessage["mode"], reveal = false): StartReadingMessage {
	return { type: readingMessages.start, mode, reveal }
}

export function isReaderMessage(value: unknown): value is ReaderMessage {
	return (
		!!value &&
		typeof value === "object" &&
		"type" in value &&
		value.type === readingMessages.reader &&
		isReaderRequest(value)
	)
}

export function isStartReadingMessage(value: unknown): value is StartReadingMessage {
	return (
		!!value &&
		typeof value === "object" &&
		"type" in value &&
		value.type === readingMessages.start &&
		"mode" in value &&
		(value.mode === "selection" || value.mode === "article") &&
		"reveal" in value &&
		typeof value.reveal === "boolean"
	)
}
