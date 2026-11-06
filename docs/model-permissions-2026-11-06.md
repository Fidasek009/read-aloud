# Model permission review — 2026-11-06

This review uses public documents only. No maintainer, author or other third party was contacted. The extension bundles no weights, training recordings or preview audio. Its separately hosted original previews require their own assessment; generating a new recording does not establish permission to use an otherwise unlicensed model.

## What a missing license means

Public availability is not a general reuse grant. For copyright-protected material, absent a license or applicable exception, the owner retains the relevant rights. Permission can appear in a model card, README or author statement rather than a LICENSE file. [GitHub's explanation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository).

Whether numerical weights are protected, contain protected expression, or are derivative works is a separate question. A dataset's license does not automatically become a license for every model or recording. Conversely, calling a file a model does not establish that it contains no protected material. The [US Copyright Office's training report](https://www.copyright.gov/ai/Copyright-and-Artificial-Intelligence-Part-3-Generative-AI-Training-Report-Pre-Publication-Version.pdf), pages 28–30, discusses the significance of memorized expression. That US analysis is not a universal determination for our voices or every jurisdiction.

## Additional public grants established

The previous checklist named only LJSpeech medium and Kasandra. Public primary sources establish more:

| Models | Model grant | Evidence and scope |
| --- | --- | --- |
| LJSpeech medium/high; Cori medium/high; Bryce, John, Kristin and Norman medium | Public domain | [Bryce Beattie's own model distribution page](https://brycebeattie.com/files/tts/) explicitly lists these models and their grants. The pinned cards identify the same trainer and variants. |
| Kasandra medium | CC BY 4.0 | [Ondřej Šimek's grant](https://huggingface.co/rhasspy/piper-voices/discussions/93); exact checkpoint previously matched. Retain author, source, license and change information. |
| Alma medium | CC BY 4.0 | The [pinned model card](https://huggingface.co/rhasspy/piper-voices/blob/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/sv/sv_SE/alma/medium/MODEL_CARD) expressly licenses the weights. The author's current repository contains a newer checkpoint; its current hash must not be substituted for our pin. |
| Mykyta, Oleksa and Tetiana high | Apache-2.0 | [Trainer Roman Stasyshyn's release announcement](https://github.com/OHF-Voice/piper1-gpl/discussions/212) expressly licenses these models. All three author-hosted ONNX SHA-256 values match our exact pins; see the evidence below. |
| Aegis female medium | MIT declaration | The [pinned model card](https://huggingface.co/rhasspy/piper-voices/blob/5041a7a49ae5b3a0f30e6837769eb03fdbb231bd/ur/ur_PK/aegis_female/medium/MODEL_CARD) has a model-level License section. This is a publisher declaration, not independent verification of every underlying right. |

These are 14 distinct model variants across English, Czech, Swedish, Ukrainian and Urdu, handled through the same catalog and runtime. They are evidence found, **not an implemented release allowlist or a statement that all other voices are unlawful**. Catalog availability has not been reduced by this review.

### Exact Ukrainian checkpoint identity

| Model | Author repository revision | Author ONNX SHA-256, equal to our pinned file |
| --- | --- | --- |
| `uk_UA-mykyta-high` | `918f3543293909981ea60cba2d87cc37757ca0f6` | `081d253cd246d7d4d698c6dd147b74cad498dafd213527887a3a490519138243` |
| `uk_UA-oleksa-high` | `131603719a8377d2fcaec28649a53c8aedce70c1` | `e5524d8d6b3685abd6daa616edae22c782b1eaa1541c0e5922183cf5f2d155b7` |
| `uk_UA-tetiana-high` | `42be6e3f72a7c6042271236b94e48edffd1f0c63` | `1206d8447b99632badeb63d6132241f76cf551874e5254eb8836db36aed7c85c` |

These identities were read from the authors' Hugging Face repository tree/LFS metadata, without downloading duplicate weights. Each pinned author README carries Apache-2.0 terms. The three [author repositories](https://huggingface.co/RomanStasyshyn) are linked from the announcement.

## Remaining scope

All 178 pinned model cards were retrieved and read for license/training scope. Most license labels appear under Dataset; those are not silently promoted to model grants. Existing inventories remain useful evidence, not an approval switch.

- Lisa's exact author-hosted file remains without stated model terms; Irina's card says Unknown.
- The [Piper maintainer's existing Lessac discussion](https://huggingface.co/rhasspy/piper-voices/discussions/105) does not supply a blanket downstream grant. It distinguishes personal/research intent, dataset labels and unresolved rights in the Lessac recordings.
- Fasih's own MIT declaration does not settle its documented Rohan → Lessac initialization. Bass's Apache declaration likewise does not resolve its documented Lessac ancestry. Neither is declared categorically infringing here.
- Noncommercial, share-alike and use-restricted terms are actual conditions to assess for the particular integration, not equivalent to a missing license. Unsupported pronunciation engines remain excluded independently.

Changing the first release to withhold voices without sufficiently established terms affects the owner's requested catalog coverage. That decision was requested explicitly; it has not been inferred from silence. No release tag or store submission has been made on the strength of this review.
