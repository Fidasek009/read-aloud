import { $ } from "bun"
import { defineConfig } from "wxt"

export default defineConfig({
	srcDir: "src",
	manifestVersion: 3,
	hooks: {
		"build:before": async () => {
			await $`bun scripts/prepare-runtime.ts`.quiet()
		},
	},
	manifest: ({ browser }) => ({
		name: "Read Aloud",
		description: "Read pages and selected text aloud on your device.",
		version: "0.0.0",
		permissions: [
			"activeTab",
			"scripting",
			"contextMenus",
			"storage",
			// Voice models can be large and must remain available offline.
			"unlimitedStorage",
			...(browser === "chrome" ? ["offscreen" as const] : []),
		],
		...(browser === "chrome"
			? {
					// Voice downloads and PCM transport use the typed-array encoding APIs
					// introduced in Chrome 140.
					minimum_chrome_version: "140",
					cross_origin_embedder_policy: { value: "require-corp" as const },
					cross_origin_opener_policy: { value: "same-origin" as const },
				}
			: {}),
		optional_host_permissions: ["https://*/*", "http://*/*", "file:///*"],
		action: { default_title: "Read this page" },
		options_ui: { page: "voices.html", open_in_tab: true },
		web_accessible_resources: [{ resources: ["player.html"], matches: ["<all_urls>"] }],
		content_security_policy: {
			extension_pages:
				"script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; worker-src 'self'; connect-src 'self' http: https: file:",
		},
		...(browser === "firefox"
			? {
					browser_specific_settings: {
						gecko: {
							id: "read-aloud@local.invalid",
							strict_min_version: "140.0",
							data_collection_permissions: { required: ["none"] },
						},
					},
				}
			: {}),
	}),
})
