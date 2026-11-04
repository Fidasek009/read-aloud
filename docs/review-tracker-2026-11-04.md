# Review findings — 2026-11-04

Statuses describe verified code changes, not release acceptance. Browser, target-device performance, physical GPU, Windows, audio quality, and store-distribution evidence remain separate gates in [acceptance status](feasibility-status.md). A finding is not closed merely because an implementation was changed.

| Finding | Status | Verification or remaining work |
| --- | --- | --- |
| F1 · PDF commands during indexing | Verified in browser probes | Selection commands capture their scope before indexing can start an article. Pending article preparation does not hold the background read lock; newer selection/close invalidates it. Dedicated PDF probes gate extraction and exercise both races. |
| F2 · Reading-session ownership | Verified in browser probes | ReaderSession owns source scope, stable live ID, revision, replacement, and close on both surfaces. Tests cover stale preparation and closed sessions. |
| F3 · Duplicate speech host/protocol | Verified in browser probes | Shared typed host dispatcher and client-port registry serve both hosts; malformed requests, rejected controls, and closed-client replies have behavioral tests. |
| F4 · Duplicate reader dispatcher | Verified in browser probes | Shared dispatcher owns document, selection, highlight, resize, and close semantics; web/PDF provide source-specific capture and mapping. |
| F5 · PDF storage mailbox | Removed; browser probes pass | Loaded reader commands use typed addressed runtime delivery. The command mailbox, revision, storage acknowledgement, and cleanup protocol are gone. |
| F6 · Playback entrypoint responsibilities | Verified in browser probes | Playback controller and native-audio adapter separate behavior from entrypoint binding; controller tests cover replacement, preparation intent, cancellation, recovery, and read-ahead. |
| F7 · First-chunk latency | Measured on VM; target acceptance open | First chunks target 48 characters, preserving longer words within the normal 240-character limit. Sentence/source-boundary tests protect content. The rotated [thread/chunk experiment](evidence/thread-and-chunk-2026-11-04.json) verifies shorter-prefix synthesis on this VM; target-device and subjective continuity acceptance remain open. |
| F8 · Session optimization options | Updated; broader acceptance open | Full graph optimization with prepacking disabled won all four rotated rounds on the recorded model/CPU VM. Production adopts it; other models/devices remain unmeasured. |
| F9 · GPU inference failure fallback | Updated; hardware check pending | Inference fallback transfers retained GPU model bytes to CPU and remembers GPU failure for the browser session. This intentionally retains an extra model-sized buffer while on GPU. |
| F10 · Independent retention clocks | Verified in host probe | SpeechService no longer disposes on an independent idle timer. Host lifetime owns model/document retention; startup/close claim coordination remains. |
| F11 · Shared-model cancellation | Verified in controller tests | Controller treats shared-model cancellation as paused playback rather than failure; behavioral tests cover cancellation recovery. |
| F12 · Serialized model read/worker startup | Updated | Worker creation precedes and overlaps the IndexedDB model read. New target-device timing remains unmeasured. |
| F13 · Serialized reader initialization | Updated; measurement pending | Initial document, voice-list, and preference reads overlap; preferences are read once for initialization. Both product probes exercise the resulting startup path; the residual has not been isolated in an A/B measurement. |
| F14 · First-buffer vs audible timing | Verified in product probes | Both product records contain distinct first-buffer and native `playing` timings, including initial preparation. Physical speaker output is not measured. Cold startup still misses acceptance. |
| F15 · Discarded completed synthesis | Updated | Valid completed clips enter the bounded cache after queue cancellation; close/model/owner changes prevent stale repopulation. |
| F16 · Excessive live announcements | Updated; accessibility acceptance open | Voice counts are descriptive rather than live. PDF indexing suppresses page-by-page live announcements and restores status announcements on ready/failure. Player rewrites status only when its text changes. |
| F17 · Speed-popover focus | Verified in browser probes | Preparing dismisses the speed popover and transfers focus to the enabled volume button before disabling the slider. Both product probes exercise this transition. |
| F18 · Unhandled exit-path sends | Updated | End/close delivery failures have explicit rejection cleanup. |
| F19 · Duplicated literals | Updated | Shared reading limits/highlight names, local storage keys, timeout/abort producers, and host lock/constants replace duplicated behavioral literals. Browser fixture schemas share production definitions. |
| F20 · Unshared envelope tags | Verified in browser probes | Reading envelope factories/tags and speech-host discriminated contracts are shared by senders and listeners; malformed boundary messages are tested. |
| F21 · Dead generality | Updated | Removed unused AudioContext diagnostics, implicit client reload, and catalog configuration re-export; configuration imports have one source. |
| F22 · Import placement | Updated | Production imports precede declarations and related contracts use shared imports. |
| F23 · Ambiguous names | Updated | Playback behavior and output are named responsibilities; entrypoint/status binding no longer shares the original mutable-state namespace. |
| F24 · Error-copy duplication | Verified in browser probes | Playback recovery/status wording is centralized; probes follow behavior rather than private diagnostic strings. |
| F25 · Living documentation | Updated | Product principles state current rules without answer history. Engineering baseline has no stale update date or reviewer dialogue. Local-PDF detail lives in known issues; README separates voice management, PDF checks, update steps, and diagnostics. |
| F26 · Probe schema/helper duplication | Verified in browser probes | Voice fixtures use the production IndexedDB schema/commit helper. Catalog counts derive from the catalog. Preview polling and committed voice-change notifications use shared helpers. Chrome CDP evaluation has one implementation. |
| F27 · Test quality and missing coverage | Updated | Slow-download tests assert progress/integrity rather than elapsed wall time; diagnostics assert allowed fields rather than exact field count. Engine dependencies are injectable for behavioral concurrency/cancellation tests. The duplicate service timer and PDF mailbox were removed rather than preserving tests for obsolete mechanisms. |
| F28 · Sender authorization | Verified in browser probes | Start/stop messages require the extension background sender; reader RPC accepts the player/background as specified. Product probes enter through the installed background hook rather than privileged direct calls from Voices. |
| F29 · Partitioned storage premise | Clarified | The scopes differ: browser.storage.local is extension-scoped, while embedded-frame IndexedDB may be partitioned. Shared speech-host catalog reads avoid embedded model-store access; direct preferences use extension storage. |
| F30 · PDF loading complexity | Verified in browser probes | PDF file/site permission and chooser flows are extracted into pdf-access.ts; reader loading owns document lifecycle separately. |
| F31 · Mixed reading-module responsibilities | Updated | Chunk segmentation, layout/highlight geometry, host contracts, dispatch, and DOM extraction have separate modules. |
| F32 · Thread policy/Firefox isolation | Platform limitation; tuning open | Firefox extension SharedArrayBuffer support is unresolved in Mozilla 1673477/2019902. Keep its CPU path single-threaded; configured-thread diagnostics do not prove actual usage. Configured 1/2/3/4-thread modes now have four rotated VM rounds and paired first-chunk measurements in [evidence](evidence/thread-and-chunk-2026-11-04.json). Target-device tuning and independent thread observation remain open. |
| F33 · Sequential PDF article extraction | Verified; comparative benchmark open | Bounded two-page text prefetch preserves page order. The real 60-page PDF probe measured initial text readiness and passed normal and deliberately delayed indexing scenarios. No sequential/concurrent A/B speedup or target-device claim is established. |
| F34 · PCM validation/WAV conversion cost | Accepted, low priority | The measured cost is scanning/conversion, not allocation count. Preserve validation and required ownership boundaries; no speculative allocation removal. |
| F35 · Redundant wrapper and stale comment | Updated | Playback extraction removes the redundant state wrapper, mixed message class placement, and obsolete AudioContext comment. |
| F36 · Dynamic test re-imports | Updated | Catalog and speech-service tests use static imports for already imported contracts. |
| F37 · HTML/quality conventions | Updated | Entry HTML metadata/names are consistent; voice quality choices derive from catalog qualities and the shared label function. |
| F38 · Probe launcher duplication | Verified in browser probes | Nine probes share extension-copy/fixture setup; seven Chromium probes share executable/profile/extension launch policy. Fixture launchers close their own browser process and delete their own profile directory; preview/host probes verify cleanup. The historical keyring experiment retains explicit configuration because it measures that configuration. |

The earlier [review tracker](review-tracker-2026-11-02.md) retains its historical finding IDs and evidence. Do not interpret pending entries here as newly reproduced product failures.


## Verification

The Chrome 155 product probe and Zen 1.24b Firefox product probe pass actual local synthesis, playback controls, selection recovery, deletion, and PDF/word mapping paths. The dedicated Chrome PDF probe additionally holds extraction to verify both indexing races. The host probe passes real English offscreen inference and broker-owned GPU policy persistence, plus retention/closure/preparation cases using shortened deadlines. Remote-preview and offline-recovery checks pass without bundled audio, prefetch, or model requests.

The offscreen check caught and corrected a Chrome-only API assumption: offscreen documents cannot access storage directly. The new GPU policy commands use authorized runtime messaging to the background. A separate cache epoch also preserves pending model preparation during ownership changes while preventing old text from repopulating cleared caches.

Evidence files retain their original names but carry current `recordedAt` timestamps. `textReadyMs` measures PDF indexing; `articleChecksElapsedMs` includes acceptance checks and is not startup latency. Configured thread counts, generated PCM, native playback readiness, and physical audible output are distinct observations.

Final combined checks: **91 tests / 462 assertions**, all three TypeScript environments, Chrome/Firefox builds, and repository formatting pass.
