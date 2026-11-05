# Unsent licensing clarification drafts

Prepared 2026-11-05. These are drafts for owner review, not correspondence already sent. No terms have been accepted, permission purchased, or rights holder contacted. Kasandra's exact model grant is already substantiated by owner-issued PR #93; do not ask for that same grant again merely because the separate author-repo README advertises a paid package.

## Draft A: Jirka/parent-checkpoint lineage and grant scope

Recipient: relevant Jirka/Piper checkpoint rights holder/maintainer; involve the Lessac rights holder only if the model owner cannot substantiate the applicable scope.

We are building a local, open-source Chrome/Firefox reader. It does not bundle/rehost weights or training recordings. A user explicitly chooses a pinned model downloaded directly from Hugging Face, then uses it on-device. Our local model preparation adds ONNX graph outputs for word timing without modifying original weights. We do not send page/selection text to a remote speech service.

Please clarify the applicable grant for these exact checkpoints at rhasspy/piper-voices revision `5041a7a49ae5b3a0f30e6837769eb03fdbb231bd`:

- `cs/cs_CZ/jirka/low/cs_CZ-jirka-low.onnx`, SHA-256 `72e73fb306a165b41927d2c9d882f71e9f1c86ac5edf37c5441370a6e4e6ef7d`
- `cs/cs_CZ/jirka/medium/cs_CZ-jirka-medium.onnx`, SHA-256 `cbd5c900acacc8e8cbecd64347abb8de39c00a9d3104bed06fee92e4f319efc8`

Their model cards report CC0 recordings and fine-tuning from the Lessac low/medium voices. We are not assuming the Lessac dataset agreement automatically governs resulting weights; we need substantiated source/grant scope rather than inferring from training labels. Please identify the checkpoint owners, the parent checkpoint/version and their permission for the above client-download/local-use/instrumentation flow, including commercial/noncommercial, attribution, output and change-notice conditions. If an existing public grant already answers this, please point us to the owner-issued, revision/checkpoint-specific statement.

## Draft B: Specific prerecorded sample integration

Recipient: rhasspy/piper-samples maintainer and, where distinct, the applicable sample creator/rights holder.

We would like to offer explicit Listen buttons that stream your prerecorded files from their current host; no sample is bundled/rehosted or prefetched, no full model is downloaded to audition, and no user's reading text is sent. The user's browser may apply ordinary HTTP caching. We are reviewing actual permissions/scope, not asserting a root license file is legally required for every public link or that model licenses automatically cover audio.

Our pinned source is `rhasspy/piper-samples` revision `da672d1157136d07365790f51da3357a17cf9650`; the model metadata is `rhasspy/piper-voices` revision `5041a7a49ae5b3a0f30e6837769eb03fdbb231bd`. Mandatory-language examples are:

- `samples/en/en_US/ljspeech/medium/speaker_0.mp3`
- `samples/cs/cs_CZ/jirka/low/speaker_0.mp3`
- `samples/cs/cs_CZ/jirka/medium/speaker_0.mp3`
- `samples/cs/cs_CZ/kasandra/medium/speaker_0.mp3`

Please identify the applicable owner-issued grant or policy for embedding/streaming these existing files through a public extension, including any relevant recording/performance/transcript or model-output rights and attribution/use restrictions. If all or a defined subset of the repository share a grant, please state its precise scope. Our complete pinned list of sample paths is in `src/speech/voices.json`; we will not assume one response covers unrelated creators without an explicit scope statement. Please specify required author/source/license links, any change notice, and whether an original replacement sample generated from our own text under a cleared model grant would be preferable.

## Evidence added after preparing these drafts

The full 178-entry metadata inventory and 177 available per-voice sample-text fingerprints are now in `docs/evidence/catalog-license-inventory-2026-11-05.json`; no weights or audio were fetched. The upstream sample page and generator identify Wikipedia Rainbow passages, and our installed notices now credit Wikipedia contributors with article/history and CC BY-SA/reuse links. Draft B should therefore ask about the provider/creator's specific existing audio/voice integration authorization and any other applicable conditions, rather than treating the already identified Wikipedia text as wholly unknown or asking a sample maintainer to license text they do not own. A missing root LICENSE alone is not asserted to prohibit streaming.
