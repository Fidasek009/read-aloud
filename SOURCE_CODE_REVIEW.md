# Building Read Aloud for source review

Use **Bun 1.4.4**, pinned in `package.json`, on Linux. No Node runtime, helper application or voice-model download is required for building. Install Bun using its [official instructions](https://bun.com/docs/installation).

From the extracted source directory:

```sh
bun install --frozen-lockfile
export RELEASE_VERSION='the-version-in-the-submitted-manifest'
export FIREFOX_EXTENSION_ID='the-permanent-ID-in-the-submitted-manifest'
bun run zip:firefox
```

The pushed Git tag sets the release version. For a standalone reviewer rebuild, replace RELEASE_VERSION with manifest.version from the submitted extension (for example 0.1.0), not package.json's development placeholder. Replace the example ID with `browser_specific_settings.gecko.id` from the submitted manifest. Build output is `.output/firefox-mv3/`; the extension archive is `.output/read-aloud-<release-version>-firefox.zip`. For Chrome, run `bun run zip` instead.

The source package includes `bun.lock`, build scripts, strict TypeScript configuration, first-party source, bundled static files and vendored provenance/notices. Installation downloads the pinned build/runtime dependencies from the package registry. WXT invokes `scripts/prepare-runtime.ts`, which bundles the speech workers and copies runtime WASM/data and PDF assets from those dependencies. No executable code is fetched by the installed extension. Voice-model and prerecorded-preview network behavior is described in `README.md` and `docs/licensing.md`.

The build uses WXT/Vite and `Bun.build` for the worker bundles. Original source is MIT; bundled dependencies retain their separate terms. See `NOTICE.md`, `docs/licensing.md` and `vendor/`. This reviewer source archive is not, by itself, a claim that complete corresponding source for third-party binaries has been supplied. That distribution obligation is a separate release gate documented in `docs/releasing.md`.

CI extracts this reviewer archive, installs with a separate Bun cache, rebuilds at a different filesystem path and checks every packaged file byte-for-byte against the submitted Firefox archive. Run `bun run check:source-rebuild` from the original checkout after `bun run zip:firefox` to repeat this check. Worker whitespace minification removes checkout/cache-specific module-path comments while preserving important license comments. ZIP timestamps/compression metadata are excluded from the comparison.
