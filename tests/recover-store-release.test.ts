import { expect, test } from "bun:test"

import { verifyChromeSubmission } from "../scripts/recover-store-release"

test.each(["PENDING_REVIEW", "PUBLISHED"])("recovery accepts matching Chrome %s without uploading", async (state) => {
	let calls = 0
	const request = (async (url, options) => {
		calls++
		expect(String(url)).toEndWith(":fetchStatus")
		expect(options?.method ?? "GET").toBe("GET")
		return Response.json({
			itemId: "extension",
			submittedItemRevisionStatus: { state, distributionChannels: [{ crxVersion: "0.1.1" }] },
		})
	}) as typeof fetch
	await verifyChromeSubmission("0.1.1", "test-token", "publisher", "extension", request)
	expect(calls).toBe(1)
})

test.each([
	{},
	{ submittedItemRevisionStatus: { state: "DRAFT", distributionChannels: [{ crxVersion: "0.1.1" }] } },
	{ submittedItemRevisionStatus: { state: "PENDING_REVIEW", distributionChannels: [{ crxVersion: "0.1.0" }] } },
	{
		takenDown: true,
		submittedItemRevisionStatus: { state: "PUBLISHED", distributionChannels: [{ crxVersion: "0.1.1" }] },
	},
])("recovery withholds GitHub publication for Chrome draft, wrong version or takedown: %j", async (details) => {
	const request = (async () => Response.json({ itemId: "extension", ...details })) as unknown as typeof fetch
	await expect(verifyChromeSubmission("0.1.1", "test-token", "publisher", "extension", request)).rejects.toThrow(
		"not submitted",
	)
})
