# Store submission copy

Prepared by the implementation agent, 2026-11-05. These are usable listing materials, not evidence that the open product/license acceptance gates have passed. Store-account identity and declarations tied to the legal publisher must come from the actual registered publisher.

## Name

Read Aloud

## Short description

Listen to articles, selected text and PDFs with on-device voices in Chrome and Firefox.

## Full description

Give your eyes a break and keep your place.

Read Aloud turns articles, selected text and PDFs into speech on your own computer. Select a passage and choose Read selection from the right-click menu, or start an article from the extension button. Your reading text and synthesized audio stay on your device.

Keep listening in one compact playback bar: play/pause, previous or next sentence, speed, volume and voice choice. Word highlighting and automatic scrolling help you follow along. PDFs open in a separate reader tab, preserving the original document.

Choose your voice before you download it. English and Czech are available alongside additional languages in the voice catalog. Listen requests a prerecorded online sample; Download explicitly installs the selected model. Quality and performance vary by model and device. Downloaded models can be removed from voice management.

There is no account, subscription, advertising or telemetry. Speech runs inside the extension without a separately installed helper application. Once provisioned, the speech engine runs locally; opening online documents and streaming previews still requires the network. Browser restrictions and optional site/file permissions can affect PDF access.

Original application source is open source under MIT; the combined application includes GPL-covered runtime code, and voices/previews have separate terms. Source code, license notices and support: https://github.com/Fidasek009/read-aloud

Corresponding-source download/build directions for the release, including third-party source: https://github.com/Fidasek009/read-aloud/blob/main/vendor/source/SOURCE-ACCESS.md. Select the tag matching your installed version for the exact source snapshot. Source access is public and free; a store reviewer account is not required.

## Links

- Homepage/source: https://github.com/Fidasek009/read-aloud
- Support: https://github.com/Fidasek009/read-aloud/issues
- Privacy policy: https://github.com/Fidasek009/read-aloud/blob/main/PRIVACY.md
- Third-party terms: https://github.com/Fidasek009/read-aloud/blob/main/docs/licensing.md

## Assets supplied

- `assets/icon-128.png`: store icon; matching 16/32/48/64/96/128 PNGs ship in the extension.
- `assets/promo-small.png`: 440 × 280 original promotional tile.
- `assets/promo-marquee.png`: 1400 × 560 optional original promotional tile.
- `assets/voices-english.png`: 1280 × 800 screenshot of the actual English voice catalog.
- `assets/voices-czech.png`: 1280 × 800 screenshot of the actual Czech voice catalog.
- `../assets/brand/read-aloud.svg`: editable original icon source.

Screenshots show an unmodified development extension in an isolated Chrome profile, without any downloaded models. They show voice choice, not a fabricated playing state, latency result or claim that every voice is cleared for release. No sample was streamed for their capture. The artwork is original repo-native SVG/HTML rendered to PNG; it is not borrowed third-party branding.

## Reviewer instructions

Use a supported current Chrome/Firefox on Windows or Linux. Open voice management, deliberately download a supported English/Czech model, then select text in a web article and invoke Read selection from the context menu. Playback must stay inside that selection. PDF reading opens a new extension tab. Voices/models and samples have separate terms linked in voice management. See `SOURCE_CODE_REVIEW.md` for the exact Bun build procedure and `docs/feasibility-status.md` for unresolved acceptance limitations.

## Privacy/permission declaration notes

Single purpose: read user-requested web/selected/PDF text aloud locally. Reading content is not uploaded for speech. Model downloads and explicit sample streams are disclosed in the privacy policy; do not declare the extension never makes network requests. Optional host/file permissions support PDF fetch/access recovery. Justify permissions individually using `PRIVACY.md` and the actual built manifest.

The original code's MIT license is not a blanket license for the bundled package. Store license declarations must reflect the combined GPL-covered extension and the completed corresponding-source arrangement; publication is not cleared by this listing copy. See `NOTICE.md` and `docs/licensing.md`.

## Current release licensing state (2026-11-05)

The [licensing checklist](../docs/licensing.md) records supplied notices, pinned sources/build materials and the two open model/preview assessments. CI verifies supplied materials directly, without a separate approval record; that does not resolve the open questions or establish release readiness. Kasandra medium has an owner-issued CC BY 4.0 grant tied to our exact checkpoint (Ondřej Šimek; Piper PR #93), and LJSpeech medium an original-trainer public-domain grant. Preserve the former attribution/source/license and local graph-change notices; do not declare all Czech choices or previews cleared by association.
