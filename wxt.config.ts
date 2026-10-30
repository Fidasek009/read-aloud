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
		description: "Natural speech on your device. Firefox and Chrome.",
		version: "0.0.0",
		permissions: [
			"activeTab",
			"scripting",
			"contextMenus",
			"storage",
			...(browser === "chrome" ? ["offscreen" as const] : []),
		],
		...(browser === "chrome"
			? {
					cross_origin_embedder_policy: { value: "require-corp" as const },
					cross_origin_opener_policy: { value: "same-origin" as const },
				}
			: {}),
		optional_host_permissions: ["https://*/*", "http://*/*"],
		action: { default_title: "Read this page" },
		options_ui: { page: "voices.html", open_in_tab: true },
		web_accessible_resources: [{ resources: ["player.html"], matches: ["<all_urls>"] }],
		content_security_policy: {
			extension_pages:
				"script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; worker-src 'self'; connect-src 'self' http: https:",
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
