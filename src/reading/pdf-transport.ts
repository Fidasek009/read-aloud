import { browser } from "wxt/browser"

import { isPdfCommandResult, type PdfAction, type PdfCommand } from "./pdf-control.ts"

/** Extension pages receive runtime messages; only the addressed PDF page responds. */
export async function commandPdf(tabId: number, action: PdfAction): Promise<void> {
	const command: PdfCommand = { type: "pdf-command", tabId, ...action }
	const result: unknown = await browser.runtime.sendMessage(command)
	if (!isPdfCommandResult(result)) throw new Error("The PDF reader did not respond. Open it again to retry.")
	if (!result.ok) throw new Error(result.error)
}
