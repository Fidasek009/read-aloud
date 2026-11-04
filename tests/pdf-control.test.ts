import { expect, test } from "bun:test"

import { isPdfCommand, isPdfCommandResult, isPdfSelectionToken, pdfSelectionKey } from "../src/reading/pdf-control.ts"

test("PDF runtime commands validate the addressed reader and action", () => {
	const command = { type: "pdf-command", action: "read", tabId: 7, mode: "selection", reveal: false }
	expect(isPdfCommand(command)).toBe(true)
	for (const invalid of [
		{ ...command, tabId: -1 },
		{ ...command, type: "other" },
		{ ...command, mode: "other" },
		{ ...command, reveal: undefined },
	])
		expect(isPdfCommand(invalid)).toBe(false)
	expect(isPdfCommand({ type: "pdf-command", tabId: 7, action: "stop" })).toBe(true)
	expect(isPdfCommandResult({ ok: true })).toBe(true)
	expect(isPdfCommandResult({ ok: false, error: "Select some PDF text first." })).toBe(true)
	expect(isPdfCommandResult({ ok: false })).toBe(false)
	expect(isPdfCommandResult({ ok: "true" })).toBe(false)
})

test("staged PDF selections have separate navigation addresses", () => {
	const first = crypto.randomUUID()
	const second = crypto.randomUUID()
	expect(pdfSelectionKey(7, first)).not.toBe(pdfSelectionKey(7, second))
	expect(pdfSelectionKey(7, first)).not.toBe(pdfSelectionKey(8, first))
	expect(isPdfSelectionToken(first)).toBe(true)
	expect(isPdfSelectionToken("../../other-selection")).toBe(false)
})
