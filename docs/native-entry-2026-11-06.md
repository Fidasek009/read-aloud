# Native context-menu entry — 2026-11-06

**Passed:** select text → the browser's actual **Read selection** menu → local speech without a second Play click, in Chrome 156.0.8078.4 and Firefox 159.0. Both LJSpeech medium (English) and Kasandra medium (Czech) passed in a fresh profile for each case. The reader's complete captured text exactly matched the selection, excluding an adjacent sentinel paragraph. The native audio clock advanced in every case and the observed player reported no script errors. [Recorded results](evidence/native-entry-2026-11-06.json).

The previously recorded second-Play requirement came from simulated entry in broader product probes. It did not demonstrate a failure of real browser-menu activation. Native entry needed no production change, extra host permission, autoplay permission or end-user setup.

## Repeatable probes

Build both packages, then run:

```sh
bun run build
bun run build:firefox
bun run probe:native:chrome
bun run probe:native:firefox
```

Set `NATIVE_ENTRY_VOICE=cs_CZ-kasandra-medium` or `NATIVE_ENTRY_VOICE=en_US-ljspeech-medium` to run either voice in either browser. Each run uses a new disposable profile and deliberately downloads its voice using the production Download control. Text selection is prepared through the DOM; the extension start handler is never invoked by the fixture.

Chrome uses Bun.WebView connected to an isolated **headed** Chrome process. A Linux display (a private Xvfb display is sufficient) and `xdotool` are test prerequisites. `BUN_CHROME_PATH` can select the browser and `XDOTOOL` can select the OS input tool. The probe focuses the fixture's native window, right-clicks inside the actual selected range, waits for the browser-owned menu window, then chooses its extension item with OS keys. Runtime evaluation never requests a synthetic user gesture. The fixture's Chromium `--no-sandbox` launch policy is for this VM, not a product permission or autoplay change.

Firefox uses GeckoDriver's trusted pointer actions to open the browser menu, then clicks the actual extension menu item through its privileged browser-chrome WebDriver context. It does not call the extension listener, manually inject the content script or pre-grant the fixture origin. `GECKODRIVER` and `FIREFOX_BINARY` can override the default installed paths. No media/autoplay preference is changed.

This VM needs a private virtual audio sink; `PULSE_SERVER` points the browser to it. Xvfb, OS input, GeckoDriver and the audio sink are test infrastructure. Users need none of them. The copied extension adds only the existing native Audio/error observer and fixture helpers; its production manifest is preserved and checked for absent permanent host permissions. All browsers, drivers and fixture profiles are closed afterward.

This evidence closes the native entry uncertainty for the tested Linux browsers and passages. It does not claim physical listening-quality, Windows, full benchmark-page extraction, physical GPU or target-device latency acceptance. Performance remains a follow-up under the owner's first-release waiver.
