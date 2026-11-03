# PDF startup investigation — 2026-11-03

The approximately 26-second PDF readiness measurement includes a large **fetch delay**, not 26 seconds of PDF extraction. It must not be used to justify replacing PDF.js or parallelizing the entire extraction pipeline.

## Phase measurements

The [focused probe](../scripts/probe-pdf-phases.ts) instruments a copy of the current PDF entrypoint while preserving its sequential page extraction, normalization, visible text layers, and canvas rendering. It records separate fetch, document initialization, `getPage`, `getTextContent`, DOM/run construction, and normalization phases. It also runs a comparison without observer-triggered visible rendering. No production code was modified.

In the first ordinary-pipeline sample, full readiness took 25,918 ms: fetch accounted for 24,643 ms, PDF initialization 251 ms, all 60 `getPage` calls 179 ms, all text extraction 713 ms, DOM/run construction 44 ms, and normalization 4 ms. The visible first page's text layer and canvas completed in 48 and 38 ms, overlapping other work. A subsequent extraction-only navigation took 782 ms, including a 33 ms fetch. [Initial phase evidence](evidence/pdf-phases-2026-11-03.json).

The comparison changes rendering and follows a first navigation, so it cannot isolate a pure rendering penalty: browser, worker-code, font and network caches can also differ. A later instrumented run under more variable VM load spent about 3.1 seconds in text extraction. These observations do not establish a universal extraction speed or the four-core target's performance.

## Where the fetch waited

Serving the fixture from a [separate Bun subprocess](../scripts/probe-fixture-server.ts) reproduced the roughly 24.6-second response-header wait. The GET reached that independent server only after the wait; the body then transferred in tens of milliseconds. This excludes starvation of a same-process `Bun.serve` handler as the explanation. [Separate-server measurements](evidence/pdf-phases-child-2026-11-03.json).

Chrome NetLog placed the stalled request before its HTTP transaction, alongside a pending persistent-cookie-store load. That store's load lasted 25,457 ms; the request's cookie-database-key load waited approximately 24,594 ms. Proxy resolution subsequently returned `DIRECT` immediately. The event name `KEY_LOAD_STARTED` refers to loading a cookie database key/domain; it is not direct evidence of an encryption-key operation. [Condensed network evidence](evidence/pdf-network-cold-start-2026-11-03.json), [Chromium event definitions](https://chromium.googlesource.com/chromium/src/+/main/net/log/net_log_event_type_list.h).

Selecting `--password-store=basic` for a new **disposable headless test profile** reduced the cookie-store load to 215 ms and the first PDF fetch to 161 ms. The ordinary PDF pipeline then reached full readiness in 1,913 ms; the subsequent extraction-only navigation took 1,147 ms. This points to the development environment's desktop-store initialization as the source of the fixed delay. It is an inference from the NetLog and controlled profile change, not a captured D-Bus stack trace. [Controlled-profile measurements](evidence/pdf-phases-inline-basic-2026-11-03.json).

Chromium documents `basic` as a plain-text password store. It belongs only in isolated automation profiles containing fixture data. The shared test argument in `scripts/probe-helpers.ts` does not alter a user's browser, system keyring, extension manifest, source authentication, or production fetch credentials. Keep `credentials: "include"` where source PDFs require the browser's session. [Chromium Linux password storage](https://chromium.googlesource.com/chromium/src/+/main/docs/linux/password_storage.md).

## Engineering consequence

Correct the automation environment and distinguish source-fetch time from PDF preparation in evidence. Preserve the existing early native-selection playback path, which can speak the handed-off text before fetching/indexing the PDF. The current measurements do not justify a more complicated PDF extraction scheduler. PDF.js already exposes the document/page proxies, asynchronous text extraction, and cancellable rendering used by the reader. [Document API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html), [page API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html).

This investigation does **not** validate first audio, remote MUNI network latency, physical GPU behavior, Firefox, Windows, normal interactive profiles, or the target four-core machine. The speech engine's separate cold-start target remains unmet.

To reproduce after a Chrome build and provisioning the pinned thesis fixture:

```sh
BUN_CHROME_PATH="$PWD/.cache/test-chrome" bun scripts/probe-pdf-phases.ts
PDF_PHASE_SERVER=child BUN_CHROME_PATH="$PWD/.cache/test-chrome" bun scripts/probe-pdf-phases.ts
PDF_PHASE_BASIC_KEYRING=1 BUN_CHROME_PATH="$PWD/.cache/test-chrome" bun scripts/probe-pdf-phases.ts
```

The probe writes measurements without reading text to `docs/evidence/` and a default-capture NetLog to the ignored `.cache/` directory. Raw NetLog files can lack a JSON footer when the automation driver exits; the condensed evidence retains only completed relevant events. All profiles and server processes are temporary.
