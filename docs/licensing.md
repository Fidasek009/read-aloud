# Speech dependency licensing inventory

Updated: **2026-10-29**. Original application code is MIT. The user permits considering other dependency licenses after their obligations are explained; **no release-ready speech stack is cleared**. The development prototype now bundles Spellophone 0.2.1 / eSpeak NG 1.52.0 with ONNX Runtime Web; obligations were explained before testing and adoption in the prototype.

## Piper

The maintained Piper engine is GPL-3.0. A common browser package advertises MIT, but its documented WASM build includes eSpeak NG. Audit the actual compiled components rather than relying on the wrapper's package label. Sources: [OHF Piper](https://github.com/OHF-Voice/piper1-gpl), [browser package metadata](https://github.com/diffusionstudio/piper-wasm/blob/main/package.json), [its build instructions](https://github.com/diffusionstudio/piper-wasm/blob/main/README.md).

GPL code must retain its license/notices and use an authorized method of providing corresponding source and build information when conveying object code. Modified or combined covered works have further GPL conditions. MIT original files do not make a bundled GPL component MIT, and a worker/message boundary does not by itself establish a licensing exception. Before choosing Piper, establish the complete distribution obligations; do not promise an MIT-only extension archive. Source: [eSpeak NG's GPL-3.0 license](https://github.com/espeak-ng/espeak-ng/blob/master/COPYING).

Model checkpoints have separate provenance. The Czech Jirka medium card lists CC0 dataset terms and notes fine-tuning from Lessac; the Lessac card links separate dataset terms. Review exact checkpoint grants and provenance before curating downloads or producing previews; do not assume all catalog voices share the repository tag's license. Sources: [Jirka medium card](https://huggingface.co/rhasspy/piper-voices/blob/main/cs/cs_CZ/jirka/medium/MODEL_CARD), [Lessac medium card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/lessac/medium/MODEL_CARD).

## Current isolated Supertonic experiment

The archived reference implementation is MIT; ONNX Runtime is MIT with third-party notices. The lab preserves their license texts and pins the reference revision. This is an experiment, not adoption of an unsupported upstream package as a product dependency. Sources: [reference license](../lab/local-speech/vendor/LICENSE), [runtime license](../lab/local-speech/vendor/onnxruntime-LICENSE), [runtime notices](../lab/local-speech/vendor/onnxruntime-ThirdPartyNotices.txt).

The model weights use BigScience OpenRAIL-M. Redistribution includes license/notices, marked modifications, and downstream use restrictions; these weights cannot be described as MIT. Review how those conditions fit the intended download/distribution flow before choosing this model. Source: [model license](https://huggingface.co/supertone-oss-archive/supertonic-3/blob/main/LICENSE).

## Alternative requiring more feasibility work

Pocket TTS has MIT code, and the Czech checkpoint publishes CC BY 4.0 weights. Attribution and model-specific notices still matter. The Czech model is not the same as the English checkpoint, and its browser export/runtime path needs proof. Sources: [Pocket TTS](https://github.com/kyutai-labs/pocket-tts), [Czech checkpoint](https://huggingface.co/vvolhejn/pocket-tts-czech).

## Production choice gate

Present the user with the selected code/runtime/model/preview licenses and concrete redistribution obligations **before choosing the production stack**. Preserve original-source MIT licensing and third-party rights accurately. Complete source/build provenance and notices for every bundled executable component, and pin catalog assets to vetted revisions. License review and performance/quality verification are separate gates; passing one does not imply passing the other.

## Current prototype distribution

Spellophone is GPL-3.0-or-later, including its TypeScript wrapper and compiled eSpeak artifacts. Treat the combined extension distribution as GPL-covered while retaining MIT licensing on our original files. Complete corresponding source, build information, notices, and modification identification are release gates, not satisfied merely by a license link. Sources: [Spellophone license](https://spellophone.spellingcreator.org/project/license), [source/build instructions](https://spellophone.spellingcreator.org/project/building).

The prototype English LJSpeech medium card specifies public-domain recordings and training from scratch. Jirka specifies CC0 recordings but fine-tuning from Lessac. The Lessac recording agreement is research-only; a repository-level MIT tag does not resolve that provenance question. Jirka remains a development candidate pending clearance. Previews now stream from pinned upstream Piper Samples URLs rather than being redistributed inside the extension; that does not settle their provenance. Sources: [LJSpeech card](https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/ljspeech/medium/MODEL_CARD), [Lessac agreement](https://www.cstr.ed.ac.uk/projects/blizzard/2013/lessac_blizzard2013/license.html).

PDF.js 6.4.299 is Apache-2.0. Preserve its license/notices and identify modifications when distributed; the current package copies the unmodified worker and supporting assets. It adds no GPL obligation to our original source. Source: [PDF.js license](https://github.com/mozilla/pdf.js/blob/v6.4.299/LICENSE).

Preview source: [Piper Samples](https://github.com/rhasspy/piper-samples/tree/da672d1157136d07365790f51da3357a17cf9650). Only an explicit Listen action loads an audio URL; no page or selection text is sent. The browser may use its ordinary HTTP cache.

## Expanded development catalog (2026-10-30)

The catalog now pins **all 178 entries** in the current upstream `voices.json` at revision `5041a7a49ae5b3a0f30e6837769eb03fdbb231bd`, across 58 locale codes. This is discovery metadata, not a clearance statement. Dataset grants vary (public domain/CC0, attribution, share-alike, noncommercial, research restrictions, or separate terms), and fine-tuning can leave inherited provenance questions. Every entry offers a compact License link to its pinned model card before Download; the source's reported dataset and training terms remain available there. No model weights or preview audio are redistributed in the extension.

Seven entries require Hebrew, Japanese, Lithuanian, Thai, or Pinyin pronunciation engines absent from the current browser runtime; their Download controls are disabled and the reason is visible. The remaining entries have supported pronunciation formats; broad per-model inference/quality/license acceptance is still open. A supported format does not prove an individual model passes every graph/timing/quality requirement. Multispeaker choices share one downloaded model; they do not silently download another model.

`bun scripts/update-voices.ts` refreshes pinned discovery/config metadata and sample existence, never weights or samples. Download validates both the configuration SHA-256 and model SHA-256 from that pinned snapshot. Original catalog labels are evidence supplied by upstream, not legal advice or an override of source agreements.
