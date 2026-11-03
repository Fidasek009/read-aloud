# Local read-aloud implementation research

Researched: **2026-10-29**. This is historical discovery material, not the current architecture record. The prototype now uses Piper voice data, ONNX Runtime Web, and Spellophone/eSpeak NG; consult [engineering](engineering.md), [licensing](licensing.md), and [status](feasibility-status.md) for current implementation and acceptance. Sources below are upstream documentation, source code, model cards, and browser policy; upstream pages can change.

The initial findings below preceded the user's detailed product answers. Those answers now require US English **and Czech**, explicit model downloads/delete/preview, pitch-preserving speed, an Edge-like bar with word highlighting/auto-scroll, continued audio on tab switch, with stop on source navigation/closure, and MIT original-source licensing. The [historical browser experiments](archive/speech-lab/README.md) must be distinguished from upstream claims and full-product verification.

## Historical first experiment

With Czech mandatory, Kokoro and the small KittenTTS browser models cannot cover the first release alone. The earlier isolated lab tested English/Czech synthesis, local executable packaging, CPU inference, and duration-based speed using Supertonic 3's MIT reference implementation with ONNX Runtime. Supertonic was not selected for the product prototype. Piper licensing, compatibility, quality, word timing, performance, and lifecycle remain release gates. Model choice is user-facing; inference-provider choice should remain automatic.

The critical question is whether acceptable natural speech can start quickly and continue without gaps on the weakest supported CPU. A beautiful control bar cannot compensate for stalls, missing text, or a download/setup experience the user rejects.

## Browser constraints

### GPU support must be tested end to end

The WebGPU working group's implementation status lists Firefox support on Windows and Apple Silicon Macs, with important platform limitations elsewhere, including Firefox Linux. Chrome also has hardware/driver/platform restrictions. Do not require users to change experimental browser flags. Source: [WebGPU implementation status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status).

Firefox's release notes independently confirm WebGPU on Apple Silicon across supported macOS versions starting in Firefox 147. Source: [Firefox 147 release notes](https://www.firefox.com/en-US/firefox/147.0/releasenotes/).

ONNX Runtime Web documents WebAssembly CPU and WebGPU execution providers, but its browser matrix still marks Firefox WebGPU unsupported. This conflicts with the browser's broader API availability. **Inference:** browser API support alone does not establish runtime/model compatibility. The prototype must test the exact packaged runtime and model on Firefox as well as Chrome. Source: [ONNX Runtime Web support matrix](https://onnxruntime.ai/docs/get-started/with-javascript/web.html).

Proposed behavior: request a GPU adapter, check necessary features, load and run the actual model, and use the GPU only if that path succeeds. Recover from initialization failures, unsupported operators, allocation failures, and device loss using local CPU inference. Do not expose provider jargon in the normal interface. Prevent duplicate or skipped speech during recovery. Download size and a second model variant needed for fallback must be included in setup budgets.

### CPU fallback must be a real product path

ONNX Runtime Web requires cross-origin isolation for WebAssembly multithreading. Its documentation also cautions that float16 is a poor CPU choice and describes worker execution for keeping the UI responsive. Source: [ONNX Runtime Web performance guidance](https://onnxruntime.ai/docs/tutorials/web/performance-diagnosis.html).

Proposed implementation: run synthesis in a packaged dedicated worker; verify `crossOriginIsolated` in the actual extension context before enabling threads. Always support single-thread operation. Inspect the extension COOP/COEP configuration, model-download CORS behavior, and runtime worker-loading strategy together. Do not modify a visited website's security headers. Measure CPU usage and battery impact instead of using every available core indefinitely.

### Audio cannot live in the toolbar popup

Chrome's supported extension document mechanism is its offscreen API. Offscreen documents have restricted extension API access, and `AUDIO_PLAYBACK` documents can close after 30 seconds without audio. Source: [Chrome offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen).

Firefox Manifest V3 uses background scripts/event pages rather than Chrome's extension service-worker implementation. Those pages are non-persistent. Sources: [MDN background manifest](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background), [MDN background scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts).

The prototype uses Chrome's offscreen document for the inference worker and Firefox's background page for inference; playback remains in the reading tab. Validate startup, long playback, pause, view closure, memory release, suspend/restart, and reconnection. Do not assume a background page stays alive because a promise is pending or use silent-audio or timer tricks to defeat browser lifecycle.

Session IDs and request IDs should reject late synthesis results after stop, skip, or explicit replacement. The user requires continued audio on tab switch but stop on source navigation/closure. Retain only the minimum recovery state required by that behavior.

## Speech engine candidates

### Kokoro: strong initial English candidate

Kokoro-82M publishes Apache-2.0 weights. Its voice documentation includes US/UK English, Japanese, Mandarin Chinese, Spanish, French, Hindi, Italian, and Brazilian Portuguese, with varying quality and language support. These are model capabilities, not a promise about a browser wrapper. Sources: [model card](https://huggingface.co/hexgrad/Kokoro-82M), [voice documentation](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md).

The upstream `kokoro-js` library documents browser-local WebAssembly and WebGPU operation plus incremental text splitting. It recommends different precision choices for GPU and CPU. The ONNX file listing shows approximately 92.4 MB for `model_quantized.onnx` and 326 MB for full precision; runtime files, voice vectors, and preprocessing assets are additional. Sources: [JavaScript usage](https://github.com/hexgrad/kokoro/blob/main/kokoro.js/README.md), [ONNX artifacts](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/tree/main/onnx).

Source inspection identifies constraints to address: the JS phonemizer currently implements US/UK English; non-English voices are commented out in its voice registry. Long chunks can be truncated by tokenization, and normal synthesis returns waveform audio without word timestamps. Proposed evaluation: English first, token-aware splitting that never silently drops text, sentence-level playback boundaries, and a separate feasibility check for any requested additional language. Sources: [phonemizer](https://raw.githubusercontent.com/hexgrad/kokoro/main/kokoro.js/src/phonemize.js), [voice registry](https://raw.githubusercontent.com/hexgrad/kokoro/main/kokoro.js/src/voices.js), [synthesis implementation](https://raw.githubusercontent.com/hexgrad/kokoro/main/kokoro.js/src/kokoro.js).

Review the entire dependency chain, including the phonemizer's code/assets and notices; the model's Apache license alone is insufficient to establish the packaged extension's licensing. Adapt any upstream mutable remote voice URLs to the product's pinned asset strategy.

### Piper: important baseline and language candidate

The maintained OHF Piper engine is GPL-3.0 and embeds eSpeak NG for phonemization. Its repository is seeking maintainers. Treat engine code, browser port, phonemizer, and individual voice weights as separate artifacts to audit. Source: [OHF Piper](https://github.com/OHF-Voice/piper1-gpl).

The user's reference extension advertises browser-local ONNX/WASM speech and a large multilingual voice catalog. This is evidence of a relevant implementation to inspect, not proof of our performance or GPU path. Its listed UI includes a model manager and many controls; we should not inherit that product structure. Source: [Piper Read Aloud listing](https://addons.mozilla.org/en-GB/firefox/addon/piper-read-aloud/).

Piper voice licenses require individual review. For example, the Lessac medium model card points to separate dataset-license terms; a repository-wide MIT tag does not settle those terms. Source: [Lessac model card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/lessac/medium/MODEL_CARD).

Prototype question: can a vetted browser port provide the user's preferred Piper voice with fast CPU playback, a working GPU path where supported, acceptable packaging, and compatible redistribution terms? Do not reject Piper because the existing extension's interface is poor; the engine and UI are independent choices.

### KittenTTS: compact challenger, with SDK caveats

The official browser SDK supports the lightweight 0.8 models and describes itself as a developer preview. Its default ONNX Runtime WASM loading uses a CDN, and its generation analytics are enabled by default. For this product, package the executable runtime locally, disable analytics explicitly, audit all network requests, and test that cached voices operate without a connection. Sources: [KittenTTS Web](https://github.com/KittenML/KittenTTS-web), [SDK analytics and setup](https://github.com/KittenML/KittenTTS-web/blob/main/docs/getting-started.md).

The nano int8 model card reports roughly 25 MB and eight preset voices. This is a model-file figure, not the full installed/download footprint. Source: [KittenTTS nano 0.8 int8](https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8).

The main repository now also describes KittenTTS 2, a different, larger multilingual family with native runtime requirements and separately licensed weights. Do not confuse its capabilities, licensing, or deployment needs with the small browser SDK's models. Source: [KittenTTS models and licenses](https://github.com/KittenML/KittenTTS).

### Other options and exclusions

Supertonic's upstream repository was archived in September 2026 and explicitly ends development/support. This is a real maintenance risk. Its MIT reference code can nevertheless support an isolated experiment with maintained ONNX Runtime; this does not establish that adopting or maintaining it is the right product decision. Source: [Supertonic archive notice](https://github.com/supertone-oss-archive/supertonic).

The Web Speech API cannot establish our requirements by itself: browser voice lists can include remote synthesizers. A local-service flag distinguishes them, but does not guarantee a consistent natural voice across devices. Do not silently substitute an arbitrary system or remote voice. Source: [SpeechSynthesisVoice.localService](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesisVoice/localService).

## Extraction, timing, and seamless page integration

Mozilla Readability is a candidate for identifying article content. It mutates the supplied document, so parse a clone, not the live page. Plain extracted text does not preserve all live DOM positions needed for highlighting or start-from-here. Source: [Mozilla Readability](https://github.com/mozilla/readability/blob/main/README.md).

Proposed pipeline: capture explicitly selected text when that behavior is chosen; otherwise identify the main article. Retain a mapping from spoken segments to original text nodes if page highlighting/navigation is in scope. Segment by language and model token limits; preserve document order, punctuation, and content. Test abbreviations, dates, numbers, headings, lists, long sentences, code, and dynamic pages. Avoid stripping legitimate prose through broad heuristics. If extraction is uncertain, offer the agreed simple recovery, rather than reading navigation and advertisements indiscriminately.

The user now requires word highlighting and auto-scroll. Word highlighting needs timing data or a separate alignment method; dividing audio duration by word length is an estimate. Use playback time as the clock and re-sync after pause, skip, speed changes, and output-device delays. Do not claim exact word alignment from a waveform-only API. A speech-only feasibility result does not clear this required gate. Highlighting attaches to the source document; closing or navigating that source now stops the session, per the latest user clarification.

The thesis PDF benchmark is now mandatory for the first release. Built-in viewers and protected browser pages are not ordinary article DOMs; investigate an integrated PDF rendering/text path. Do not assume content scripts can read every browser surface. General OCR is not yet requested; inspect the mandatory thesis before assuming text extraction suffices. If that benchmark requires OCR, its acceptance requirement still applies.

## Current engineering and release baseline

These are proposed concrete practices for the user's 2026 requirement, not a claim that a single universal "2026 industry standard" exists.

- **Manifest V3 with explicit browser differences.** WXT with strict TypeScript is now selected, running under Bun. See [engineering.md](engineering.md) for the verified baseline. WXT documents multiple browser targets but defaults Firefox to MV2, so configure MV3 explicitly if selected. No UI framework is chosen. Source: [WXT browser targets](https://wxt.dev/guide/essentials/target-different-browsers.html).
- **Bundle all executable assets.** Chrome's remote-code rules cover JavaScript and WASM. Treat model weights as data only after checking the actual loading path and store interpretation; do not assume a demo's CDN defaults are extension-safe. Source: [Chrome remotely hosted code guidance](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code).
- **Strict CSP.** Enable only the required WASM capability, use packaged workers, and avoid eval, inline handlers, remote scripts, and unnecessary web-accessible resources. Source: [WebExtension content security policy](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_Security_Policy).
- **Least privilege.** Investigate `activeTab` plus `scripting` for user-invoked reading and narrowly scoped asset-download access. This may avoid permanent access to every website. Persistent selection affordances would require revisiting that tradeoff. Source: [Chrome activeTab](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab).
- **Firefox review requirements.** Package self-contained executable code, request only necessary permissions, and preserve website security. Prepare reproducible builds/source for review as applicable. Source: [Firefox add-on policies](https://extensionworkshop.com/documentation/publish/add-on-policies/).
- **Explicit data declarations.** New Firefox extensions must use the built-in data collection consent system. Declare actual behavior, including dependency behavior; investigate how model-download requests are classified before choosing declarations. Source: [Firefox built-in data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).
- **Accessibility.** Target WCAG 2.2 AA for applicable UI criteria, with semantic controls, keyboard operation, visible focus, sufficient contrast, and accessible status/error messages. WCAG 3 remains a working draft, so do not claim it as a completed conformance standard. Sources: [WCAG 2.2 status](https://www.w3.org/standards/history/WCAG22/), [WCAG 3 draft](https://www.w3.org/TR/wcag3/).
- **Supply chain and storage.** Pin dependencies and model revisions, retain license notices, verify asset integrity against bundled trusted metadata, bound downloads, and commit lockfiles. Separate persistent model assets from transient page text/audio; avoid storage sync for models or reading content. Support failed/interrupted downloads and stale cache detection. Model hosts still observe ordinary download-request metadata even though inference is local; describe that honestly.

## Feasibility gates before product implementation

1. **Listening:** the user accepts at least one English voice on representative prose, technical text, numbers, and longer reading. Test prospective non-English languages separately.
2. **Device performance:** measure cold and warm time to first audio, real-time factor (synthesis time / audio duration), inter-chunk gaps, peak memory, download/installed footprint, and stop latency. Sustained synthesis needs headroom beyond real time at the agreed listening speeds. Set release budgets after baseline measurements and device requirements, not invented benchmark numbers.
3. **GPU and CPU:** exercise real GPU inference, forced CPU-only inference, unsupported GPU initialization, device loss, and single-thread fallback in both packaged browser builds. Record browser, OS, driver, runtime, model revision, and precision for each result.
4. **Lifecycle:** close the popup; switch tabs/windows; pause long enough to trigger idle handling; stop during synthesis; skip repeatedly; navigate/close the source tab; suspend/resume the machine; restart the extension context. Validate against agreed session behavior.
5. **Offline and privacy:** after provisioning, block the network and restart the browser before reading. Test model/voice assets, dictionaries, runtime files, and cache behavior. Verify no text, audio, analytics, or hidden runtime requests leave the device.
6. **Page fidelity and accessibility:** test representative articles, selections, dynamic pages, extraction failure, keyboard-only controls, and screen-reader feedback. Include live-text mapping if highlighting is chosen.
7. **Distribution:** audit the actual built Chrome/Firefox archives, manifests, CSP, remote-code paths, dependency/model licenses, data declarations, and review instructions. A local development demo is not a store-ready extension.

Current implementation and outstanding gates are tracked in [engineering](engineering.md) and [status](feasibility-status.md). A separate companion app is explicitly excluded. The specified thesis PDF is included in the first-release scope. Accounts and additional reading modes are outside that scope.
