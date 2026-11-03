export type PdfAction = { action: "stop" } | { action: "read"; mode: "article" | "selection"; reveal: boolean }
export type PdfCommand = PdfAction & { tabId: number; revision: string }
export type PdfCommandResult = { ok: true } | { ok: false; error: string }

export function pdfCommandKey(tabId: number, revision: string): string {
	return `pdfCommand:${tabId}:${revision}`
}

export function isPdfCommandResult(value: unknown): value is PdfCommandResult {
	return (
		!!value &&
		typeof value === "object" &&
		"ok" in value &&
		(value.ok === true || (value.ok === false && "error" in value && typeof value.error === "string"))
	)
}

export function pdfSelectionKey(tabId: number, token?: string): string {
	return `pdfSelection:${tabId}${token ? `:${token}` : ""}`
}

export function isPdfSelectionToken(token: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(token)
}

export function isPdfCommand(value: unknown): value is PdfCommand {
	if (
		!value ||
		typeof value !== "object" ||
		!("tabId" in value) ||
		!Number.isSafeInteger(value.tabId) ||
		!("revision" in value) ||
		typeof value.revision !== "string" ||
		!isPdfSelectionToken(value.revision) ||
		!("action" in value)
	)
		return false
	return (
		value.action === "stop" ||
		(value.action === "read" &&
			"mode" in value &&
			(value.mode === "article" || value.mode === "selection") &&
			"reveal" in value &&
			typeof value.reveal === "boolean")
	)
}
