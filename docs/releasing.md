# CI and releases

Updated **2026-11-05**. The implementation agent owns release engineering, icons, promotional artwork, screenshots, listing/privacy copy, and the submission package. The product owner supplies product decisions and only the account/identity/credential actions that cannot be performed without their access. They are not assigned design, copywriting, building, or routine publishing work.

## Version authority and automatic publishing

The pushed **`vX.Y.Z` Git tag is the sole release-version authority**. `package.json` may retain its development placeholder; no package-version edit is required or used for a release. `scripts/release-version.ts` validates and strips the tag prefix. WXT writes that version into both browser manifests and uses it in every artifact filename. Publishing resolves that same tag, and GitHub release creation rejects artifacts named for another version. Untagged development builds use `0.0.0`; explicit `RELEASE_VERSION` is available only for local/source-review reproduction. In a tag build an override contradicting the tag fails.

Use stable SemVer: major for incompatible product-contract changes, minor for compatible features, patch for compatible fixes; 0.y.z denotes initial development. Exact three-component versions with no leading zeroes, prerelease/build suffixes or components above 65535 are supported by the stable store pipeline. All-zero versions cannot be released. The workflow checks the tag is newer than previous stable tags and its commit is on the default branch. Reviewers assess the meaning of the bump; automation cannot infer compatibility from source diffs.

Once store accounts/listings and credentials are provisioned and the documented acceptance work is complete, the entire release instruction is:

```sh
git tag -a v0.1.0 -m 'Release 0.1.0'
git push origin v0.1.0
```

No package bump, manual ZIP build, artwork task, separate `RELEASE_READY` variable or manual GitHub release creation is required. The tag triggers **CI → CD → published GitHub release**. Chrome is submitted with default automatic publication after approval; Firefox uses AMO's listed channel. The stores retain control of review timing and decisions. GitHub release notes state that submission success is not a claim of store approval.

## Workflows

- **CI:** PRs, pushes to main, and release calls run strict types, formatting, unit tests and actionlint over all workflows. Builds/checks Chrome and Firefox MV3 archives. Extracts Firefox reviewer sources, installs into a different checkout/cache path and compares all packaged file bytes. Validates committed PNG dimensions and bundles store artwork, listing/privacy copy and editable icon source. Uploads three immutable run artifacts: `extension-chrome`, `extension-firefox`, `extension-store-assets`. Require **CI complete** in main's rules.
- **CD:** preflight checks both store configurations, then authenticates both through WXT dry-runs before either can upload. Live jobs use the exact tested archives from that run. WXT owns store authentication/options. Chrome API v2 uses a dedicated service account; Firefox uses an AMO API issuer/secret. No review bypass or cancellation of another pending review is requested.
- **Store check:** manual dispatch on the default branch runs CI and authentication-only preflight. It uploads no version, consumes no version number, and creates no release. It works with the development sentinel. Existing listings are required for WXT's current authentication checks.
- **Release:** a `v*` push must pass strict vX.Y.Z validation first. After CI and both store submissions succeed, it creates/reuses a draft GitHub release, uploads the four tag-versioned ZIPs and SHA-256 checksums, then publishes automatically. The fourth ZIP is `read-aloud-X.Y.Z-store-assets.zip`. The Firefox ZIP is unsigned; users install Firefox from AMO. A signed XPI is not currently fetched.

All jobs use Ubuntu 26.04. Actions are pinned to complete hashes and Dependabot maintains Bun dependencies and GitHub Actions. Bun's toolchain version comes from packageManager; installs use the frozen text lockfile. Tokens are read-only except the final release job's contents:write permission. Checkout retains no Git credentials; publishing secrets never enter PR jobs. Every job has a timeout. Release submissions are serialized and never automatically cancelled. GitHub concurrency retains only one running and one pending run, so avoid pushing a burst of release tags.

## Agent-owned store package

The repository contains the completed original vector identity in `assets/brand/read-aloud.svg`, toolbar/store PNGs in `public/icons/` and `store/assets/`, promotional tiles and actual English/Czech voice-page screenshots. `store/listing.md` contains the listing description, permission explanations, links and reviewer notes; `PRIVACY.md` supplies the public policy. `bun run package:store` validates dimensions and bundles these materials; CI and every successful release attach this package automatically. Assets do not include unlicensed third-party imagery, downloaded voice models, or bundled previews.

The agent regenerates artwork/screenshots when needed with `bun run assets:store` after a Chrome build. The script renders original SVG/HTML and captures the actual unmodified extension UI using an isolated Chromium profile. It does not fabricate playback, stream samples, or download models. Only toolbar icons are shipped in the installed extension. Promotional assets remain in the separate store package. The agent owns keeping screenshots and claims consistent with the product.

## One-time account integration

The current repository has no store listings or publishing credentials. Initial listings cannot be created by WXT's update adapter. The agent prepares all upload materials and handles available automation; account registration, publisher verification, terms acceptance and authenticated account access cannot be fabricated. If no authenticated store session is available, that access is the remaining external blocker, not a product-owner artwork/build task.

Use the permanent Firefox ID `read-aloud@fidasek009.github.io` (the default in WXT). Keep this ID for the initial AMO submission and every update; an existing registered ID may instead be supplied through repository variable FIREFOX_EXTENSION_ID. Protect main with required CI/review rules and protect v* tags against updates/deletion, allowing creation only by release maintainers. The `stores` environment must allow the protected default branch for dry-runs and version tags for publication. Required environment reviewers are optional, not built-in release steps.

| Scope | Name | Value |
| --- | --- | --- |
| Repository variable | `CHROME_EXTENSION_ID` | Existing Chrome store item ID |
| Repository variable | `CHROME_PUBLISHER_ID` | Publisher ID from Publisher → Settings |
| Repository variable | `FIREFOX_EXTENSION_ID` | Permanent manifest/AMO ID; use the default above for first submission |
| `stores` environment secret | `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL` | Dedicated authorized service-account email |
| `stores` environment secret | `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` | Decoded PEM private key, preserving real line breaks |
| `stores` environment secret | `FIREFOX_JWT_ISSUER` | AMO API issuer/key |
| `stores` environment secret | `FIREFOX_JWT_SECRET` | AMO API secret |

Create/enable the Chrome Web Store API in a Google Cloud project, create a service account and link its email under the Chrome dashboard's Account section. No broad Google Cloud project role is needed merely to authorize Web Store publishing. The API credentials flow uses the service-account JSON key's client_email/private_key, not retired v1.1 refresh-token instructions. Secrets are entered through GitHub/private input, never committed or printed. The source archive uses an explicit allowlist and excludes .env files.

First submission consumes a version just as an automated upload does. Complete that initial store integration with the agent's tag-versioned packages, then use a higher tag for the next update. Do not reuse a version already uploaded manually. Accounts, initial review, and store-required publisher metadata are not bypassed by having a CI pipeline.

## Acceptance and retries

Removing a redundant manual ready switch does not declare the current prototype ready or clear its separate licenses. The agent must resolve the existing release gates in `docs/licensing.md`, `NOTICE.md` and `docs/feasibility-status.md` before initiating real publication. Full corresponding source/build provenance for bundled GPL components and model/preview clearance are still unresolved. The reviewer ZIP is not a claim of complete GPL corresponding source. Latency, Windows, GPU/CPU and real-browser acceptance are separate from unit/packaging checks. Do not push a real release tag merely to test credentials: use Store check.

Stores and GitHub cannot commit an atomic transaction. If one store accepts and the other fails, the accepted submission remains; GitHub release publication is withheld. Inspect state and rerun only failed jobs, never blindly repeat a successful upload. If a request timed out after acceptance, reconcile the store state before retrying. Code fixes get a higher tag; existing tags and published artifacts stay immutable.

The GitHub release job is independently retryable. It reuses an existing draft, replaces draft assets and publishes last. If publication succeeded despite a lost response, a retry compares existing public asset bytes and adds only missing assets. It never overwrites different published bytes or regenerates notes on every retry. Tests simulate draft/upload/publication-response failures and preservation of immutable public assets.

## Verification and primary references

`bun run typecheck`, `bun run format:check`, `bun run test`, `bun run lint:workflows`, both ZIP builds, `bun run check:source-rebuild`, and `bun run package:store` are the relevant checks. Workflow linting downloads a pinned, SHA-256-verified actionlint release on Linux x64. Reviewer reproduction exports the version shown in the submitted manifest; see `SOURCE_CODE_REVIEW.md`. File bytes, not ZIP timestamps/compression metadata, are compared. No live store authentication/submission has succeeded yet because accounts/listings/credentials are absent.

- [WXT publishing and first-time limitations](https://wxt.dev/guide/essentials/publishing.html)
- [WXT version template semantics](https://wxt.dev/guide/resources/upgrading)
- [Chrome service-account integration](https://developer.chrome.com/docs/webstore/service-accounts)
- [Chrome store imagery](https://developer.chrome.com/docs/webstore/images)
- [Chrome manifest version constraints](https://developer.chrome.com/docs/extensions/reference/manifest/version)
- [Firefox submissions and reviewer sources](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/)
- [GitHub Actions security](https://docs.github.com/en/actions/reference/security/secure-use)
- [Bun comment-preserving whitespace minification](https://bun.com/docs/bundler/minifier)
