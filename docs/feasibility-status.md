# Implementation and acceptance status

A working development prototype exists; the requested release is **not complete**.

## Implemented

- WXT Manifest V3 packages, strict TypeScript, and Bun-only installs, builds, native checks, formatting, and tests.
- Explicit voice download, hash verification, cancellation, deletion, and on-demand remote prerecorded previews. No voice model is included in the package or downloaded on startup.
- Selection/article capture with DOM offsets, an in-page playback bar, sentence controls, voice choice, model-duration speed control, acoustic word timing, highlighting, and scrolling.
- Browser-local Piper inference with Spellophone/eSpeak NG phonemes, separate GPU/CPU workers, and CPU retry after an acceleration failure. A reusable extension-owned host preserves a loaded model across reader lifetimes; Chrome uses an isolated offscreen document, Firefox its background page. The pinned catalog contains 178 models across 58 locale codes, including quality variants and multispeaker choices. Seven require missing pronunciation engines and are visibly unavailable. Supported-format models still need broad inference/quality/license acceptance; catalog inclusion is not clearance.
- A new-tab PDF reader using bundled PDF.js, keeping the original tab. Visible page canvases are bounded; text layers are created as needed, including when playback highlights a distant page. Selection matching preserves source offsets and refuses ambiguous/missing matches instead of reading the whole PDF.

## Verification in this environment

The Chrome product probe exercises explicit download, storage, local synthesis, source-word highlighting, pause, close, deletion, selection recovery, and PDF/word mapping. Programmatic entry required a trusted Play gesture. The Firefox product probe passes the equivalent Czech flow with a private virtual audio sink and normal autoplay settings. This VM has no hardware audio output; without the sink Firefox's audio clock remained at zero. The sink is test infrastructure, not an end-user helper.

Product probes use isolated profiles and narrow test-only origin grants (localhost plus MD Dash or MUNI as appropriate). They **do not prove native context-menu/action activation or activeTab behavior**. No product reading text is logged.

The supplied thesis has been fetched from the live MUNI URL in browser tests with an explicit test-origin grant: **60 pages**, SHA-256 `30b7977a1a52b029a691ad75b4b425162cf3570f5c94de9858ece7464f494c32`. The PDF probes verify missing-site-access recovery, fetching without CORS, mapping, highlighting, and cross-page local synthesis; product probes also exercise playback from a simulated native-viewer selection. They do not prove native menu activation, every paragraph's reading order, tables, citations, or accessibility.

## Acceptance still open

- **Latency:** medium models must start within **1 second warm / 2 seconds cold** on the specified 4-core machine. Current measured cold speech startup exceeds that budget. No passing latency claim is justified.
- **Automatic native entry:** selection → right-click must start speech without a second Play action. Verify actual browser entry and resolve autoplay restrictions without weakening privacy or requiring a helper.
- **All three benchmarks:** MD Dash now passes actual-page sentence navigation, including Previous after several Next operations. Full listening/extraction acceptance on both HTML articles and the complete thesis remains open.
- **Lifecycle:** verify tab switching, navigation/closure, cross-tab replacement, interrupted model loading, speed/voice changes, source mutations, and stale-work cancellation. Implemented handlers alone are insufficient evidence.
- **GPU/CPU and platforms:** no physical GPU or Windows machine has been tested. Verify GPU correctness, device loss, CPU fallback, memory, and the 4-core/8-GB baseline.
- **Speech and catalog:** listen to speed/quality variants, validate pitch, test normalized numbers/abbreviations and mixed scripts, and clear additional supported languages/voice variants. Only basic fixtures have timing evidence.
- **UI/accessibility:** visual checks and some keyboard interaction exist; complete keyboard, focus, contrast, assistive-technology, responsive layout, and recovery checks remain.
- **Licensing/distribution:** original source remains MIT. Spellophone/eSpeak NG impose GPL obligations on the combined distribution; complete corresponding-source packaging remains open. Jirka's Lessac training provenance requires clearance. See [licensing.md](licensing.md) and [NOTICE.md](../NOTICE.md).

Keep these gates open until evidence covers the actual requirement. Do not equate a build, a scripted smoke test, or a rendered PDF with the finished product.
