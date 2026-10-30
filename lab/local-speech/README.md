# Local English/Czech speech experiment

This disposable experiment tests browser-local synthesis under extension CSP. **It is not the product and does not select Supertonic as the production engine.** The upstream Supertonic repository is archived; its model weights have OpenRAIL terms separate from its MIT reference code. See [upstream source provenance](vendor/source.json), [the reference license](vendor/LICENSE), and [the model card](https://huggingface.co/supertone-oss-archive/supertonic-3).

The lab uses current pinned ONNX Runtime Web and one pinned English/Czech-capable model revision. Executable files are bundled locally; model bytes are verified against sizes and SHA-256 hashes. A denied cross-origin fetch, missing model, non-finite/silent audio, or failed speed-duration check causes failure. Models are **not** downloaded during build or synthesis.

## Run

Install the workspace dependencies from the project root with `bun install --frozen-lockfile`. Then, from this directory:

```sh
# Deliberate developer-only provisioning, about 399 MB of model/config/style assets.
bun run assets
bun run typecheck
bun run test
bun run build
bun run probe:chromium cpu
bun run probe:firefox cpu
```

`auto` probes available acceleration; `gpu` requests a GPU-only test and fails if none is usable. A GPU initialization or synthesis failure is intentionally reported rather than counted as verified fallback. The complete production recovery design remains unimplemented.

Chromium automation uses Bun's native WebView/CDP with a fresh isolated browser. Set `BUN_CHROME_PATH` to an unbranded Chromium executable that permits temporary extensions; on this development machine a cached full Chromium executable is available. Firefox automation uses Bun-managed geckodriver/WebDriver and an isolated disposable profile. The driver uses its `--allow-system-access` test capability to execute assertions in the temporary add-on's own page; this is not a production extension permission. `GECKODRIVER` and `FIREFOX_BINARY` can override the Ubuntu snap defaults. These are development drivers, not end-user dependencies.

The probes record browser/runtime/model provenance and write reports/WAVs to ignored `results/`. They deny remote fetches through extension CSP and a worker guard, and apply additional browser network restrictions. No product-page content is used: fixtures are short public English/Czech sample sentences.

## Limits

Synthesis runs in an extension tab. The lab does not implement article/PDF extraction, model-manager UI, persistent background playback, word timestamps/highlighting, auto-scroll, prewarming, or real-time streaming playback. Duration-based speed changes do not resample the waveform, but listening and pitch assessment are still needed. A successful speech result alone is not acceptance of voice quality or near-instant reading.

This machine is a Linux development VM with no exposed physical GPU. Results do not prove Windows, 4-GB GPU, or 4-core/8-GB performance. Preserve failed results as evidence; do not turn smoke-test success into a release claim.
