export type PdfAction = { action: "stop" } | { action: "read"; mode: "article" | "selection"; reveal: boolean }
export type PdfCommand = PdfAction & { tabId: number; revision: string }

export function isPdfCommand(value: unknown): value is PdfCommand {
	if (
		!value ||
		typeof value !== "object" ||
		!("tabId" in value) ||
		!Number.isSafeInteger(value.tabId) ||
		!("revision" in value) ||
		typeof value.revision !== "string" ||
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
