# Licenses and release checklist

Reviewed **2026-11-05**. Original Read Aloud source and artwork are **MIT**. Third-party components retain their own terms. This document is the current checklist; the supporting inventories are reference evidence, not another approval process.

## What we distribute

| Component | Terms | What we supply |
| --- | --- | --- |
| Original code and artwork | MIT | Copyright and license text |
| Spellophone 0.2.1 / eSpeak NG 1.52.0 | GPL-3.0-or-later, plus component notices | Full pinned sources, build instructions, notices and recipient source access; the combined extension is GPL-covered |
| ONNX Runtime 1.31.1 / WXT runtime 0.21.5 | MIT and upstream notices | License/copyright notices and pinned source directions |
| PDF.js 6.5.438 / ONNX schema | Apache-2.0 and component notices | License texts, font/decoder/runtime notices and pinned source directions |
| Compiler/runtime code embedded in WASM | Component-specific terms | Emscripten, musl, libc++, Rust and other applicable texts and source directions |

Original files remain MIT; the combined package must not be described as MIT-only. Mozilla's listing uses a custom license containing the MIT/GPL texts and notices. web-ext is MPL-2.0 development/publishing tooling, not shipped extension code.

## Release checklist

- Preserve the license/copyright and modification notices in [NOTICE.md](../NOTICE.md) and the installed notices page.
- Keep the [pinned archives and supplier build recipes](../vendor/source/README.md) and [public source-access directions](../vendor/source/SOURCE-ACCESS.md) available to recipients at the release tag. Private AMO reviewer sources alone are insufficient.
- When shipped dependencies change, update their notices, source versions and build materials together.
- Assess model/preview conditions for the actual integration described below. Do not claim unrestricted rights for the whole catalog.

Run **bun run check:licenses** to verify the required files, source/archive checksums and dependency/source version alignment. CI runs it, and standalone live publishers run it before publishing. Package checks also verify that the installed notices page and its linked local license texts are included. Routine application/documentation edits require no hash refresh or approval label. There is no separate release mode, review JSON or owner-operated ready switch.

This automated check verifies supplied materials. It does not grant permission, decide the open questions below or establish product/store acceptance. The previous blanket model/preview CI holds have been removed as part of simplifying the process; their underlying questions remain documented and unresolved. This change neither clears those questions nor authorizes a release on their behalf.

## Models and previews: exact scope and open questions

No model weights, training recordings or preview audio are bundled or rehosted. A user explicitly downloads a pinned model from its source host or streams an unchanged sample on Listen. The local ONNX graph is instrumented for word timing without changing the original weights. Each catalog entry links its pinned model card. This differs from distributing those files, but does not establish permission for every possible use.

**Established grants:** LJSpeech medium has an [original-trainer public-domain model grant](https://brycebeattie.com/files/tts/). Kasandra medium has an owner-issued **CC BY 4.0** grant from Ondřej Šimek in [Piper PR #93](https://huggingface.co/rhasspy/piper-voices/discussions/93), tied to our exact checkpoint (SHA-256 09d08aa23691ed2d53fb3db242cfe82b189adf9c1812dd5fe928b5789ed76df7). Its author/source/license credit and graph-change notice are supplied. The separate paid-package README does not revoke that grant. Preview transcript credit identifies Wikipedia contributors, Rainbow/Duha, history links and CC BY-SA terms in the installed notices.

**Two open assessments remain:**

1. **Other model terms:** Jirka/other Lessac-fine-tuned checkpoints have unresolved grant/lineage scope; some catalog cards declare unknown or absent model terms. Complete the applicable attribution/change-notice assessment for the offered download and local instrumentation. A dataset license is not automatically a model grant, and a training contract does not automatically apply to resulting weights.
2. **Preview use:** the upstream sample repository has no blanket audio license. The authorization/conditions for our unchanged, on-demand source-host streaming/caching remain unconfirmed. Missing root license text alone does not establish that linking or streaming is prohibited; transcript attribution alone does not establish an audio grant.

[Public-source follow-up](preview-model-research-2026-11-05.md) records the private CC BY modification/attribution distinction. The [original preview collection](../voice-previews/README.md) covers production work for the entire 178-model catalog, using one generator and original native-language texts. The owner requires in-extension playback and consistent handling of every model and quality variant. Recordings remain local until separately hosted; generation does not establish a model/output grant or change the production preview URLs.

These are specific evidence questions, not established findings that all models or previews are unlawful. No third party has been contacted, and contacting one is not a required workflow step. Known restrictions must be respected; uncertain scope must be assessed without inventing either a grant or a prohibition. Product acceptance remains tracked separately in [feasibility status](feasibility-status.md).

## Supporting evidence and primary terms

- [Catalog and preview facts](catalog-and-preview-scope.md), including the [178-card inventory](evidence/catalog-license-inventory-2026-11-05.json).
- [Runtime/license audit](evidence/license-audit-2026-11-05.json), [source-access evidence](evidence/source-access-2026-11-05.json) and [source provenance](../vendor/source/provenance.json). Supplier native rebuild/attestation limits remain recorded; source delivery does not universally require byte-identical compiler output.
- [GPLv3 sections 1 and 4–6](https://www.gnu.org/licenses/gpl-3.0.html), [CC BY 4.0 conditions](https://creativecommons.org/licenses/by/4.0/legalcode.en).
- [Chrome developer agreement](https://developer.chrome.com/docs/webstore/program-policies/terms) and [Mozilla distribution agreement](https://extensionworkshop.com/documentation/publish/firefox-add-on-distribution-agreement/): appropriate rights are required; our former JSON/hash approval process was not. Recheck applicable store terms before submission; Mozilla's announced December 1, 2026 changes are not yet effective on this review date.
