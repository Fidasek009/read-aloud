# Engineering baseline

Updated: **2026-10-29**. These choices implement the user's explicit tooling requirements and current official extension guidance. They do not establish that the product is finished or that every upstream compatibility claim has been verified.

## Extension framework and language

Use **WXT 0.21.5** with strict TypeScript, following WXT's official entry-point/project layout and browser-target builds. Keep Manifest V3 explicit for both browsers. WXT generates the product manifests; the independent inference lab's manifests are only experimental fixtures. Sources: [WXT project structure](https://wxt.dev/guide/essentials/project-structure.html), [browser targeting](https://wxt.dev/guide/essentials/target-different-browsers.html), [TypeScript configuration](https://wxt.dev/guide/essentials/config/typescript).

Type-check page code and workers against their respective browser environments. Share typed message contracts and validate messages at trust boundaries. Build success does not prove browser behavior or worker/audio lifecycle.

## Bun throughout

**Bun 1.4.4** is the checked baseline and the latest stable release listed by Bun on the research date. The 1.4 release and 1.4.1–1.4.4 release notes were reviewed for current capabilities. Sources: [Bun 1.4](https://bun.com/blog/bun-v1.4), [1.4.1](https://bun.com/blog/bun-v1.4.1), [1.4.2](https://bun.com/blog/bun-v1.4.2), [1.4.3](https://bun.com/blog/bun-v1.4.3), [1.4.4](https://bun.com/blog/bun-v1.4.4).

- One Bun workspace and `bun.lock`; frozen installs for reproducibility.
- WXT runs under Bun, with Bun forced for package executables.
- Native `bun check` for TypeScript, and `bun test` for first-party tests. The TypeScript package serves framework/editor compatibility, not a separate checker process. Source: [Bun type checking](https://bun.com/docs/runtime/check).
- Native `bun fmt` for formatting/import sorting, with tabs, double quotes, no semicolons, LF, and a 120-column width. Ignore Markdown, generated files, and upstream vendor code. Source: [Bun formatter](https://bun.com/docs/format).
- `Bun.build` for the standalone inference experiment; WXT keeps its supported framework pipeline. Source: [Bun bundler](https://bun.com/docs/bundler).
- Bun-native file streams/hashing, shell operations, subprocesses, and Chromium automation in first-party tooling. Do not add replacement packages for built-in capabilities. Source: [Bun WebView](https://bun.com/docs/runtime/webview).

The install configuration intentionally follows `~/projects/talqo/bunfig.toml`: isolated linker, global store, a one-day minimum release age, and matching formatting/import groups. No Tailwind configuration is added without a Tailwind use case.

The browser extension itself uses browser APIs and bundled browser-compatible code. Development-only Bun APIs must never leak into browser entry points.

## UX, accessibility, security, and release guidance

Follow Mozilla's principles for focused extension functionality, contextual actions, clear state, predictable onboarding, and browser integration. Apply them to the selection context menu, playback bar, and deliberate voice download/preview/delete flow. Source: [Mozilla extension UX best practices](https://extensionworkshop.com/documentation/develop/user-experience-best-practices/).

Use supported browser UI surfaces and minimum permissions. The requested in-page bar does not imply access to native browser chrome or protected PDF viewer internals. Source: [Chrome extension UI surfaces](https://developer.chrome.com/docs/extensions/develop/ui).

Bundle executable assets, keep CSP strict, and verify Firefox/Chrome packaging and review policies. Accessibility targets applicable WCAG 2.2 AA criteria, including keyboard access, focus, labels, contrast, and useful status/error feedback. Detailed sources and feasibility gates are in [research.md](research.md).

## Evidence required before release

The development prototype has scoped product probes for local speech, model management, word highlighting, and PDF rendering. These do not prove native entry, complete benchmark fidelity, the 1-second warm / 2-second cold budget, background lifecycle, Windows, physical GPU recovery, or the 4-core/8-GB baseline. See [current acceptance status](feasibility-status.md). All three user benchmark URLs remain mandatory.

## PDF implementation

The approved PDF surface opens in a new extension tab and preserves the original document tab. PDF.js 6.4.299 and its worker, CMaps, standard fonts, image decoders, and license are packaged locally. Only the requested source PDF is fetched; the viewer does not execute document JavaScript. Text runs retain source offsets; visible pages render canvases and text layers as needed. Offscreen word highlights first prepare their target text layer. Native selection matching refuses missing/ambiguous matches instead of silently reading the whole PDF.

The CSP keeps executable code restricted to self, with WASM compilation allowed. PDF loading needs HTTP/HTTPS connections to the user-selected document origin; this is a connection policy, not a permanent host permission. The production manifests retain activeTab-based access. The cached-thesis rendering probe does not prove native PDF activation or cross-origin authenticated fetching in every browser. Sources: [PDF.js examples](https://mozilla.github.io/pdf.js/examples/), [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html).
