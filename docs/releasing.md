# CI and releases

Verified against the linked official documentation on **2026-11-04**. These workflows implement release automation, not product acceptance or license clearance.

## Workflow

- `CI` runs on PRs and pushes to `main`. It validates stable version syntax, runs the complete type/format/test gates, builds both Manifest V3 targets, checks the ZIP manifests, rebuilds Firefox from its reviewer archive in a separate directory and Bun cache, compares every packaged file byte-for-byte, and retains installable packages plus Firefox reviewer sources for 14 days. It also runs `bun run lint:workflows` against every workflow, including CD and release paths, using the pinned, SHA-256-verified actionlint binary and `.github/actionlint.yaml`. Require **CI complete** in branch rules. CI uses no publishing credentials, including for fork PRs.
- `CD` is a reusable workflow called after CI by `Release` for publication or by the manually dispatched `Store check` workflow for authentication-only validation. A preflight checks configuration and runs WXT authentication-only dry-runs for both stores before either uploads. Manual Store check ends after this preflight; only real releases run publishing jobs. Each store job downloads the artifacts from that same run and invokes WXT's submission CLI without rebuilding. The local wrapper handles only safety gates and arguments; WXT owns submission options and credential handling, with no direct publishing-library dependency. Chrome uses Web Store API **v2** service-account authentication; the retired v1.1 OAuth flow is not used. Firefox submits to the **listed** channel with reviewer sources. Neither job bypasses review or cancels pending reviews.
- `Release` runs on pushed `v*` tags, rejects anything except exact `vX.Y.Z`, runs CI, then CD, then creates a draft GitHub release with generated release notes, uploads both browser ZIPs, reviewer source ZIP and SHA-256 checksums, and publishes it only after all uploads succeed. GitHub release creation requires both store submissions to succeed. Store approval is asynchronous: success means submitted for review/publication, not already available to users. The Firefox ZIP is **unsigned**; users should install through AMO. This workflow does not fetch a signed XPI.

All jobs use Ubuntu 26.04 runners. Actions are pinned to full commit hashes and Dependabot proposes weekly GitHub Actions and Bun dependency updates, maintaining package.json and the text-based bun.lock. The Bun runtime remains pinned through packageManager and should be updated together with engines.bun and @types/bun. Bun is selected from `packageManager`; dependency installation uses the frozen lockfile. Jobs have explicit timeouts, read-only tokens by default, and checkout does not retain Git credentials. Only GitHub release creation receives `contents: write`. GitHub-hosted action implementations use GitHub's managed runtimes; all project scripts/builds run under Bun, without a Node installation step.

Release runs share a non-cancelling concurrency group to prevent overlapping store submissions. GitHub concurrency retains at most one running and one pending run; do not push multiple release tags in quick succession because a newer pending run can replace an older pending run.

## First publication and repository setup

First-time listings must be created manually. No credentials are committed or requested by a workflow in chat.

1. Resolve the gates in [licensing](licensing.md) and [acceptance status](feasibility-status.md), including corresponding source/build provenance for bundled GPL components. The WXT reviewer ZIP contains application source and build instructions; it does **not** establish complete GPL corresponding source. Finish the corresponding-source distribution before enabling publication. The workflows do not claim CPU/GPU quality, latency, or browser behavior acceptance from unit tests/builds.
2. Choose the permanent Firefox add-on ID and set repository variable `FIREFOX_EXTENSION_ID` before building the first published package. WXT uses this value; the development fallback `read-aloud@local.invalid` is rejected by CD. Keep the same ID forever after first publication. Also export it when building manually for store upload.
3. Set a valid initial version (for example `0.1.0`) in `package.json` through a PR. Download that PR's CI packages and create the initial Chrome Web Store and Firefox AMO listings manually, completing privacy, permission, license, reviewer and store metadata. Supply Firefox reviewer sources and `SOURCE_CODE_REVIEW.md`. Complete account verification and initial review as required by each store. First publication is a bootstrap exception to automated CD; subsequent versions use tags. Do not tag a version already uploaded manually as though it were a new update.
4. Configure the variables and secrets below. Create a GitHub environment named `stores`; allow deployment from the protected default branch for dry-runs and protected version tags for publication. All nonsecret variables must be **repository** variables because CI and release preflight need them. Put publishing secrets in the `stores` environment. The preflight and publishing jobs both use that environment. Required reviewers are optional; configuring them makes releases wait for those approvals.
5. Protect `main`: PRs required, **CI complete** required, no force pushes/deletion, and appropriate review requirements for repository ownership. Protect `v*` tags with a repository ruleset: restrict creation to release maintainers and prohibit updates/deletion. Give workflow-file changes particular review attention. Release validation checks that the tagged commit is reachable from the default branch; repository rules enforce who can change that branch and tags. These server-side settings are not installed by adding workflow files.
6. From Actions, manually run **Store check** on the default branch. It runs CI, then invokes WXT with `--dry-run true` for both stores. It authenticates and reads existing listing metadata without uploading, submitting, or reserving a version; `0.0.0` and an unset `RELEASE_READY` are allowed in this mode. Existing store listings are still required. This checks credentials/read access, not upload permissions, review acceptance or production readiness. It creates no GitHub release. All non-dry publication paths still enforce the release tag and readiness gate.
7. Set repository variable `RELEASE_READY` to the exact string `true` only once the documented release gates and initial store setup are complete. Until then PR CI works but CD fails closed. Keep readiness evidence current with each release; the variable is an operational assertion, not an automated audit.

| Scope | Name | Value |
| --- | --- | --- |
| Repository variable | `FIREFOX_EXTENSION_ID` | Permanent manifest/AMO add-on ID |
| Repository variable | `CHROME_EXTENSION_ID` | Chrome Web Store item ID |
| Repository variable | `CHROME_PUBLISHER_ID` | Web Store publisher ID |
| Repository variable | `RELEASE_READY` | `true` after gates above are satisfied |
| `stores` environment secret | `CHROME_SERVICE_ACCOUNT_CLIENT_EMAIL` | Google service account authorized for this publisher |
| `stores` environment secret | `CHROME_SERVICE_ACCOUNT_PRIVATE_KEY` | Its PEM private key, including real newlines |
| `stores` environment secret | `FIREFOX_JWT_ISSUER` | AMO API key/issuer |
| `stores` environment secret | `FIREFOX_JWT_SECRET` | AMO API secret |

Use a dedicated least-privilege store identity, enable the Chrome Web Store API, and authorize the service account in the publisher dashboard. Rotate credentials and limit repository/environment access. Do not place keys in `.env.submit` inside build artifacts; `.env*` is ignored and reviewer source packaging uses an explicit file allowlist.

## Versioning and normal release

`package.json` is the single source of the extension version; WXT supplies it to both manifests. `0.0.0` remains the current development placeholder and is rejected for release. Stable versions must have exactly three components, no leading zeroes, and each component at most 65535 to fit Chrome's manifest constraints. Prerelease/build suffixes are intentionally unsupported by this stable store pipeline.

Follow [SemVer 2.0.0](https://semver.org/): major for incompatible changes to the supported product contract, minor for compatible features, patch for compatible fixes; `0.y.z` denotes initial development. The workflow enforces syntax, tag/package agreement, and increasing versions relative to existing stable tags. It cannot infer compatibility from source diffs; reviewers must validate the appropriate bump. A version bump is not required for every PR.

1. Review the changes and acceptance evidence; update `package.json` to the intended next version, then merge the PR after CI passes. No version is rewritten during release.
2. From the merged commit on the default branch, create an annotated tag and push it:

   ```sh
   git tag -a v0.1.1 -m 'Release 0.1.1'
   git push origin v0.1.1
   ```

3. Observe Actions and both store dashboards. The GitHub release appears only after successful submissions; review rejection must be handled separately. No automatic polling waits for approval. Release notes explicitly state this distinction.

Both stores and GitHub cannot participate in an atomic transaction. If one store succeeds and the other fails, the GitHub release is withheld, but the successful submission remains. Inspect store state, fix credentials/configuration as needed, then use GitHub's **Re-run failed jobs** to retry only the failed job. Never blindly rerun successful publishing jobs: duplicate-version uploads may fail. If submission succeeded remotely but the job timed out, reconcile in the dashboard before retrying. Do not move/reuse an existing release tag or edit released artifacts; ship a higher version for code fixes. A GitHub release job failure can be retried without rerunning CI/CD: an existing draft is reused, draft assets are uploaded with replacement, and publication happens last. If publication succeeded but its response was lost, the retry verifies existing public asset bytes and adds only missing assets. It refuses to overwrite differing published assets. Generated notes are created with the draft and retained on retries. Tags and uploaded versions must remain immutable.

## Verification limits

The automated CI gates cover deterministic unit behavior and packaging for both browsers. Existing real-browser probes require an audio/browser/voice fixture setup and are not run on hosted CI. Windows/Linux CPU-only, GPU, selection/PDF, lifecycle and performance acceptance remain the separate documented release checks. No live store authentication or submission has been tested without real listings and credentials. Retry tests simulate failures after draft creation, partial upload and a lost publication response; they do not create actual GitHub releases. Validate the first automated update in both dashboards before treating CD as operational.

## Primary references

- [WXT publishing and first-time setup](https://wxt.dev/guide/essentials/publishing.html)
- [Publishing adapter options](https://github.com/aklinker1/publish-browser-extension/blob/main/docs/config-reference.md)
- [Chrome Web Store API](https://developer.chrome.com/docs/webstore/using-api/)
- [Chrome version constraints](https://developer.chrome.com/docs/extensions/reference/manifest/version)
- [Firefox submitting an add-on](https://extensionworkshop.com/documentation/publish/submitting-an-add-on/)
- [Firefox source code submission](https://extensionworkshop.com/documentation/publish/source-code-submission/)
- [GitHub reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)
- [GitHub Actions security](https://docs.github.com/en/actions/reference/security/secure-use)

For local workflow validation on Linux x64, run `bun run lint:workflows`. It downloads actionlint 1.7.12 only from its pinned upstream release and verifies the committed checksum before execution. For raw WXT dry-run/status options use `bun --bun run wxt submit --help` and `bun --bun run wxt submit status --help`. The safety wrapper requires an explicit `--dry-run` or `--publish` argument.

Build-path independence uses [Bun whitespace minification](https://bun.com/docs/bundler/minifier), which removes module-path comments and retains important license comments. CI compares extracted file contents, not ZIP timestamps or compression metadata.
