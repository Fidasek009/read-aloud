# Original Syllune voice previews

Preview production manages the **entire voice catalog**: currently 178 models across 53 languages and all quality variants. One catalog-driven generator uses original native-language texts in `texts.json` and the extension's CPU worker. It copies neither upstream sample audio nor Wikipedia passages. English and Czech are required languages, not a separate implementation or a two-model scope.

The collection contains generated preview recordings, not training data for new models. Original texts and our contributions to recordings are supplied under the project's [MIT license](../LICENSE); underlying model terms remain separate. `catalog.json` records the text, exact model/config hashes, recording hash, renderer identity, speaker, speed, duration and generation time for each completed recording. It also preserves model-card evidence and individually established grants. Dataset license labels are not automatically model/output licenses.

## Production commands

After a Chrome build, the implementation agent runs:

```sh
bun run previews:plan
bun run previews:generate --all
```

The plan checks coverage for every catalog model without downloading anything. Generation processes models sequentially, verifies source hashes, and resumes by skipping recordings when their bytes, model, configuration and original text match. Each recording retains the identity of the renderer that actually produced it. Delivery URL, notice or unrelated bundle changes do not regenerate audio. To intentionally refresh selected recordings after a speech-engine change, pass `--regenerate` with model IDs or `--all`. It saves successful records as it goes, continues past failures, and exits unsuccessfully when selected models fail or need an unsupported pronunciation engine. No model is silently removed or replaced. Explicit catalog model IDs can select a maintenance subset without changing the full product scope.

`voice-previews/texts.json` supplies the same original passage for each language's regional and quality variants. Missing language text fails explicitly instead of substituting English. Each model's recording uses speaker zero, matching the model-card play control; this does not claim separate previews for all 4,116 individual speaker choices.

The report at `.cache/evidence/voice-preview-coverage.json` lists every model as recorded, missing/stale, failed, or blocked by the current runtime. The runtime limitations already documented in the shared catalog are retained. Generating audio locally does not clear uncertain model/output rights for public hosting.

Selected source models are cached under `.cache/own-preview-models/`. Synthesis uses an isolated disposable Chromium profile and the built CPU runtime; it never runs during installation, CI, startup or a user's preview action. WAV recordings are PCM16 mono. Generation is stochastic; the stored recording hash identifies the actual result. Numerical signal checks do not establish listening quality or native-language pronunciation acceptance.

## Delivery status

The catalog run exposed 18 failures in our own pronunciation adapter. Those 18 now synthesize successfully after [matching Piper's handling of absent symbols](../docs/piper-compatibility-2026-11-06.md). Seven other candidates need unsupported pronunciation engines.

The [completed run after the correction](../docs/evidence/piper-compatibility-2026-11-06.json) regenerated all **171 available models across 49 languages** with the same renderer: zero failures, valid source/recording hashes and non-silent PCM16 audio, with no clipped samples. Firefox also synthesized the 18 formerly failing models and the required English/Czech references. These are numerical synthesis checks, not listening-quality acceptance.

All 171 recordings are published separately on the repository's [voice-previews branch](https://github.com/Fidasek009/syllune/tree/voice-previews), alongside original texts, model/config/audio hashes and generation provenance. Production preview URLs use that collection, pinned by commit in `src/speech/previews.json`. The local WAV copies remain ignored on main. There is one shared collection, about 42 MB; a commit-pinned URL creates no second copy. Reuse unchanged recordings and only regenerate when their recipe changes.

Audio stays outside `public/` and the extension/reviewer source allowlists. The reviewer archive includes `texts.json` because the maintainer scripts import it; it includes no recordings. A voice's play icon streams only its recording without fetching a voice model or prefetching other previews. The upstream sample/transcript dependency is removed. Underlying model/output terms remain separate; see [licensing](../docs/licensing.md).

For a collection update, run `bun run previews:package` to verify every available model's original recording and stage delivery in `.cache/preview-delivery`. Commit and push those delivery files on the existing `voice-previews` branch using normal Git commands; never force-push its history. Run `bun run previews:package <full-published-commit>` to verify all public files and their CORS headers/recording hashes before updating `src/speech/previews.json`. Commit that small manifest with the corresponding model/provenance changes on main. No new account, secret, publishing service or end-user setup is needed.

## Available models

The upstream inventory contains 178 candidates; the extension offers 171. Only the seven unsupported-engine entries are excluded from download and reading choices. Older downloads remain removable. All candidates use the same generation path. Maintainers can explicitly exercise unavailable candidates with `bun run previews:generate --recheck <model-id>` when adding support for their pronunciation engine; this does not change production availability.

## Original preview delivery — 2026-11-06

All 171 available models now use our own separately hosted recordings and original text. Chrome 156 and Firefox 159 played every recording with advancing audio clocks, no preview prefetch, no model requests and no uncaught script errors. Chrome needed two explicit retries after VM network-change notifications; Firefox needed none. Switching and stop passed in both browsers; Chrome also passed offline recovery. Both packages contain no preview audio, and the reviewer rebuild matches all 380 installed files. Re-running generation reused all 171 recordings without producing new audio. See the [delivery evidence](../docs/evidence/original-preview-delivery-2026-11-06.json). The virtual audio sink verifies playback transport; it does not establish physical-device or listening-quality acceptance.
