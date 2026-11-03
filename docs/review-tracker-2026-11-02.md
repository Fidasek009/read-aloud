# Review tracker — 2026-11-02

This is a working assessment of the supplied review, not a release checklist or proof of acceptance. **Fixed** means the identified code/document defect has been changed; **partial** means a change addresses only part of the finding or still needs browser/behavioral validation; **open** means the essential concern remains. Results and current file locations may change during this work. Check [status](feasibility-status.md) and individual evidence files for measurement limits.

## Blockers and major findings

| ID | Status | Evidence / remaining work |
| --- | --- | --- |
| B1 | Partial | Reused sessions no longer report cold initialization timings as warm. Cold initialization still exceeds the target. A new phase probe isolates ~0.27–0.35 s for runtime/tiny-session initialization versus ~5.4–5.5 s for the real model; see [investigation](cold-start-investigation-2026-11-03.md). |
| B2 | Corrected and addressed | Native selection starts before PDF fetching/indexing. Phase measurements show the original ~26 s readiness figure included ~24.6 s of cookie-store fetch delay in the disposable headless profile, not text extraction. Correcting that automation setting reduced full PDF readiness to 1.91 s in one Chrome VM sample. See [investigation](pdf-startup-investigation-2026-11-03.md). Cold speech remains B1; target-device and full-article acceptance remain open. |
| M1 | Partial | Chrome uses direct player-to-offscreen ports and a declared minimum version. A Chrome probe stopped the service worker and resumed a paused reader with its model retained. Idle documents now close after the last client disconnects and retention expires; preparation leases protect new connections. The browser lifetime fixture passed closure/reopening and lease races with shortened deadlines. Chrome 140–149 remains untested. |
| M2 | Partial | Cancellation now blocks stale GPU fallback and output. An active `session.run` is not preempted. The installed ORT Web code reads the `terminate` option when constructing run options, and the upstream [Web issue](https://github.com/microsoft/onnxruntime/issues/29041) documents the difficulty of cancelling an already-running call. Terminating the worker also discards the model and incurs another cold load; a measured design for that tradeoff remains open. |
| M3 | Fixed | Reader discovery uses exact frame-0 extension contexts when tab URLs are absent, validates the source, and waits for controlled navigation before releasing the registry lock. Chrome and Firefox PDF acceptance checks pass omitted-URL discovery, repeated/overlapping reuse, closed-control reopening, and rejection of a reader navigated to another page. |
| M4 | Fixed | Committed changes use one validated storage event; BroadcastChannel only cancels active downloads. Short-lived cancellation channels prevent an old queued deletion cancelling a later download. Chrome and Firefox probes abort a real IDB delete and verify the voice and active reader survive without a committed notification; stale committed notifications are also covered. IDB and storage publication are separate transactions. |
| M5 | Fixed | Duplicate runtime PDF read/stop handlers removed. Chrome and Firefox probes exercise storage commands and the installed background menu handler. |
| M6 | Partial | Reader commands use a validated discriminated union, with shared dimensions and scrolling rules. The response remains a broad union and the surface-specific lifecycle differs. |
| M7 | Partial | Worker commands and responses are typed and validated, including config, speaker and audio; synthesis input validation is shared. Browser probes pass, while malformed transport behavior deserves further coverage. |
| M8 | Partial | Failure codes preserve cancellation, timeout, text, transport and voice categories; unexpected UI errors use retry guidance rather than internal diagnostics. Delivery failure disconnects the client so pending requests fail. Timeout and delivery failure paths still need dedicated browser verification. |
| M9 | Fixed | Playback now uses mutually exclusive typed phases, including preparing, selecting, pausing, ready, ended, failed, no voices, and closed. Controls derive from that phase; closed is terminal and selection replacement checks phase identity. Chrome and Firefox acceptance runs passed recovery and navigation after the refactor. |
| M10 | Partial | Chrome's embedded player sends directly to its tab's content script. Firefox's embedded player has no `browser.tabs` API and still uses runtime/background messaging; both routes were exercised. A Firefox test confirmed `runtime.onConnect` exists in the embedded frame but a content-initiated port did not reach it. [Mozilla describes](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/connect) content-script connections as going to the extension's main process. |
| M11 | Partial | A ready next buffer is scheduled at the prior buffer's audio-clock end; the Chrome product probe checks the scheduled boundary. Audible gaps under jank and Firefox scheduling still need measurement. |
| M12 | Open | Speed adjustments still require re-synthesis and cannot preempt an active inference. The Chrome VM probe records the interval between stop and replacement start requests; that is not an audible-gap measurement or a target-device result. |
| M13 | Partial | A rotated Chrome VM sweep measured four fresh workers per option and four different sentences per worker. Mean load ranged from 5.03 to 7.11 seconds, and mean subsequent-sentence time from 463 to 508 ms; this one model and browser cannot establish a general optimum. See [measurements](evidence/session-loading-2026-11-02.json). |
| M14 | Partial | Binary-search offset lookup and a lazily invalidated node index reduce repeated selection/highlight scans. Both browser probes pass actual MUNI selections and highlights; scaling and fallback for element-boundary selections remain unmeasured. |
| M15 | Fixed | Product and agent decision records updated to reflect selected prototype stack and approved interaction. |
| M16 | Partial | Contradictory dated engineering/status prose was replaced and evidence caveats clarified. Reconcile new results and final implementation before handoff. |
| M17 | Fixed | Engineering baseline condensed; historical research and experiment material are explicitly identified. |
| M18 | Fixed | Product tests moved to `tests/`; obsolete experimental runtimes removed from current workspace, with provenance, notices, lock metadata and Git revision retained in `docs/archive/speech-lab`. |
| M19 | Partial | Shared discovery/helpers, typed volume/speed assertions and typed PDF selection assertions replace critical raw scripts; preview probe is wired. Shared recovery/replay/menu scenarios now serve both drivers and pass the integrated Chrome/Firefox runs. Browser-specific setup remains separate. |

## Minor findings

| ID | Status | Evidence / remaining work |
| --- | --- | --- |
| m1 | Partial | Recoverable GPU initialization failures transfer the model back for CPU fallback; the Chrome probe observed reuse. A worker crash can still require a reread, and fallback still starts another worker. |
| m2 | Fixed | Each synthesis request carries its speaker ID, so changing speakers within a model reuses the session. A pinned 12-speaker model produced reproducible, distinct aligned audio in Chrome and Firefox without a reload; audible quality and target hardware remain unverified. |
| m3 | Partial | Voice controls disabled while preparing; initialization epoch is checked after await. Overlapping programmatic loads still deserve lifecycle tests. |
| m4 | Partial | Firefox uses structured-clone PCM and its full playback probe passes; Chrome keeps Base64 for Chrome 140–147 compatibility. |
| m5 | Partial | Catalog filtering reuses card DOM and cached installed IDs; a Chrome browser regression confirms preview continuity. Firefox filtering remains unverified. |
| m6 | Partial | Highlight loop stops while not playing; browser validation pending. |
| m7 | Partial | Runtime preparation preserves unchanged binaries, restores missing files, and removes stale assets; targeted checks verified file modification times. Both backends remain packaged because either browser can expose WebGPU; removing Firefox GPU assets would break that path. Package-size reduction remains open. |
| m8 | Partial | Documentation now says thread count is configured, not measured. Actual use remains unverified. |
| m9 | Fixed | Shared state parsers and keys replace ad-hoc shapes. Starts and cleanup share a session lock with consistent PDF-registry lock order; source/tab cleanup clears the current reading tab without erasing a newer start. Chrome/Firefox acceptance runs pass. |
| m10 | Fixed | PDF commands have independent session-storage keys, per-reader serialization, acknowledgements, timeouts, and closed-tab handling. Chrome and Firefox PDF probes pass the production command route. |
| m11 | Partial | Native PDF selections use a distinct key per navigation, and source/reader cleanup removes staged keys. The reader aborts fetch and clears its own pending key on page hide. Chrome and Firefox PDF probes pass the handoff and close checks; abrupt browser termination remains untested. |
| m12 | Partial | Navigation polling runs only while controls are open and ignores hash-only changes; Chrome's product probe covers the hash case. |
| m13 | Partial | `unlimitedStorage` is declared and persistent storage is requested during an explicit download. [Chrome documents](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies) eviction protection; the Firefox probe reported persisted storage after downloading. Quota failure and eviction behavior remain untested. |
| m14 | Partial | New downloads record a format version; existing unversioned prototype downloads are treated as version 1 and incompatible versions receive a re-download message. A Chrome IndexedDB fixture verifies both paths; a future migration remains untested. |
| m15 | Partial | Unlisted installed IDs receive a deletable card and committed notification; a Chrome browser regression verifies deletion. Firefox remains unverified. |
| m16 | Fixed | Successful start resets toolbar title and badge. |
| m17 | Partial | Failed PDF text-layer work can retry, with visible feedback. Normal highlighting passes both browser probes; injected failure and retry remain untested. |
| m18 | Fixed | Shared pure sender helpers validate identity, protocol, host, path and background metadata; malformed URLs safely fail. Focused tests and Chrome/Firefox production flows pass. |
| m19 | Fixed | Concrete worker/engine/performance types and allowlists now filter transport and persisted diagnostics. Unknown text, URLs, raw errors, malformed timings and unknown voice strings are excluded; focused tests cover privacy filtering. Warm sessions do not retain cold timings. |
| m20 | Open | PDF detection still relies on URL suffix. |
| m21 | Partial | Runtime build root now uses Bun's file-URL conversion; Windows build has not been tested. |
| m22 | Open | Legacy configs remain in the vault. Existing prototype users may have voices stored without configs; the claim that no consumer exists is unverified. Removing the bridge needs a tested migration or clear re-download flow. |
| m23 | Partial | Model IDs and quality labels now have shared helpers; malformed multi-separator speaker choices are rejected. Broader speaker-name presentation still needs catalog-wide review. |
| m24 | Fixed | AGENTS now names the full checking and formatting scripts. |
| m25 | Fixed | The manifest description describes local reading without asserting an unvalidated quality result. |
| m26 | Partial | Accessible labels changed; final copy and rendered surface need verification. |
| m27 | Partial | Several labels/state copy corrected; comprehensive accessibility verification remains. The two `autofocus` inputs belong to separate popovers: the [HTML standard](https://html.spec.whatwg.org/multipage/interaction.html#the-autofocus-attribute) scopes autofocus to each popover, so both are intentional. |
| m28 | Partial | The Chrome VM probe records MD Dash capture and reader-creation timing. Segmentation and representative long articles remain unmeasured. |
| m29 | Partial | Instrumentation runs in a packaged worker with transferable buffers, cancellation and one fewer full-model allocation. Bun worker tests and actual Chrome/Firefox voice downloads pass; peak memory remains unmeasured. |
| m30 | Partial | Word segmenters are reused by locale and alignment reads the duration array without copying it. PCM copying and linear token lookup remain; their impact has not been measured. |
| m31 | Partial | Speech-service tests share a typed fake backend and clip fixture; the smaller recovery tests retain their own text-specific fixture. |

## Nitpicks

| ID | Status | Evidence / remaining work |
| --- | --- | --- |
| n1 | Resolved by later scheduling change | A queued clip can now be scheduled ahead of the active cursor, so its index is used when that clip becomes active. |
| n2 | Fixed | Voice-list/focus rules consolidated, disabled actions use a normal cursor, and web/PDF readers share the current-word stylesheet. |
| n3 | Fixed | Voice-list footer shortened while retaining preview network and license information. |
| n4 | Fixed | License link has a shorter accessible name; source links and terms retained. |
| n5 | Fixed | Test names now describe behavior. |
| n6 | Open | Naming cleanup remains. |
| n7 | Open | Generated license/training metadata retained deliberately as provenance; symbols remain useful to alignment tests. Other unused stored fields not resolved. |
| n8 | Partial | Local machine/process references removed from primary README/licensing/baseline; duplicated limits may remain. |
