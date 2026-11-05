# Platform research and constraints

Researched **2026-10-29**; sources are upstream documentation and policy and can change. The chosen implementation is described in [engineering](engineering.md), [licensing](licensing.md), and [status](feasibility-status.md).

## GPU and CPU inference

WebGPU availability varies by browser, OS, driver, and hardware. Firefox documents support on Windows and Apple Silicon macOS with platform limits elsewhere; Chrome also restricts hardware. Do not require experimental browser flags. Browser API presence does not prove that the exact packaged runtime and model work. Request an adapter, load and run the real model, and recover from initialization failure, unsupported operators, allocation failure, and device loss with local CPU inference. Sources: [WebGPU implementation status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status), [Firefox 147 release notes](https://www.firefox.com/en-US/firefox/147.0/releasenotes/), [ONNX Runtime Web support matrix](https://onnxruntime.ai/docs/get-started/with-javascript/web.html).

ONNX Runtime Web requires cross-origin isolation for WebAssembly multithreading and treats float16 as a poor CPU choice. Run synthesis in a packaged worker, verify `crossOriginIsolated` in the actual extension context before enabling threads, and always support single-thread operation. Measure CPU and battery impact instead of using every available core indefinitely. Sources: [ONNX Runtime performance guidance](https://onnxruntime.ai/docs/tutorials/web/performance-diagnosis.html), [thread requirements](https://onnxruntime.ai/docs/tutorials/web/env-flags-and-session-options.html).

## Browser lifecycle

Chrome's supported extension document for this work is its offscreen API. Offscreen documents have restricted extension API access, and audio documents can close after 30 seconds without audio. Firefox Manifest V3 uses non-persistent background scripts/event pages rather than Chrome's service worker. Do not assume a background page stays alive because a promise is pending, and do not use silent-audio or timer tricks to defeat browser lifecycle. Sources: [Chrome offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen), [MDN background manifest](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background), [MDN background scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts).

Session and request IDs must reject late synthesis results after stop, skip, or explicit replacement. Keep only the recovery state required by the confirmed behavior: continue on tab switch, stop on source navigation or closure.

## Extraction, highlighting, and PDFs

Mozilla Readability is a candidate for identifying article content, but it mutates the supplied document and plain extracted text does not preserve live DOM positions. Highlighting and start-from-selection require a mapping from spoken segments to original text nodes. Word timing must come from measured speech, not duration estimates. Source: [Mozilla Readability](https://github.com/mozilla/readability/blob/main/README.md).

Built-in and protected PDF viewers are not ordinary article DOMs; content scripts cannot read every browser surface. The mandatory thesis must be tested through an integrated rendering/text path before its reading behavior is accepted.

## Security, permissions, and accessibility

Bundle executable code under the extension CSP; user-selected PDF origins and explicit voice downloads are the network exceptions. Prefer `activeTab` plus `scripting` for user-invoked reading and request broader host access only when needed. Validate every cross-boundary message and treat page content as untrusted. Sources: [Chrome remotely hosted code](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code), [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab), [WebExtension CSP](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_Security_Policy), [Firefox add-on policies](https://extensionworkshop.com/documentation/publish/add-on-policies/).

New Firefox extensions must declare actual data collection through the built-in consent system. Previews use the network only after an explicit Listen action; reading text must never be sent to a server. Source: [Firefox built-in data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).

Target WCAG 2.2 AA for applicable UI: semantic controls, keyboard operation, visible focus, sufficient contrast, and accessible status/error messages. WCAG 3 remains a draft and is not a conformance claim. Sources: [WCAG 2.2](https://www.w3.org/standards/history/WCAG22/), [WCAG 3 draft](https://www.w3.org/TR/wcag3/).

## Feasibility gates

Before release, measure listening quality, cold and warm time to first audio, real-time factor, inter-chunk gaps, peak memory, download/installed footprint, and stop latency on the target machine. Exercise GPU and forced CPU-only paths, device loss, browser lifecycle transitions, offline reading after provisioning, page-fidelity edge cases, and accessibility. Audit the built Chrome/Firefox archives, manifests, CSP, remote-code paths, dependency/model licenses, and data declarations. A local development build is not a store-ready extension.
