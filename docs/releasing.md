# CI and releases

Updated **2026-11-06**. The implementation agent owns release engineering, icons, promotional artwork, screenshots, listing/privacy copy, and the submission package. The product owner supplies product decisions and only the account/identity/credential actions that cannot be performed without their access. They are not assigned design, copywriting, building, or routine publishing work.

## Version authority and automatic publishing

The pushed **`vX.Y.Z` Git tag is the sole release-version authority**. `package.json` may retain its development placeholder; no package-version edit is required or used for a release. `scripts/release-version.ts` validates and strips the tag prefix. WXT writes that version into both browser manifests and uses it in every artifact filename. Publishing resolves that same tag, and GitHub release creation rejects artifacts named for another version. Untagged development builds use `0.0.0`; explicit `RELEASE_VERSION` is available only for local/source-review reproduction. In a tag build an override contradicting the tag fails.

Use stable SemVer: major for incompatible product-contract changes, minor for compatible features, patch for compatible fixes; 0.y.z denotes initial development. Exact three-component versions with no leading zeroes, prerelease/build suffixes or components above 65535 are supported by the stable store pipeline. All-zero versions cannot be released. The workflow checks the tag is newer than previous stable tags and its commit is on the default branch. Reviewers assess the meaning of the bump; automation cannot infer compatibility from source diffs.

Once store accounts and credentials are provisioned, the Chrome draft item exists, and the documented acceptance work is complete, the entire release instruction is:

```sh
git tag -a v0.1.0 -m 'Release 0.1.0'
git push origin v0.1.0
```

No package bump, manual ZIP build, artwork task, separate `RELEASE_READY` variable or manual GitHub release creation is required. CI verifies required license notices and pinned source materials. The concise [licensing checklist](licensing.md) separately records remaining model/output assessments; a passing material check does not establish release readiness. The tag triggers **CI → CD → published GitHub release**. Chrome is submitted with default automatic publication after approval; Firefox uses AMO's listed channel. The stores retain control of review timing and decisions. GitHub release notes state that submission success is not a claim of store approval.

## Workflows

- **CI:** PRs, pushes to main, and release calls run strict types, formatting, unit tests and actionlint over all workflows. Builds/checks Chrome and Firefox MV3 archives. Extracts Firefox reviewer sources, installs into a different checkout/cache path and compares all packaged file bytes. Validates committed PNG dimensions and bundles store artwork, listing/privacy copy and editable icon source. Uploads three immutable run artifacts: `extension-chrome`, `extension-firefox`, `extension-store-assets`. Require **CI complete** in main's rules.
- **CD:** preflight checks both store configurations, then authenticates both before either can upload. Live jobs use the exact tested archives from that run. Chrome uses WXT, API v2 and GitHub OIDC through a dedicated federated service account. Firefox uses Mozilla's `web-ext` V5 submission client with an AMO issuer/secret: a GUID-based PUT creates the first listing or submits an update, then attaches reviewer sources. Committed listing copy, separate license terms, privacy policy and icon are submitted automatically; missing screenshot positions are populated from the supplied artwork. No review bypass or cancellation of another pending review is requested.
- **Store check:** manual dispatch on the default branch runs CI and authentication-only preflight for the selected store (chrome, firefox or all). Real releases always authenticate and publish both stores. It uploads no version, consumes no version number, and creates no release. It works with the development sentinel. Chrome needs its draft item. Firefox authenticates against the account profile before looking up the GUID; a missing listing is expected for the first release and does not require a manual submission. The check validates local package identity/listing materials and account access, not server-side package validation or store approval.
- **Release:** a `v*` push must pass strict vX.Y.Z validation first. After CI and both store submissions succeed, it creates/reuses a draft GitHub release, uploads the four tag-versioned ZIPs and SHA-256 checksums, then publishes automatically. The fourth ZIP is `read-aloud-X.Y.Z-store-assets.zip`. The Firefox ZIP is unsigned; users install Firefox from AMO. A signed XPI is not currently fetched.

All jobs use Ubuntu 26.04. Actions are pinned to complete hashes and Dependabot maintains Bun dependencies and GitHub Actions. Bun's toolchain version comes from packageManager; installs use the frozen text lockfile. Repository contents access is read-only except the final release job's contents:write permission. Only CD jobs and their reusable-workflow callers receive id-token:write for federated authentication. Checkout retains no Git credentials; publishing secrets never enter PR jobs. Every job has a timeout. Release submissions are serialized and never automatically cancelled. GitHub concurrency retains only one running and one pending run, so avoid pushing a burst of release tags.

## Agent-owned store package

The repository contains the completed original vector identity in `assets/brand/read-aloud.svg`, toolbar/store PNGs in `public/icons/` and `store/assets/`, promotional tiles and actual English/Czech voice-page screenshots. `store/listing.md` contains the listing description, permission explanations, links and reviewer notes; `PRIVACY.md` supplies the public policy. `bun run package:store` validates dimensions and bundles these materials; CI and every successful release attach this package automatically. Assets do not include unlicensed third-party imagery, downloaded voice models, or bundled previews.

The agent regenerates artwork/screenshots when needed with `bun run assets:store` after a Chrome build. The script renders original SVG/HTML and captures the actual unmodified extension UI using an isolated Chromium profile. It does not fabricate playback, stream samples, or download models. Only toolbar icons are shipped in the installed extension. Promotional assets remain in the separate store package. The agent owns keeping screenshots and claims consistent with the product.

## One-time account integration

Chrome now has a draft store item and configured publishing identity; federation and WXT credential validation passed on 2026-11-05. Firefox account/API credentials also passed GET-only authentication on 2026-11-05. WXT 0.21.5's publisher already uses AMO V5 but only supports existing listings. Our Firefox path uses Mozilla's `web-ext` 10.8.0 exported submission client under Bun, which supports creating the listing and updating it by the same permanent GUID. Account registration, publisher verification and terms acceptance still belong to the actual account holder. No manual first Firefox upload is required.

Use the permanent Firefox ID `read-aloud@fidasek009.github.io` (the default in WXT). Keep this ID for the initial AMO submission and every update; an existing registered ID may instead be supplied through repository variable FIREFOX_EXTENSION_ID. Protect main with required CI/review rules and protect v* tags against updates/deletion, allowing creation only by release maintainers. The `stores` environment must allow the protected default branch for dry-runs and version tags for publication. Required environment reviewers are optional, not built-in release steps.

| Scope | Name | Value |
| --- | --- | --- |
| Repository variable | `CHROME_EXTENSION_ID` | Existing Chrome store item ID |
| Repository variable | `CHROME_PUBLISHER_ID` | Publisher ID from Publisher → Settings |
| Repository variable | `FIREFOX_EXTENSION_ID` | Permanent manifest/AMO ID; use the default above for first submission |
| Repository variable | `CHROME_SERVICE_ACCOUNT_EMAIL` | Dedicated authorized service-account email |
| Repository variable | `CHROME_WORKLOAD_IDENTITY_PROVIDER` | Full projects/NUMBER/locations/global/workloadIdentityPools/POOL/providers/PROVIDER resource name |
| `stores` environment secret | `FIREFOX_JWT_ISSUER` | AMO API issuer/key |
| `stores` environment secret | `FIREFOX_JWT_SECRET` | AMO API secret |

Follow [Chrome federation setup](chrome-publishing-setup.md) and [Firefox credentials and first-listing automation](firefox-publishing-setup.md). No downloaded Google private key, Chrome secret, OAuth client or saved access token is needed. Each Chrome preflight/publication job obtains its own 30-minute Web Store-scoped access token immediately before using WXT. The auth action creates no credential file and exports no global credentials. Firefox secrets are entered through GitHub, never committed or printed. The source archive uses an explicit allowlist and excludes .env files. The v0.1.1 release uploaded to both stores; its partial-publication recovery is documented below.

The first live Firefox release created the listing and consumed version 0.1.1. Subsequent releases use higher tags and retain the same GUID. Do not reuse an uploaded version. Accounts, review, and store-required publisher identity declarations are not bypassed by having a CI pipeline.

## Acceptance and retries

### Recover an accepted version

On 2026-11-06, [v0.1.1's release run](https://github.com/Fidasek009/read-aloud/actions/runs/42218351587) passed CI and both store authentication checks. Chrome accepted the ZIP, then rejected publication with `INVALID_ITEM_METADATA`; the publisher must finish the dashboard fields in [the prepared Chrome guide](../store/chrome-setup.md). Firefox created `read-aloud2`, accepted version `6672639` and reviewer sources, then rate-limited a privacy metadata PATCH. Neither package should be uploaded again.

**Recover release** is a manual workflow on main. Supply the immutable tag (`v0.1.1`), original Release run ID (`42218351587`), and `firefox` to repair only Firefox metadata. Select `all` after Chrome's existing draft is submitted for automatic publication to also verify its exact version/status and publish the GitHub release. Recovery verifies original CI success and the tag commit, takes listing material from that tag, and downloads the original tested artifacts. It never calls an extension/source upload endpoint. Firefox recovery requires the existing listed version and attached reviewer sources; it fills listing/privacy/icon/screenshot metadata. Chrome recovery only reads status. The GitHub job remains withheld until both stores are confirmed. Tags stay unchanged.

AMO metadata requests honor `Retry-After` on HTTP 429, with at most five retries and a shared 75-minute deadline, inside a 90-minute publishing job. This permits an hourly quota cooldown; a daily restriction fails rather than retrying early. Writes are spaced by 21 seconds, and metadata starts outside Mozilla's submission client's burst window. Unchanged listing fields, privacy policy, uploaded icon and completed screenshot captions are retained. Other failed writes are not blindly retried. Existing screenshot positions are reused, so restarting metadata recovery does not add duplicate screenshots. These limits follow Mozilla's [submission throttle implementation](https://github.com/mozilla/addons-server/blob/master/src/olympia/api/throttling.py), checked 2026-11-06 (three writes per minute, ten per hour, twenty-four per day; production settings may change).

`bun run check:licenses` checks required notices, pinned source archive/build-recipe checksums and dependency/source version alignment. It runs in CI and standalone live publishers. Package checks verify the installed license links. There is no review JSON, routine source-file hash refresh or separate release mode. Remaining model/output assessments remain in [the licensing checklist](licensing.md); simplifying automation does not clear them or certify release readiness. Corresponding-source materials and notices are supplied, including the exact Kasandra medium grant and attribution. The agent remains responsible for addressing applicable license conditions and the separate Windows, GPU/CPU and real-browser acceptance in [feasibility status](feasibility-status.md) before publication. The owner waived performance as a first-release blocker on 2026-11-06; keep measured limitations documented and optimize afterward. Original previews are separately hosted and fetched only on Listen; see voice-previews/README.md. Use Store check for credential testing.

Stores and GitHub cannot commit an atomic transaction. If one store accepts and the other fails, the accepted submission remains; GitHub release publication is withheld. Inspect state and rerun only failed jobs, never blindly repeat a successful upload. If a request timed out after acceptance, reconcile the store state before retrying. Code fixes get a higher tag; existing tags and published artifacts stay immutable.

Firefox's submission client uploads the ZIP, waits for validation, creates the version, then attaches sources. Listing/privacy/artwork updates follow. A source or metadata failure fails CD and withholds the GitHub release, but cannot undo a version AMO has already accepted. Reconcile and repair that version before retrying; Firefox submission is not claimed to be idempotent. Approval/signing is asynchronous: the job does not wait for review or download a signed XPI. Existing screenshots are retained at their assigned positions; the agent updates them when the UI changes.

The GitHub release job is independently retryable. It reuses an existing draft, replaces draft assets and publishes last. If publication succeeded despite a lost response, a retry compares existing public asset bytes and adds only missing assets. It never overwrites different published bytes or regenerates notes on every retry. Tests simulate draft/upload/publication-response failures and preservation of immutable public assets.

## Verification and primary references

`bun run typecheck`, `bun run format:check`, `bun run test`, `bun run lint:workflows`, both ZIP builds, `bun run check:source-rebuild`, and `bun run package:store` are the relevant checks. Workflow linting downloads a pinned, SHA-256-verified actionlint release on Linux x64. Reviewer reproduction exports the version shown in the submitted manifest; see `SOURCE_CODE_REVIEW.md`. File bytes, not ZIP timestamps/compression metadata, are compared. [Store check attempt 3](https://github.com/Fidasek009/read-aloud/actions/runs/42102496965/attempts/3) passed CI, both browser packaging checks, reviewer-source reproduction, federated Chrome token generation and WXT Chrome authentication on 2026-11-05. [Firefox Store check](https://github.com/Fidasek009/read-aloud/actions/runs/42119491832) also passed CI, both packages, reviewer-source reproduction and live AMO account authentication on 2026-11-05. Live store submissions remain unverified.

- [WXT publishing and first-time limitations](https://wxt.dev/guide/essentials/publishing.html)
- [WXT version template semantics](https://wxt.dev/guide/resources/upgrading)
- [Chrome service-account integration](https://developer.chrome.com/docs/webstore/service-accounts)
- [Google federation setup for deployment pipelines](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines)
- [Open-source extension pipeline comparison, checked 2026-11-05](release-pipeline-references.md)
- [Chrome store imagery](https://developer.chrome.com/docs/webstore/images)
- [Chrome manifest version constraints](https://developer.chrome.com/docs/extensions/reference/manifest/version)
- [Firefox submissions and reviewer sources](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/)
- [Mozilla's supported automated initial submissions and updates](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)
- [AMO V5 create-or-update by GUID](https://mozilla.github.io/addons-server/topics/api/addons.html#put-create-or-edit)
- [GitHub Actions security](https://docs.github.com/en/actions/reference/security/secure-use)
- [Bun comment-preserving whitespace minification](https://bun.com/docs/bundler/minifier)
