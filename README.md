# Read Aloud

A Firefox and Chrome extension in development: natural local speech, mandatory US English and Czech, explicit model ownership, and an intentionally small Edge-like reading interface.

The current extension is a **development prototype** with explicit voice management, a small in-page playback bar, selection/article capture, a PDF reader in a new tab, and local Piper inference. It is not release-ready: native-entry autoplay, cold startup, PDF acceptance, model provenance, and GPU/Windows acceptance remain open. See [AGENTS.md](AGENTS.md) for product principles and [the product brief](docs/product-brief.md) for the latest confirmed requirements, including all three mandatory reading benchmarks.

## Development

Use **Bun 1.4.4 or newer**. The runtime, dependency management, tests, type checks, formatter, and standalone lab tooling all use Bun. WXT's framework build runs under Bun.

```sh
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run format:check
bun run build
bun run build:firefox
```

For development, use `bun run dev` or `bun run dev:firefox`. Generated browser packages go in `.output/`. `bun run format` applies the preferences in [bunfig.toml](bunfig.toml), based on the user's Talqo configuration.

Bun is development tooling; the finished extension must not require users to install Bun or a companion application. Model downloads must be deliberate user actions, never a side effect of opening or installing the extension.

## Technical experiments

[The local speech lab](lab/local-speech/README.md) tests inference inside isolated temporary extension packages, independently of product UI. It is not the selected production engine. [Research](docs/research.md) and [engineering guidance](docs/engineering.md) track evidence and outstanding gates.

## License

Original project code is [MIT](LICENSE). Third-party reference code, runtime files, model weights, and voice/preview assets retain their own licenses. The lab records and preserves their notices. The prototype bundles GPL-3.0-or-later Spellophone/eSpeak NG with MIT ONNX Runtime. Original source files remain MIT; the combined bundle has GPL distribution obligations. See [NOTICE.md](NOTICE.md) and the [licensing inventory](docs/licensing.md). Public distribution remains gated.

## Browser checks

After building, use `bun run probe:chrome` and `bun run probe:firefox` for isolated product probes. They deliberately download a voice and delete it again. A working audio output is required; the Linux VM uses a private test sink via `bun scripts/with-test-audio.ts scripts/probe-product-firefox.ts`. The helper expects extracted Ubuntu PulseAudio test binaries under `.cache/test-audio/pulse/`; it installs no system service and is never part of the extension.

`bun run probe:pdf` requires the deliberately fetched thesis bytes in `.cache/benchmarks/muni-thesis.pdf`. Its evidence covers PDF rendering/text mapping, not full speech acceptance. See [current status](docs/feasibility-status.md) for exact limits.

The voice page contains the pinned 178-model catalog with search, source terms, variants, and explicit downloads; seven models need pronunciation engines that are not yet implemented. These are labeled unavailable. Playback controls use icons with accessible names; voice actions retain text labels. The bar's gear opens voice management, and right-clicking the browser extension action exposes its Options page.

For a live PDF fetch check, use `PDF_SOURCE_URL=https://is.muni.cz/th/wdhgd/bc.pdf bun run probe:pdf`. The test checks access recovery in a fresh ungranted profile, then uses a narrow grant in a separate test copy; it does not click the browser's native permission dialog. In your normal browser, the new PDF tab may ask for access to the PDF's site. This is optional site access, not an install-time all-sites grant.

After updating a development package, reload the extension **and existing source tabs** once to remove listeners left by older builds. On Chrome, the new inference host adds the internal offscreen permission; accept that updated extension permission if the browser asks. No helper app is involved.

Local timing/backend diagnostics are available from the extension page's developer console with `await browser.storage.local.get("lastSpeechPerformance")` (use `chrome` in Chrome). They contain no reading text. Cold initialization is still over the acceptance budget; see the evidence/status documents before interpreting one VM run as a benchmark.
