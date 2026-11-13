# Store submission copy

Updated 2026-11-13. These materials do not close the product or license acceptance gates. The registered publisher must supply account identity and legal declarations. No store changes or external promotion have been published as part of this overhaul.

## Name

Syllune: Offline Text to Speech

## Short description

Natural-sounding voices for articles, selected text and PDFs. Download a voice once, then listen offline on your computer.

## Full description

Natural-sounding voices. On your computer.

Syllune reads articles, selected text and PDFs with natural-sounding voices in Chrome and Firefox. Download a voice once, then listen offline on your computer. Your reading text and synthesized audio never go to a speech service.

Select what you want to hear.

Select a passage, right-click and choose Read selection. Syllune reads that passage and stops at its end. To hear an article, start it from the extension button or the page's right-click menu. PDFs open in a separate reader tab, preserving the original document. Browser restrictions and optional site/file permissions can affect PDF access.

Keep the controls where you read.

Pause, move back or forward a sentence, and adjust speed, volume or voice in one compact playback bar. Word highlighting and automatic scrolling help you follow the spoken text. There is no separate listening dashboard to keep open.

Hear a voice before you download it.

Press a voice's play icon for a prerecorded sample made with the same voice model and local speech engine used for reading. Choose the sound you prefer before downloading a model. English and Czech are available alongside additional languages and quality choices. Download only the voices you want, and delete them when you no longer need them. Speech quality and startup time vary by model and device.

Speech runs inside the extension. No account, subscription or separately installed helper app is required. There is no advertising, analytics or telemetry. You need a connection for voice downloads, streamed samples and online source documents. Speech works offline after you install a voice and its required assets, with the source text available locally.

Original application source is open source under MIT; the combined application includes GPL-covered runtime code, and voices/previews have separate terms. Source code, license notices and support: https://github.com/Fidasek009/syllune

Corresponding-source download/build directions for the release, including third-party source: https://github.com/Fidasek009/syllune/blob/main/vendor/source/SOURCE-ACCESS.md. Select the tag matching your installed version for the exact source snapshot. Source access is public and free; a store reviewer account is not required.

## Links

- Homepage/source: https://github.com/Fidasek009/syllune
- Support: https://github.com/Fidasek009/syllune/issues
- Privacy policy: https://github.com/Fidasek009/syllune/blob/main/PRIVACY.md
- Third-party terms: https://github.com/Fidasek009/syllune/blob/main/docs/licensing.md

## Assets supplied

- `assets/icon-128.png`: store icon; matching 16/32/48/64/96/128 PNGs ship in the extension.
- `assets/promo-small.png`: 440 × 280 original promotional tile.
- `assets/promo-marquee.png`: 1400 × 560 optional original promotional tile.
- `assets/reading-selection.png`: 1280 × 800 actual selection playback on an original local demo article. Use this as the first screenshot.
- `assets/voices-english.png`: 1280 × 800 screenshot of the actual English voice catalog.
- `assets/voices-czech.png`: 1280 × 800 screenshot of the actual Czech voice catalog.
- `../assets/brand/syllune.svg`: editable original icon source.

The voice screenshots show the production catalog in a fresh isolated Chrome profile, before downloads. The reading screenshot uses a separate disposable copy with only a localhost permission grant and audio/error observation. The capture script explicitly downloads LJSpeech medium through the product's Download control, selects original demo text and starts the real reader through its background message contract. It captures highlighting after real local synthesis and a trusted Play gesture, then pauses through the product control. No playback state or highlight is fabricated. Scripted entry does not prove native context-menu activation, acoustic quality, latency or offline operation. Samples are not streamed. Original SVG/HTML supplies the promotional artwork; no third-party branding is borrowed.

## Reviewer instructions

Use a supported current Chrome/Firefox on Windows or Linux. Open voice management, deliberately download a supported English/Czech model, then select text in a web article and invoke Read selection from the context menu. Playback must stay inside that selection. PDF reading opens a new extension tab. Voices/models and samples have separate terms linked in voice management. See `SOURCE_CODE_REVIEW.md` for the exact Bun build procedure and `docs/feasibility-status.md` for unresolved acceptance limitations.

## Privacy/permission declaration notes

Single purpose: read user-requested web/selected/PDF text aloud locally. Reading content is not uploaded for speech. Model downloads and explicit sample streams are disclosed in the privacy policy; do not declare the extension never makes network requests. Optional host/file permissions support PDF fetch/access recovery. Justify permissions individually using `PRIVACY.md` and the actual built manifest.

The original code's MIT license is not a blanket license for the bundled package. Store license declarations must reflect the combined GPL-covered extension and the completed corresponding-source arrangement; publication is not cleared by this listing copy. See `NOTICE.md` and `docs/licensing.md`.

## Current release licensing state (2026-11-05)

The [licensing checklist](../docs/licensing.md) records supplied notices, pinned sources/build materials and remaining model/output assessments. CI verifies supplied materials directly, without a separate approval record; that does not resolve the open questions or establish release readiness. Kasandra medium has an owner-issued CC BY 4.0 grant tied to our exact checkpoint (Ondřej Šimek; Piper PR #93), and LJSpeech medium an original-trainer public-domain grant. Preserve the former attribution/source/license and local graph-change notices; do not declare all Czech choices or previews cleared by association.

## Positioning and name checks

Checked 2026-11-10. The brand is Syllune, pronounced "sih-LOON". Use that name in introductions, artwork, support replies and release notes. "Offline text to speech" describes the category; it is not the brand. Keep permanent store item IDs and archive filenames stable so existing users keep their update path.

Lead with "Natural-sounding voices. On your computer." Voice quality belongs in the headline and opening description, beside local processing. State offline speech after an explicit voice download and no text uploads for synthesis in the supporting copy, so "on your computer" cannot be mistaken for cloud audio playback. Do not make readers infer quality from an engine name or find it only in the voice catalog. Repeat the same name, orange S icon and headline. Show a selected passage and real playback first, with actual voice samples as the proof people can hear. Premium means the reading controls stay together and out of the way; it does not imply a paid tier.

Offline speech is not exclusive to this project. [LSD Software's Read Aloud listing](https://addons.mozilla.org/en-US/firefox/addon/read-aloud/) describes local standard voices as well as optional cloud voices. [GlowReadTTS's repository](https://github.com/lavellehatcherjr/GlowReadTTS) advertises bundled on-device voices. These primary sources rule out "the only offline reader" as a defensible claim. They do not establish comparative quality or reliability.

Exact-name web searches and indexed Chrome Web Store and Firefox Add-ons searches returned no Syllune extension listing. Unrelated gaming profiles use the same word. These checks are limited discovery checks, not proof of global uniqueness, domain availability or trademark clearance. Do not claim exclusive rights, register a domain or pay for brand assets without the relevant authorization. An initial search rejected Stillread and Hushread because [Stillread](https://stillread.app/) and [Hushread](https://hushread.com/) already name reading products.

[Chrome's listing requirements](https://developer.chrome.com/docs/webstore/program-policies/listing-requirements) require accurate metadata, prohibit keyword spam and disallow unattributed or anonymous testimonials in descriptions. [Mozilla's add-on policies](https://extensionworkshop.com/documentation/publish/add-on-policies/) also govern submissions. Keep installation links tied to verified live listings. No "best", "most natural", "instant", "zero network requests", invented ratings or implied Microsoft affiliation. Natural-speech listening acceptance and target-device performance remain open in [acceptance status](../docs/feasibility-status.md).

## Launch drafts

These are prepared copy, not published posts. Confirm public installation links and the existing product/license gates before a launch. Include the actual release and known-issues links. Disclose that the author builds the extension. Adapt each post to the community's rules; do not mass-post the same message.

### Developer and open-source communities

Title: Syllune, natural-sounding voices that run on your computer

I build Syllune. It reads selected text, articles and PDFs with natural-sounding voices inside the extension. Download a voice once, then listen offline without an account, subscription or helper app. Your text never goes to a speech service.

Select a passage and read only that passage, with word highlighting and a compact playback bar on the page. Hear a sample made with the same voice model and local speech engine before choosing a download. Samples and online documents still need a connection.

The source and current limitations are public at https://github.com/Fidasek009/syllune. Original application code is MIT; the combined extension and voice models have separate terms. I would like feedback on reading order, voice quality and keyboard use, with your browser, operating system and chosen voice. Please do not post private text or documents.

### Short social post

Natural-sounding voices. On your computer. Syllune reads selected text, articles and PDFs. Download a voice once, then listen offline. Your reading text never goes to a speech service. Hear a sample before you choose. No account or subscription. Online documents and streamed samples still need a connection. I build it: https://github.com/Fidasek009/syllune

### Demo sequence

Use a real Chrome or Firefox recording with a downloaded voice. Show the selected passage, the native Read selection menu, playback and word highlighting. Pause and skip a sentence through the actual bar. Use the unmodified synthesized audio, not a studio voiceover that could be mistaken for the product. Do not cut out startup delay while implying continuous real-time playback. Put "Voice downloaded before recording" beside any offline claim. For an offline demonstration, disconnect after provisioning and verify that the locally available passage still plays. A screenshot alone is not that evidence.

## Visibility work

1. Keep the brand and description identical across the built extension and store listings. Use the reading screenshot first, voice choice second. Keep a direct install link for each browser once verified, with setup requirements beside it.
2. Publish the demo and a versioned release with known limitations. State natural-sounding voices and local speech together in the first paragraph. Use actual synthesized audio to demonstrate the voice. Do not market Windows, GPU behavior or measured latency as verified until the acceptance evidence covers them.
3. Prepare separate, disclosed submissions for browser-extension, local-AI, privacy and open-source communities. Czech-language outreach should use a Czech voice demonstration, not an English demo with a translated caption. Check community rules before posting. No third-party contact is authorized here.
4. Offer reviewers the exact build, voice and original test passage used in the demo. Invite independent listening comparisons instead of declaring a win. Use a quote only with permission and named attribution, without changing its meaning.
5. Use store-provided aggregate impressions, listing visits and installs where available to assess visibility and conversion. Record the copy version and observation dates. Do not add extension telemetry, fingerprinting or review prompts. Change one listing element at a time after enough observations; no fabricated uplift claims.

The agent owns the copy, artwork, screenshots and release preparation. Public posting, advertising spend, domain registration and store publication are not part of this repository edit.
