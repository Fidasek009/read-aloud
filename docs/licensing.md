# Release licensing assessment

Audited **2026-11-05** against the actual pinned package/catalog inputs. **Public release is blocked; account/credential dry-runs are allowed.** Original application source and artwork remain MIT. This assessment separates concrete license conditions, technical evidence and unresolved questions; an unanswered question is not a finding of illegality.

## What is mandatory and what is our engineering process

License conditions apply when the relevant code/data is used or conveyed: for example GPL source/rights requirements, MIT copyright/license retention, and applicable CC BY attribution/change notices. They are not optional preferences. Our hash snapshots, review record and fail-closed CI checker are an engineering process to avoid distributing before those questions are resolved; no law requires this particular JSON format or CI design. The checker is a committed evidence/review gate, not a legal-proof machine or an assertion that copyright questions can be decided by code.

GPL corresponding source means the preferred source plus material needed to generate/install/run/modify the covered work, subject to its actual exceptions. **It does not universally require compiler output to be byte-identical.** The AMO first-party byte-rebuild check serves a separate reviewer/reproducibility purpose. Public access for recipients is distinct from private reviewer uploads. See [GPLv3 sections 1, 4–6](https://www.gnu.org/licenses/gpl-3.0.html) and [FSF source-distribution FAQ](https://www.gnu.org/licenses/gpl-faq.en.html#SourceAndBinaryOnDifferentSites).

## Actual shipped components

| Component | Actual pinned input | Assessment and action |
| --- | --- | --- |
| Original Read Aloud files/artwork | This repository | MIT. Keep original files MIT; combining with GPL code does not turn the whole archive into an MIT-only product. |
| Spellophone | 0.2.1 | GPL-3.0-or-later covers wrapper, glue, build scripts and generated eSpeak artifacts. Treat the combined application as GPL-covered; do not invent a worker-boundary exception. |
| eSpeak NG | 1.52.0 | Native source pin `4870adfa25b1a32b4361592f1be8a40337c58d6c`; Spellophone's deterministic-dictionary patch applies. Source-level GPL/Unicode and optional BSD notices inspected; holder headers are included, not only generic license templates. |
| ucd-tools / speechPlayer | Sources inside that eSpeak archive | Actual ucd-tools file headers/COPYING and speechPlayer are GPL-3-or-later; Unicode data has its own notice. This source inspection overrides the upstream documentation's broad Apache description. |
| Emscripten and compiler runtime notices | Supplier's pinned emsdk 6.0.12 | Emscripten, musl, libc++ and libc++abi texts retained from that source release. This is a conservative notice inclusion, not a claim each library survives linking or a completed system-library analysis. |
| ONNX Runtime Web/Common | 1.31.1 | MIT plus upstream third-party notices. Checked-in license and notices match the official v1.31.1 files by SHA-256. No inference that every library named in the umbrella notices is linked into these WASM files. |
| WXT runtime | WXT 0.21.5; browser adapter locked at 0.3.7 | MIT notice added to shipped runtime notices. Build-only packages are not automatically product components. Exact transitive source/notice coverage remains part of the combined-source review. |
| PDF.js | **6.5.438** | Apache-2.0. Source link/version corrected. Existing asset copies preserve cmap Adobe, Foxit/Liberation font and JPEG2000/JBIG2/qcms/QuickJS license files beside their binaries. |
| ONNX protobuf schema | Vendored 1.19.1 source | Apache-2.0 retained. The model instrumenter is first-party wire-format code; no assumption all devDependencies ship. |

The exact package/data fingerprints and supplier provenance are in [the audit evidence](evidence/license-audit-2026-11-05.json), [source provenance](../vendor/source/provenance.json), and [the release review record](../release/licensing.json).

## Source-delivery remediation completed

The repository now contains **full, checksum-pinned Spellophone and eSpeak source archives**, not merely npm binaries or source URLs. Spellophone v0.2.1 resolves to `6d51a872d54a773e4969d7130fdaed665b2d6d18`. The registry-supplied provenance payload ties the package tarball digest to that commit; decoding/matching it is not independent signature verification. The source includes native glue, CMake, TypeScript, data packing/compiler scripts, toolchain declarations, lockfile and dictionary patch. See [source/build relationship](../vendor/source/README.md).

The archives are included in `vendor/**` in the reviewer source ZIP and are intended to be publicly available in this repository at the release tag before CD conveys a binary. The extension ships readable source-access directions and license/holder notices, not the 17-MB eSpeak source archive itself. No executable speech engine was replaced. The inventory rename to `data-index.json` is documented as our packaging change; the upstream data bytes/WASM are unchanged. Full source notices are retained in the archives.

**Still not certified complete:** source/notice coverage for the entire combined application, including the precise generated runtime/transitive library and compiler-runtime coverage, has not been exhaustively closed. An upstream source rebuild was not independently performed in this audit, but exact-byte parity is not being imposed as a GPL condition. The source record remains unresolved for a concrete coverage review, not because archives need to be hash-identical to a compiler output. Store licensing/source-access terms and public delivery behavior also remain an assessment item. No store-policy or legal-compatibility guarantee is made.

## Mandatory English and Czech model findings

Models/recordings/previews are **not bundled**. We ship discovery/configuration metadata, let the user explicitly fetch a pinned model from its host, modify the ONNX graph locally for word timing without changing original weight bytes, and stream a prerecorded sample only after Listen. Those acts are assessed separately from redistribution of a model/audio archive; we do not claim we need redistribution permission for files that we do not redistribute.

**US English LJSpeech medium:** the pinned card identifies the public-domain LJ Speech dataset and training from scratch. Crucially, the original trainer independently labels the **model** public domain and permits rehosting on his [model page](https://brycebeattie.com/files/tts/). The [dataset author](https://keithito.com/LJ-Speech-Dataset/) describes the recordings/text as US public domain, without guaranteeing every jurisdiction. This is stronger than a repository metadata label. Exact checkpoint identity/source links are recorded; no universal personality-rights or jurisdiction guarantee is inferred.

**Czech Kasandra medium — substantiated model grant:** author Ondřej Šimek submitted this voice in [Piper PR #93](https://huggingface.co/rhasspy/piper-voices/discussions/93) and explicitly chose **CC BY 4.0** for the resulting model, confirming his own recordings. The [merge commit](https://huggingface.co/rhasspy/piper-voices/commit/56189cc2301028e5d37c3d00a58adba7eddae51e), co-authored by his account, introduced SHA-256 `09d08aa23691ed2d53fb3db242cfe82b189adf9c1812dd5fe928b5789ed76df7`, exactly our pinned checkpoint. Later cleanup renamed that same file. Retain Ondřej Šimek's attribution, source and [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) link, and indicate local graph instrumentation. The notice page now does so.

The author's separate HF repository's retained history has only three July 15, 2026 commits and a README directing users to purchase a package with terms. That does **not** revoke or disprove the distinct owner-issued grant for the exact model uploaded in PR #93. No matching checkpoint exists in that separate repo to establish the paid package is the same bytes. Kasandra is not kept blocked merely by that README. Audio quality/performance acceptance is separate and was not measured in this audit.

**Czech Jirka low/medium:** the pinned cards identify CC0 recordings and fine-tuning from Lessac. Lessac's original agreement restricts its defined recordings/Materials to research. Whether/how that agreement or other rights apply to these resulting checkpoints/outputs is an unresolved lineage/scope question, **not a conclusion that fine-tuned weights automatically inherit the recording contract or are illegal**. Keep Kasandra's substantiated grant separate from this question. A clarification draft identifies the exact files and questions; it has not been sent.

## Wider catalog and previews

All 178 pinned catalog entries across 58 locale codes remain available in the development catalog; seven still lack required pronunciation engines. No language or voice was silently removed to make a readiness checkbox pass. The mirror README's `license: mit` metadata does not replace individual grants, and no root LICENSE file was found at our pinned model revision. Individual cards show public-domain/CC, attribution/share-alike, noncommercial/research or separate terms. A scoped release review must describe which obligations belong to the extension distributor versus the user deliberately downloading/using a model, and verify attribution/change disclosure. This audit has not completed that entire catalog assessment, so it does not approve all 178 entries or declare them all forbidden.

The pinned sample tree at `da672d1157136d07365790f51da3357a17cf9650` contains a README describing Piper samples and no root/general license file. We stream it from its original host only after Listen; we do not bundle, rehost or prefetch the audio. Absence of a root LICENSE is **not a universal legal prohibition on linking/streaming publicly hosted media**, and a model's license does not automatically decide rights in every generated sample, transcript or performance. The specific embedding/streaming/caching/use scope and available owner grants remain unassessed. [Clarification drafts](licensing-clarification-drafts.md) are concrete next actions, not messages already sent or license terms accepted for the owner.

## Enforced release state

`release/licensing.json` is an agent-owned review record with exact file hashes and per-finding evidence/remaining work. `bun run check:licenses` reports whether that record matches current inputs; `bun run check:licenses --release` additionally fails on any unresolved finding. Dependency/lock/catalog/source/notice changes invalidate stale evidence. A status-label flip cannot bypass nonempty remaining work. This is review enforcement, not legal proof.

The strict check runs before the tag release proceeds, in live reusable CD, in the standalone live publishing script, and in the standalone GitHub public release script. Development builds, tests, source-review rebuilds and **credential-only dry-runs** remain usable; there is no product-owner RELEASE_READY switch. The pushed vX.Y.Z tag remains the sole version source. No store upload/release/tag was triggered by this audit.

## Primary references

- [Spellophone license](https://spellophone.spellingcreator.org/project/license), [source/build instructions](https://spellophone.spellingcreator.org/project/building), and exact source archives above.
- [eSpeak NG pinned source](https://github.com/espeak-ng/espeak-ng/tree/4870adfa25b1a32b4361592f1be8a40337c58d6c), including file-level notices and COPY* texts.
- [ONNX Runtime v1.31.1](https://github.com/microsoft/onnxruntime/tree/v1.31.1), [PDF.js v6.5.438](https://github.com/mozilla/pdf.js/tree/v6.5.438).
- [Pinned model catalog](https://huggingface.co/rhasspy/piper-voices/tree/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd), [Jirka card](https://huggingface.co/rhasspy/piper-voices/blob/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/cs/cs_CZ/jirka/medium/MODEL_CARD), [Lessac terms](https://www.cstr.ed.ac.uk/projects/blizzard/2013/lessac_blizzard2013/license.html).
- [Pinned sample tree](https://github.com/rhasspy/piper-samples/tree/da672d1157136d07365790f51da3357a17cf9650).
