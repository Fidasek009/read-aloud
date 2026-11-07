# Piper pronunciation compatibility — 2026-11-06

The 18 repeatable preview failures were caused by our adapter rejecting pronunciation symbols absent from older model configurations. The failure happened before ONNX inference. Repeating it established reproducibility, not damaged model weights.

Piper's [phoneme-to-ID implementation](https://github.com/OHF-Voice/piper1-gpl/blob/d4a61197bfad09542e64d8675f7289ab9884a766/src/piper/phoneme_ids.py) skips absent symbols without adding padding for them. Its [eSpeak adapter](https://github.com/OHF-Voice/piper1-gpl/blob/main/src/piper/phonemize_espeak.py) decomposes Unicode IPA before mapping. Our shared adapter now follows those rules, preserves model-provided replacements, and attaches original word spans only to emitted IDs. It retains known diacritics and does not invent IDs, edit model weights, or add language-specific workarounds. Entirely unmappable pronunciation still fails instead of producing empty speech. Required framing tokens and invalid IDs remain fatal configuration errors. Source text and pronunciation symbols are not logged.

## Existing-library assessment

Synthesis already uses Spellophone/eSpeak NG and ONNX Runtime Web. These libraries continue doing phonemization and inference; our adapter supplies the extension's original-source spans for acoustic word highlighting. ID framing and padding are shared with the existing grapheme path rather than duplicated. This correction does not change grapheme normalization or its unreadable-character policy.

The official Piper implementation inspected here exposes Python/native APIs, rather than a directly importable browser TypeScript function. Two browser wrappers were inspected before deciding whether another dependency would replace the adapter:

- [Mintplex's inference implementation](https://github.com/Mintplex-Labs/piper-tts-web/blob/main/src/inference.ts) uses its own model cache/download path and returns a WAV blob, without original-word positions. Its [package](https://github.com/Mintplex-Labs/piper-tts-web/blob/main/package.json) targets ONNX Runtime Web 1.18.
- [Poket-Jony's phonemizer](https://github.com/Poket-Jony/piper-tts-web/blob/main/src/Runtime/Phonemize/PhonemizeWebRuntime.js) returns phoneme IDs/symbols rather than original-word positions; its [engine](https://github.com/Poket-Jony/piper-tts-web/blob/main/src/Engine/PiperWebEngine.js) also owns voice fetching and inference. Its [package](https://github.com/Poket-Jony/piper-tts-web/blob/main/package.json) adds Transformers and ONNX Runtime Web 1.20.

Neither inspected interface replaces our highlighting adapter directly. Retaining the existing maintained libraries and correcting the small adapter avoids adding a second model/runtime/cache stack. This is a scoped assessment of these interfaces, not a claim that no suitable library can ever exist. No dependency or third-party license was added.

## Verification scope

The [completed evidence](evidence/piper-compatibility-2026-11-06.json) records successful synthesis for **all 171 available models across 49 languages** in Chrome for Testing 156.0.8078.4, using one common renderer, pinned sources and the original preview passages. There were zero failures and seven unsupported-engine candidates. All 171 local PCM16 recordings passed model/config/text/audio identity, WAV structure, duration and non-silence checks; no recordings contain clipped samples. The audio collection totals 41,745,764 bytes and remains outside installed and reviewer archives.

Regression tests cover each of the five missing symbols seen across the 18 failures, absence of padding for skipped symbols, actual emitted-ID word positions, Unicode decomposition, configured replacements, retained diacritics, multi-ID mappings, missing framing, invalid IDs, and empty pronunciation. Browser synthesis evidence is recorded separately after exercising the actual packaged CPU worker with the original passages and pinned model/config files. Numerical signal and duration checks establish successful synthesis for those passages; they do not establish native-language pronunciation quality or target-device latency.

Firefox 159.0 synthesized all 18 formerly failing models plus the required English and Czech reference voices. This used a disposable extension profile, injected maintainer entry, hash-verified local model cache, test-only localhost permission, and geckodriver's privileged automation flag. It did not use mocked speech or exercise native context-menu entry.

All tests, type checks, formatting, workflow lint and both package validations passed. Rebuilding the Firefox reviewer archive reproduced the installed files byte for byte. Separate Chrome and Firefox UI fixtures verified the full available model rows and deletion of an unsupported legacy download; deletion used synthetic IndexedDB metadata in disposable profiles, rather than a real old model download.

Preview recordings stay outside extension and reviewer archives. Public preview hosting, underlying model/output rights, GPU acceptance, and audible quality remain separate from this compatibility fix.
