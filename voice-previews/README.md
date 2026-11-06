# Original Read Aloud voice previews

Preview production manages the **entire voice catalog**: currently 178 models across 53 languages and all quality variants. One catalog-driven generator uses original native-language texts in `texts.json` and the extension's CPU worker. It copies neither upstream sample audio nor Wikipedia passages. English and Czech are required languages, not a separate implementation or a two-model scope.

The collection contains generated preview recordings, not training data for new models. Original texts and our contributions to recordings are supplied under the project's [MIT license](../LICENSE); underlying model terms remain separate. `catalog.json` records the text, exact model/config hashes, recording hash, renderer identity, speaker, speed, duration and generation time for each completed recording. It also preserves model-card evidence and individually established grants. Dataset license labels are not automatically model/output licenses.

## Production commands

After a Chrome build, the implementation agent runs:

```sh
bun run previews:plan
bun run previews:generate --all
```

The plan checks coverage for every catalog model without downloading anything. Generation processes models sequentially, verifies source hashes, and resumes by skipping recordings only when their bytes, model, configuration, text and renderer match. It saves successful records as it goes, continues past failures, and exits unsuccessfully when selected models fail or need an unsupported pronunciation engine. No model is silently removed or replaced. Explicit catalog model IDs can select a maintenance subset without changing the full product scope.

`voice-previews/texts.json` supplies the same original passage for each language's regional and quality variants. Missing language text fails explicitly instead of substituting English. Each model's recording uses speaker zero, matching the existing model-card Listen control; this does not claim separate previews for all 4,116 individual speaker choices.

The report at `.cache/evidence/voice-preview-coverage.json` lists every model as recorded, missing/stale, failed, or blocked by the current runtime. The runtime limitations already documented in the shared catalog are retained. Generating audio locally does not clear uncertain model/output rights for public hosting.

Selected source models are cached under `.cache/own-preview-models/`. Synthesis uses an isolated disposable Chromium profile and the built CPU runtime; it never runs during installation, CI, startup or a user's Listen action. WAV recordings are PCM16 mono. Generation is stochastic; the stored recording hash identifies the actual result. Numerical signal checks do not establish listening quality or native-language pronunciation acceptance.

## Delivery status

The [initial 2026-11-06 catalog run](../docs/evidence/voice-preview-generation-2026-11-06.json) recorded 153 models and exposed 18 failures in our own pronunciation adapter. Those 18 now synthesize successfully after [matching Piper's handling of absent symbols](../docs/piper-compatibility-2026-11-06.md). Seven other candidates need unsupported pronunciation engines. The earlier report remains historical evidence, not a list of broken models.

The [completed run after the correction](../docs/evidence/piper-compatibility-2026-11-06.json) regenerated all **171 available models across 49 languages** with the same renderer: zero failures, valid source/recording hashes and non-silent PCM16 audio, with no clipped samples. Firefox also synthesized the 18 formerly failing models and the required English/Czech references. These are numerical synthesis checks, not listening-quality acceptance.

The recordings are ignored local assets and have not been committed, uploaded or connected to production preview URLs. The tracked catalog preserves their provenance and hashes. The extension's existing upstream Listen behavior remains until replacement delivery is ready. The implementation agent owns separate hosting and integration for the whole catalog.

Audio stays outside `public/` and the extension/reviewer source allowlists. The reviewer archive includes `texts.json` because the maintainer scripts import it; it includes no recordings. Production delivery must pin recording/model identity and stream only after Listen, without fetching a voice model. Per-model license evidence remains necessary; producing an original recording does not clear uncertain model grants or training lineage. See [licensing](../docs/licensing.md) and the [public-source research](../docs/preview-model-research-2026-11-05.md).

## Available models

The upstream inventory contains 178 candidates; the extension offers 171. Only the seven unsupported-engine entries are excluded from download and reading choices. Older downloads remain removable. All candidates use the same generation path. Maintainers can explicitly exercise unavailable candidates with `bun run previews:generate --recheck <model-id>` when adding support for their pronunciation engine; this does not change production availability.
