import { expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { publishFirefox } from "../scripts/firefox-publishing"

const extensionId = "read-aloud@fidasek009.github.io"
const issuer = "user:123:456"
const secret = "test-only-secret"

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "firefox-publish-test-"))
	for (const file of [
		"store/listing.md",
		"NOTICE.md",
		"LICENSE",
		"PRIVACY.md",
		"vendor/espeak-ng/licenses/COPYING",
		"store/assets/icon-128.png",
		"store/assets/voices-english.png",
		"store/assets/voices-czech.png",
	])
		await Bun.write(join(root, file), Bun.file(file))
	await Bun.write(
		join(root, "manifest.json"),
		JSON.stringify({
			manifest_version: 3,
			version: "0.1.0",
			browser_specific_settings: { gecko: { id: extensionId } },
		}),
	)
	await Bun.write(join(root, ".output/README.txt"), "Reviewer build instructions")
	await Bun.$`zip -q .output/read-aloud-0.1.0-firefox.zip manifest.json`.cwd(root).quiet()
	await Bun.$`zip -q read-aloud-0.1.0-sources.zip README.txt`.cwd(join(root, ".output")).quiet()
	return root
}

interface MockState {
	exists?: boolean
	profileStatus?: number
	listingStatus?: number
	agreed?: boolean
	privateAccess?: boolean
	valid?: boolean
	sourceFailure?: boolean
}

async function withAmo(
	state: MockState,
	run: (context: {
		root: string
		base: string
		requests: string[]
		metadata: Record<string, unknown>[]
	}) => Promise<void>,
) {
	const root = await fixture()
	const requests: string[] = []
	const metadata: Record<string, unknown>[] = []
	const previews = state.exists
		? [
				{ id: 1, position: 1 },
				{ id: 2, position: 2 },
			]
		: []
	const key = await crypto.subtle.importKey(
		"raw",
		new TextEncoder().encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["verify"],
	)
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		async fetch(request) {
			const path = decodeURIComponent(new URL(request.url).pathname.replace("/api/v5/", ""))
			requests.push(`${request.method} ${path}`)
			const jwt = request.headers.get("Authorization")?.replace("JWT ", "").split(".") ?? []
			expect(jwt).toHaveLength(3)
			const claims = JSON.parse(Buffer.from(jwt[1]!, "base64url").toString())
			expect(claims.iss).toBe(issuer)
			expect(claims.exp).toBeGreaterThan(Date.now() / 1000)
			expect(claims.exp - claims.iat).toBeLessThanOrEqual(300)
			expect(
				await crypto.subtle.verify(
					"HMAC",
					key,
					Buffer.from(jwt[2]!, "base64url"),
					new TextEncoder().encode(`${jwt[0]}.${jwt[1]}`),
				),
			).toBe(true)
			if (path === "accounts/profile/")
				return Response.json(
					{ id: 123, read_dev_agreement: state.agreed ?? true },
					{ status: state.profileStatus ?? 200 },
				)
			const addon = `addons/addon/${extensionId}/`
			if (path === addon && request.method === "GET")
				return Response.json(
					{ guid: extensionId, ...(state.privateAccess === false ? {} : { channels: ["listed"] }), previews },
					{ status: state.listingStatus ?? (state.exists ? 200 : 404) },
				)
			if (path === "addons/upload/" && request.method === "POST") {
				const data = await request.formData()
				expect(data.get("channel")).toBe("listed")
				const uploaded = data.get("upload") as File
				expect(await uploaded.arrayBuffer()).toEqual(
					await Bun.file(join(root, ".output/read-aloud-0.1.0-firefox.zip")).arrayBuffer(),
				)
				return Response.json({ uuid: "test-upload" }, { status: 201 })
			}
			if (path === "addons/upload/test-upload/")
				return Response.json({
					uuid: "test-upload",
					processed: true,
					valid: state.valid ?? true,
					validation: { errors: 0, warnings: 0, notices: 0 },
				})
			if (path === addon && request.method === "PUT") {
				metadata.push(await request.json())
				state.exists = true
				return Response.json({ guid: extensionId, version: { id: 7, edit_url: "https://example.invalid/review" } })
			}
			if (path === `${addon}versions/7/` && request.method === "PATCH") {
				const source = (await request.formData()).get("source") as File
				expect(await source.arrayBuffer()).toEqual(
					await Bun.file(join(root, ".output/read-aloud-0.1.0-sources.zip")).arrayBuffer(),
				)
				return Response.json({}, { status: state.sourceFailure ? 500 : 200 })
			}
			if (path === addon && request.method === "PATCH") {
				if (request.headers.get("Content-Type")?.includes("application/json")) metadata.push(await request.json())
				else expect((await request.formData()).get("icon")).toBeInstanceOf(File)
				return Response.json({})
			}
			if (path === `${addon}eula_policy/`) {
				expect(await request.json()).toEqual({ privacy_policy: { "en-US": await Bun.file("PRIVACY.md").text() } })
				return Response.json({})
			}
			if (path === `${addon}previews/` && request.method === "POST") {
				const data = await request.formData()
				expect(data.get("image")).toBeInstanceOf(File)
				const preview = { id: previews.length + 1, position: Number(data.get("position")) }
				previews.push(preview)
				return Response.json(preview, { status: 201 })
			}
			if (path.startsWith(`${addon}previews/`) && request.method === "PATCH") return Response.json({})
			return Response.json({ error: `Unexpected ${request.method} ${path}` }, { status: 500 })
		},
	})
	try {
		await run({ root, base: new URL("api/v5/", server.url).href, requests, metadata })
	} finally {
		await server.stop(true)
		await rm(root, { recursive: true, force: true })
	}
}

test.each([false, true])(
	"Firefox dry-run authenticates with an existing listing=%s and never writes",
	async (exists) => {
		await withAmo({ exists }, async ({ root, base, requests }) => {
			await publishFirefox({ version: "0.1.0", dryRun: true, extensionId, issuer, secret, root }, base)
			expect(requests).toEqual(["GET accounts/profile/", `GET addons/addon/${extensionId}/`])
		})
	},
)

test.each([false, true])("Mozilla client creates/updates listing=%s and submits exact CI archives", async (exists) => {
	await withAmo({ exists }, async ({ root, base, requests, metadata }) => {
		await publishFirefox({ version: "0.1.0", dryRun: false, extensionId, issuer, secret, root }, base)
		expect(metadata[0]).toMatchObject({
			name: { "en-US": "Read Aloud" },
			categories: { firefox: ["other"] },
			version: {
				upload: "test-upload",
				compatibility: ["firefox"],
				custom_license: { name: { "en-US": "MIT source; GPL-3.0-or-later combined distribution" } },
			},
		})
		expect(JSON.stringify(metadata[0])).toContain("/blob/v0.1.0/SOURCE_CODE_REVIEW.md")
		expect(JSON.stringify(metadata[0])).not.toContain('"license":"MIT"')
		expect(metadata[1]).not.toHaveProperty("version")
		expect(requests).toContain(`PATCH addons/addon/${extensionId}/versions/7/`)
		expect(requests.filter((item) => item === `POST addons/addon/${extensionId}/previews/`)).toHaveLength(
			exists ? 0 : 2,
		)
		// Approval is asynchronous; the pipeline must not wait for store review.
		expect(requests).not.toContain(`GET addons/addon/${extensionId}/versions/7/`)
	})
})

test.each([{ profileStatus: 401 }, { agreed: false }, { listingStatus: 503 }, { exists: true, privateAccess: false }])(
	"Firefox preflight fails closed before uploads: %j",
	async (state) => {
		await withAmo(state, async ({ root, base, requests }) => {
			await expect(
				publishFirefox({ version: "0.1.0", dryRun: true, extensionId, issuer, secret, root }, base),
			).rejects.toThrow()
			expect(requests.every((item) => item.startsWith("GET "))).toBe(true)
		})
	},
)

test("invalid AMO validation stops before creating a version", async () => {
	await withAmo({ valid: false }, async ({ root, base, requests }) => {
		await expect(
			publishFirefox({ version: "0.1.0", dryRun: false, extensionId, issuer, secret, root }, base),
		).rejects.toThrow("Validation failed")
		expect(requests.some((item) => item.startsWith("PUT "))).toBe(false)
	})
})

test("a failed reviewer-source upload fails publication", async () => {
	await withAmo({ sourceFailure: true }, async ({ root, base }) => {
		await expect(
			publishFirefox({ version: "0.1.0", dryRun: false, extensionId, issuer, secret, root }, base),
		).rejects.toThrow("Uploading source failed")
	})
})

test("wrong package identity or missing sources fail before accessing AMO", async () => {
	await withAmo({}, async ({ root, base, requests }) => {
		await expect(
			publishFirefox(
				{ version: "0.1.0", dryRun: true, extensionId: "different@example.invalid", issuer, secret, root },
				base,
			),
		).rejects.toThrow("permanent ID")
		await Bun.file(join(root, ".output/read-aloud-0.1.0-sources.zip")).delete()
		await expect(
			publishFirefox({ version: "0.1.0", dryRun: true, extensionId, issuer, secret, root }, base),
		).rejects.toThrow("sources are missing")
		expect(requests).toHaveLength(0)
	})
})
