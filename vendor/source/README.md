# Pinned speech sources

Prepared 2026-11-05. These are source archives, not executable extension assets. Full WXT source at e690f91730aa679a58fba905f30f8ca80ea4f490 is included as well (SHA-256 507a9f2f3590cfce7b318da403a22eee4ee55c4b014e49455d0c654a0ecd865e); its browser adapter src/index.mjs was compared byte-for-byte with the installed @wxt-dev/browser 0.3.7 source. They are included in the Firefox reviewer source ZIP through `vendor/**` and intended to remain downloadable from this public repository at each release tag **before** any store upload. Keep them accessible to recipients while conveying the corresponding binaries; a reviewer-private upload alone is not public source delivery.

| Archive | Exact source revision | SHA-256 |
| --- | --- | --- |
| `spellophone-6d51a872d54a773e4969d7130fdaed665b2d6d18.tar.gz` | Spellophone v0.2.1, `6d51a872d54a773e4969d7130fdaed665b2d6d18` | `6702e673c93ea1d8d90300a162d64aaab9fdc23737068173ec54e0c0ca4c58c6` |
| `espeak-ng-4870adfa25b1a32b4361592f1be8a40337c58d6c.tar.gz` | eSpeak NG 1.52.0, `4870adfa25b1a32b4361592f1be8a40337c58d6c` | `cd83f84c4e495f281ac14e919aecf2834306ec1ea1b498de8ef6000f3a0f90de` |

`provenance.json` records supplier source URLs, tarball integrity and the decoded registry-supplied npm provenance tying the published Spellophone package to that source commit. The signature bundle has not independently been verified by this project; decoding it is not signature verification. Source archives are unmodified and include their upstream license texts, C/C++/TypeScript sources, native glue, CMake configuration, data compiler/packer, lockfile, toolchain declarations and the deterministic-dictionary patch.

## Build relationship

Extract the Spellophone archive into a working directory and the eSpeak archive into its `vendor/espeak-ng` directory. Apply Spellophone's `vendor/patches/0001-deterministic-dictionary-compile.patch` to that eSpeak source tree before compiling dictionaries. Its original upstream build instructions live in `apps/docs/docs/project/building.md`, `mise.toml`, `packages/spellophone/native/CMakeLists.txt`, `packages/spellophone/scripts/build-data.ts`, `build-wasm.ts`, `pack-data.ts` and `tsdown.config.ts` inside the archive. The source pin is `vendor/espeak-ng.json`.

The supplier's environment pins emsdk 6.0.12 and describes its own Node/pnpm workspace. That third-party reference is preserved as provenance; it is not a new Node requirement for building this extension. Our extension continues to install/build/check with Bun using the pinned prebuilt npm artifacts. The CMake native data build compiles `dictsource/` and `phsource/`; the Emscripten build includes eSpeak NG, speechPlayer and ucd-tools, with asynchronous/audio-device/MBROLA/libsonic features disabled. Exact compiler output parity is not a GPL condition, and this project has not independently rebuilt the supplier's native artifacts in this audit.

Read Aloud bundles the unmodified upstream WebAssembly and generated loader code, and copies compressed pronunciation data unchanged. The sole data-layout change renames `espeak-ng-data/manifest.json` to `data-index.json`; our first-party custom-fetch adapter maps that exact request so extension stores see only the root extension manifest. Bun then bundles/minifies the TypeScript worker code. Original application files remain MIT; the combined GPL-covered distribution retains GPL obligations. The extension's ordinary source/reviewer ZIP and these two archives do not, by themselves, certify complete corresponding-source coverage for every component of the combined distribution. The exact remaining assessment is in `release/licensing.json` and `docs/licensing.md`.

No model weights, training recordings or prerecorded previews are included here. Their licenses and provenance are assessed separately.
