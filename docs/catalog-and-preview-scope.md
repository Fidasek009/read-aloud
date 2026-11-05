# Catalog and preview scope

Reviewed **2026-11-05**. This is the factual scope of our integration and the remaining questions, not a declaration that all hosted files are unrestricted or that every uncertainty proves a violation.

## What is and is not conveyed

The extension/release archives contain the speech runtime, pronunciation data, first-party code and pinned discovery/configuration metadata. They do **not** contain Piper voice weights, training recordings or prerecorded preview audio. The extension makes no model request until the user chooses Download and no audio-sample request until Listen. Requests go directly to the pinned upstream hosts. No reading text or synthesized reading audio is sent to them.

This distinction matters: GPL source duties for our shipped runtime are actual distributor duties. It would be incorrect to describe all upstream model/recording/sample files as bundled components, or to infer that permission to redistribute weights is required for an archive that does not redistribute them. Equally, direct hosting does not establish that every intended use, local modification, generated output or later redistribution is permitted.

The user-facing catalog links each exact pinned model card through its License link before download. The voice-page footer already states that models have separate licenses and samples stream on Listen. Those links are source information, not a grant from Read Aloud. The local ONNX graph is modified to expose acoustic duration information; original parameter/weight values are preserved. Where applicable, attribution and change disclosure still need to be respected. Kasandra's owner/source/license/change notice is supplied in the installed notices page; its exact owner-issued grant is independently substantiated in the main audit.

## Complete metadata inventory

[The pinned inventory](evidence/catalog-license-inventory-2026-11-05.json) records every one of the **178 MODEL_CARD files**, their HTTP result and content hash, model checkpoint identity, author/license fields, explicit License sections and relevant training statements. All 178 cards were retrieved successfully. It also fingerprints 177 per-voice sample.txt files. Lithuanian ingute has no preview path in our catalog; no missing preview was invented. No model weights or audio were downloaded for this audit.

A heading/field parser is not a license decision. For example, Polish bass declares Apache-2.0 in a License section, while Swedish alma expressly describes its model weights as CC BY 4.0; neither should be mislabeled "no license" merely because it lacks a `License:` field. Conversely, a license under a Dataset heading does not independently prove the model's grant or the original trainer's authority.

The cards report CC0/public-domain, CC BY, share-alike, noncommercial, Apache, GPL/AGPL, OpenRAIL, referenced external terms, and unknown statements. In particular, four cards literally report Unknown; ald x-low and Swedish lisa have neither a License field nor License section. That describes missing evidence, not a court finding. Jirka and other Lessac-fine-tuned checkpoints retain the specific lineage questions described in the main audit. For locally downloaded copyleft models, private use/local modification must not be conflated with later conveying them or running a network service; we do not claim a blanket model/software license conflict merely from a GPL/AGPL label.

The inventory completes the factual catalog pass. Open work is now narrower: establish the scope of the owner grants where labels/lineage are ambiguous, and finish the distributor-versus-recipient and attribution/change-disclosure assessment for the offered flow. No language or voice was removed to hide that work; there is no claim of unrestricted commercial rights for the entire catalog.

## Preview text is identifiable separately from the audio

The [pinned Piper Samples page](https://github.com/rhasspy/piper-samples/blob/da672d1157136d07365790f51da3357a17cf9650/index.html) identifies the first paragraph of Wikipedia's Rainbow articles as the source of the spoken samples. Its [generator](https://github.com/rhasspy/piper-samples/blob/da672d1157136d07365790f51da3357a17cf9650/_script/generate-samples.sh) and [copy script](https://github.com/rhasspy/piper-samples/blob/da672d1157136d07365790f51da3357a17cf9650/_script/copy-samples.sh) use language test sentences and preserve the text beside each sample. The recorded English/Czech sample text corresponds to Rainbow/Duha. The provider does not record an exact original Wikipedia article revision for each file.

Text credit belongs to Wikipedia contributors, with source/history access and the applicable Creative Commons share-alike terms. The installed notices now link [Rainbow](https://en.wikipedia.org/wiki/Rainbow), its history/language editions, [Duha](https://cs.wikipedia.org/wiki/Duha), its history and [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/), alongside the [Wikimedia reuse terms](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use). This addresses an identifiable attribution omission; it does not purport to relicense someone else's recording or establish all possible audio/model/performance rights. We do not modify or rehost the streamed files.

No blanket audio grant was found in the pinned sample repository's README/tree, or in a targeted search of its public issue metadata. Public hosting and the site's deliberate sample player are relevant context, but this audit does not turn those facts into a universal permission or prohibition. The concrete remaining question is the existing creator/provider authorization and conditions for this exact on-demand, unchanged, source-host streaming/caching flow. An unsent clarification draft is prepared. A model license alone does not decide all recording/transcript/output rights.

## What the release gate means

The completed metadata and attribution work is recorded positively. Any remaining public-release hold for ambiguous model/sample use is an agent-owned risk/evidence review, not a claim that the absence of a root LICENSE makes every link illegal or that law mandates this particular CI gate. Known obligations, observed grants and unanswered scope questions remain separate in `release/licensing.json`.
