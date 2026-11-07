# AMO runtime corrections — 2026-11-07

All seven reported warnings are removed in the rebuilt Firefox MV3 package.
Local `web-ext` 10.8.0 lint reports 0 errors, 0 warnings, 0 notices. This is
local validation, not a claim of AMO review acceptance.

## Implementation

`scripts/runtime-adapters.ts` applies build-time adaptations without mutating
installed dependencies or WASM binaries. ONNX module imports accept only the
expected extension-local URL and import a literal module path. PDF.js's fake
worker, our worker diagnostic, and the two fallback decoders use literal
packaged imports. Unexpected decoder names fail instead of selecting another
script. ONNX's Emval caller uses a closure, preserving argument conversion order,
method receivers, constructor behavior, void returns and destructor/return
conversion. Its upstream source hash is checked before replacement. Changed
upstream patterns fail the build and require another review.

Firefox's minimum is 142; no Android compatibility declaration was added.
CSP still excludes JavaScript eval. This is a local adaptation of the pinned
runtime, not a new upstream runtime build or a dependency license change.

References checked:

- [Mozilla data consent and browser versions](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)
- [Emscripten dynamic execution setting and closure fallback](https://emscripten.org/docs/tools_reference/settings_reference.html#dynamic-execution)
- Pinned ONNX Runtime 1.31.1 `lib/wasm/wasm-utils-import.ts` and
  `dist/ort-wasm-simd-threaded.asyncify.mjs`.
- Pinned PDF.js 6.5.438 `build/pdf.mjs` and `build/pdf.worker.mjs`.

## Verification and limits

- Firefox and Chrome production builds passed.
- `bun run typecheck`, `bun run format:check`: passed.
- `bun test tests`: 162 passed, including 16 differential binding cases against
  the original generated caller, plus the adapter checks.
- Firefox Linux product probe, with a test-only host grant, cached thesis and a
  PulseAudio null sink: Czech model download/persistence, real worker playback,
  highlighting, media controls, speed/volume, pause, close and deletion passed.
  The full probe then failed on thesis range highlighting (2120–3600).
- Chromium Linux host probe with cached English model: actual CPU synthesis
  produced 49,920 samples and six aligned words. Broker GPU-failure policy,
  retained/closed host behavior and preparation leases passed.
- Chromium PDF probe opened and indexed the thesis, then failed on the same
  range-highlighting check before its speech checks. The full Chromium product
  probe stopped at its stale-preference voice-picker assertion. Whether these
  failures predate this patch has not been established; do not report the full
  product/PDF suites as passing.
- Chromium probes required a disposable launcher adding `--headless=new` and
  `--no-sandbox` in this container; production packaging is unaffected.
- Hardware GPU execution, Windows, physical audio quality, and target-device
  latency were not verified. Binding equivalence tests do not establish those.

The Firefox probe now derives its fixture UUID mapping from the built manifest's
actual extension ID; the previous hard-coded ID prevented the probe from finding
the extension's page with release-identity builds.
