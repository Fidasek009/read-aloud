import { expect, test } from "bun:test"

import {
	isPdfCommand,
	isPdfCommandResult,
	isPdfSelectionToken,
	pdfCommandKey,
	pdfSelectionKey,
} from "../src/reading/pdf-control.ts"

test("PDF commands have independent request keys and validate acknowledgements", () => {
	const revision = crypto.randomUUID()
	const command = { action: "read", tabId: 7, revision, mode: "selection", reveal: false }
	expect(isPdfCommand(command)).toBe(true)
	expect(isPdfCommand({ ...command, revision: "" })).toBe(false)
	expect(isPdfCommand({ ...command, mode: "other" })).toBe(false)
	expect(pdfCommandKey(7, revision)).not.toBe(pdfCommandKey(8, revision))
	expect(pdfCommandKey(7, revision)).not.toBe(pdfCommandKey(7, crypto.randomUUID()))
	expect(isPdfCommandResult({ ok: true })).toBe(true)
	expect(isPdfCommandResult({ ok: false, error: "Select some PDF text first." })).toBe(true)
	expect(isPdfCommandResult({ ok: false })).toBe(false)
	expect(isPdfCommandResult({ ok: "true" })).toBe(false)
})

test("each PDF navigation owns its staged selection and rejects invalid tokens", () => {
	const first = crypto.randomUUID()
	const second = crypto.randomUUID()
	const pending = new Map([
		[pdfSelectionKey(7, first), "first selection"],
		[pdfSelectionKey(7, second), "second selection"],
	])
	pending.delete(pdfSelectionKey(7, first))
	expect(pending.get(pdfSelectionKey(7, second))).toBe("second selection")
	expect(isPdfSelectionToken(first)).toBe(true)
	expect(isPdfSelectionToken("../../other-selection")).toBe(false)
	expect(pdfSelectionKey(7)).toBe("pdfSelection:7")
})
