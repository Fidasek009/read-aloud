# Catalog unit: model or speaker?

Investigated 2026-11-06 against the pinned catalog (`src/speech/voices.json`, 171 available models) and preview collection (`voice-previews/catalog.json`).

## Facts

- 25 of 171 available models are multi-speaker: 3,962 speaker identities in total.
- Listing every (model, speaker) pair would produce 4,108 catalog entries instead of 171.
- 8 of those models hold 3,821 identities (93% of all speaker identities): LibriTTS-R 2,306, LibriTTS 904, German MLS 236, French MLS 125, VCTK 109, VIVOS 65, Dutch MLS 52, L2-ARCTIC 24.
- 17 models have 20 or fewer speakers, 141 identities together. Their speaker maps mix real names (Albert, Mari, lada, mykyta, Berfin), genders (M/F, female/male), emotion styles (amused, drunk, whisper), dataset codes (awb, TXHC, VIVOSSPK12, p3922) and numeric IDs (00737).
- Previews are one recording per model, always speaker 0: 171 recordings for 171 models. There is no per-speaker preview.
- Download, license, integrity, storage and delete are per model. The catalog row is the download unit; the player picker is the reading-choice unit.
- Upstream metadata does not mark which speakers are product voices. `sr_RS-serbski_institut` labels its speakers `dsb`/`hsb`, which are Lower/Upper Sorbian language codes, not Serbian voice names. `de_DE-thorsten_emotional` starts at `amused`.
- `uk_UA-ukrainian_tts` speakers lada/mykyta/tetiana also exist as separate single-speaker models; the multi-speaker entry is a medium-quality bundle.

## Options

| Option | Catalog rows | Preview truth | Download/delete | Verdict |
| --- | --- | --- | --- | --- |
| One voice per model (speaker 0) | 171 | Exact: row preview = playback voice | One row owns one model | **Recommended** |
| Every speaker as a row | 4,108 | 3,937 rows without a matching preview | Rows share a model; deleting one removes siblings | Reject |
| Curated speaker rows | ~211 | Needs ~40 new recordings and a pinned delivery update | Same shared-model ambiguity | Defer |
| Model rows plus post-download speaker picker | 171 | Catalog preview represents only the default speaker | Model-level, but picker is unusable for 2,306 voices without curation | Defer |

## Recommendation

The catalog and player expose one voice per model, using speaker zero. This keeps the row, preview, download, license and delete units identical, and keeps the playback picker compact. Speaker multiplicity is a model-internal detail, matching the model-card Listen samples, which are speaker zero too.

Per-speaker catalog entries are only defensible with curated speaker metadata and per-speaker previews. That is a separate feature with its own download-grouping and deletion design; it is not part of the current catalog model.

## Open items

- `de_DE-thorsten_emotional-medium` reads with its first speaker, `amused`. Exclude the model or record a neutral-speaker preview before treating it as a normal reading voice.
- Verify the upstream `sr_RS-serbski_institut-medium` identity: its speaker IDs are Sorbian codes. Correct the language label or exclude the model if it cannot read Serbian.
