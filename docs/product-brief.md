# Product brief

Started and updated: **2026-10-29**. Product answers below are confirmed by the user; architecture remains under investigation.

## Confirmed experience

A brutally simple, premium Firefox and Chrome extension for Windows and Linux. It reads web articles, selected text, and the user's PDF benchmark, entirely inside the browser extension with no separate helper application. US English and Czech are mandatory; expose all additional languages that the vetted models/runtime support.

The primary flow is **select text → right-click → read the selection nearly instantly**. Reading only that selection is the defined behavior; continuing into the rest of the article would be a different action. Article reading also belongs in the first release, with its exact invocation still to settle.

The user considers Piper's medium-quality voices decent and values choosing a lower-quality model for better speed. They dislike missing highlighting, broken model deletion, and playback speed changes that raise voice pitch. A pitch-preserving speed slider is mandatory.

In a subsequent answer, the user explicitly selected a playback bar, word-by-word highlighting, and automatic scrolling. **These are now first-release requirements**, superseding their earlier optional-highlighting preference. Follow Edge closely, with play/pause, previous/next sentence, speed, close/stop, and voice choice in the same surface. Sentence clicking is excluded from the first release.

The latest clarification is authoritative: **continue on tab switch; stop on source-page navigation or source-tab closure**. This supersedes the user's earlier continue-everywhere answer. The visible surface is a small in-page playback bar. Playback must be independent of toolbar-popup lifetime, but stopped sessions must not be restarted by late inference results.

## Model ownership and setup

- No automatic model downloads. The user must consciously choose a model and start its download.
- Download size itself does not constrain the design; explain the actual size before downloading.
- Installed models must be removable through a reliable, simple action.
- Users must be able to audition voices through on-demand prerecorded samples without downloading the whole model. Keep previews out of the extension package to minimize its size; never prefetch them.
- Model selection and management are justified product UI. Avoid exposing engine names, execution providers, worker counts, and other implementation settings.
- Reading is local/offline once its model and required assets are installed. A deliberate preview may need network access if its sample is not cached; this must never send the selected/page text to a server.

## Supported machines and licensing

- Windows and Linux; Firefox and Chrome are equally important.
- Baseline: 4 CPU cores, 8 GB RAM.
- Optional GPU: 4 GB VRAM. CPU-only operation must be usable.
- Original application source: MIT, open source. Audit third-party executable code, model weights, datasets, and preview assets independently before distribution.
- Separately licensed dependencies may be considered; explain their obligations before choosing them. Do not represent bundled GPL code or separately licensed model weights as MIT.
- Public store distribution versus personal/unlisted distribution remains unanswered. No monetization or account system is requested.

## Confirmed engineering direction

- WXT following its official extension project structure, with explicit Manifest V3 builds for Firefox and Chrome.
- Strict TypeScript for first-party application, worker, and tooling code.
- Bun throughout: runtime, workspace package management, tests, native type checking/formatting, and standalone lab bundling. Run WXT under Bun; no project Node runtime requirement or npm toolchain.
- Bun configuration follows the user's `~/projects/talqo/bunfig.toml` preferences: isolated/global-store installs, a one-day minimum release age, and tabs/double quotes/no semicolons with import sorting. Ignore patterns are adapted to this repository.

## Mandatory first-release reading benchmarks

- Easy: <https://filipkrasa.salonek.org/projects/md-dash/>
- Medium: <https://artificialanalysis.ai/articles/artificial-analysis-intelligence-index-v5>
- Hard: <https://is.muni.cz/th/wdhgd/bc.pdf>

All three must work in the first release; the PDF is not deferred. Define extraction order, selected-text behavior, sentence navigation, word highlighting, and auto-scroll for each. Do not mark a benchmark passed merely because its URL fetches or some text is extracted.

Initial inspection: both HTML benchmarks provide a `main` element in their server responses. The PDF URL returned an HTML JavaScript interstitial to the command-line fetch on 2026-10-29, not PDF bytes. Browser-context access and an integrated PDF text/rendering path must be investigated. These are observations, not passed reading tests.

## Proposed minimal interface — not yet approved

One selection context-menu action and one compact, Edge-like playback bar containing all confirmed controls. Keep voice choice in the bar. Provide explicit model downloads, preview, and delete through a small secondary view reachable from that choice, without turning playback into a model-management dashboard.

Do not auto-install a default voice. If reading is invoked without a suitable installed model, show the shortest clear path to selecting/downloading one. Once ready, remember the user's chosen voice and speed locally. Compute backend selection is automatic.

Word highlighting requires a proven timing and live-text mapping strategy. Auto-scroll should follow playback without fighting deliberate user scrolling. No sentence-click interaction.

The user likes the idea of multiple workers. Treat this as architectural interest, not a requirement for a worker count or a setting: test one synthesis worker plus bounded read-ahead first, and measure any additional workers against CPU contention, model-memory duplication, and the 4-core/8-GB baseline.

## Remaining questions

1. PDF reading opens in a **new extension reader tab**, keeping the original PDF tab. Native PDF viewers cannot host our content UI. Article reading currently uses the browser action; the selection right-click flow remains mandatory.
2. What extraction behavior is expected for captions, citations, headers/footers, bibliography, tables, and formulas in the thesis PDF? Correct reading order and no dropped prose remain fundamental.
3. Latency is now confirmed: **medium models should start within 1 second warm and 2 seconds cold** on the target 4-core device. Faster is welcome. Measure first-audio readiness, not just model loading.
4. What playback-speed range does the user actually need? Performance must be measured at those speeds.
5. Manual voice/language choice is confirmed sufficient for day one; automatic detection is optional only if demonstrably straightforward. Mixed-language behavior remains a later refinement.
6. Should model deletion stop an active reading session using that model? Proposed default: clearly explain and stop that session, then remove the model and its cached data.
7. Public Chrome Web Store/Firefox AMO release, or personal/unlisted distribution initially? Should private browsing be supported initially?
8. Is offline reading after deliberate provisioning sufficient, or must models also be provisionable without internet access?

Previously asked questions on setup, reading scope, hardware, downloads, Piper's UX, languages, original-source licensing, playback controls, highlighting, auto-scroll, session continuity, and sentence clicking are answered and should not be repeated.

## Immediate work

1. Verify a browser-local US-English/Czech inference path and resolve dependency licensing before choosing an engine.
2. Benchmark cold/warm CPU synthesis and investigate GPU inference in both browsers. The current development machine has no exposed GPU; real GPU/Windows validation will need other hardware.
3. Prototype explicit model download/delete/preview behavior and pitch-preserving speed, together with the core selection-reading interaction.
4. Use the user's answers to the remaining interaction questions to refine the smallest coherent playback UI.

## Product-owner feedback — 2026-10-30

- Keep the speed control visibly distinct from a playback timeline. Compact, familiar playback icons with accessible names are appropriate; retain explicit text for Download/Delete. Delete is red.
- Expose the entire available model catalog and its quality variants at launch, not just US-English/Czech samples. Do not equate catalog inclusion with working phonemizer support or license clearance.
- The in-page bar must not add overscroll space. Repeated toolbar activation should reveal existing controls without creating another overlay or changing the reading position. Voices/settings are accessible from the bar; the browser's Options entry remains acceptable.
- Fix Previous on the actual MD Dash article, not just prose fixtures.
- The reported PDF failure is the MUNI thesis in latest-stable Zen. The user's test machine has a 20-core CPU and an 8-GB-VRAM GPU, using the US medium voice. Those are diagnostic details, not replacements for the 4-core/8-GB baseline. The precise Zen version and GPU model are unknown.
- The agent owns implementation decisions and may refactor first-party code autonomously. The user is the product owner; keep the agreed requirements intact and report evidence honestly.

## Voice-list filters — 2026-10-30

Provide separate, visible **Language** and **Quality** dropdowns alongside search. All three filters combine; default to all languages and qualities. Quality choices are Extra low, Low, Medium, and High. Keep filtering entirely local and show clear feedback for an empty result.

Per-model license information belongs behind a compact **License** link. Keep full URLs and extended provenance text out of the model cards.

## Playback readiness — 2026-10-30

An empty or disabled playback bar is not an acceptable setup screen. With no usable downloaded voice, show only a compact explanation, **Choose a voice**, and Close. Once a voice is available, show the compact playback controls with a populated voice choice. Routine Reading/Paused status belongs in accessible announcements, not a permanent second row; show visible feedback when preparation, a playback gesture, or an error needs attention. Size the embedded surface to its actual content, including narrow layouts and dark mode.

## Slow and failed voice downloads — 2026-10-30

A progressing download must not stop merely because it takes a long time. Report stalls and network failures on the affected model card, keep the error visible through filtering, and let the user retry explicitly. Distinguish cancellation from failure. Partial or unverified files must never appear installed.

## Play respects the current selection — 2026-10-30

If text is selected when the user presses Play in the existing overlay, read only that selection, replacing the previous article or selection. Preserve exact selection boundaries and highlighting on web pages and in our PDF reader. With no fresh selection, resume or replay the current reading scope. Previous/next and playback completion stay within that scope. Pause keeps its usual behavior.

Preserve meaningful dots in domains such as `consensus.app`, where “dot” should be spoken. Sentence-ending periods should remain natural pauses. Correct PDF whitespace mapping rather than stripping periods or inserting spaces indiscriminately after them.


## Reading polish and recovery — 2026-11-01

- Shorten redundant language-region labels. Preserve the region when it distinguishes available catalog locales, including English. Keep the overlay voice picker compact.
- Include volume in the listening controls with a clear hierarchy. Reveal its native slider from a speaker button; persist the setting and apply it to playback without changing speech or pitch.
- Join explicitly line-hyphenated words such as `in-\nfrastructure`, preserving real compounds such as `pre-exascale` and domain dots. Highlight all printed fragments of the spoken word.
- Prevent avoidable phonemizer annotation failures. For source-specific pronunciation failures, isolate the problematic passage, preserve usable speech, and tell the user if any text was skipped. Cancellation and runtime failures must remain distinguishable from content failures.
