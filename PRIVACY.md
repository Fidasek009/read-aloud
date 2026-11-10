# Syllune privacy policy

Effective: 2026-11-10. Syllune was previously named Read Aloud. Its repository and permanent extension IDs retain that name.

Syllune reads articles, explicitly selected text, and PDFs using speech synthesis running inside the browser extension on your computer. Reading text and synthesized audio are not sent to a remote speech service. The extension has no accounts, advertising, analytics or telemetry.

## Data on your computer

Selected/article/PDF text is processed to determine reading order, prepare speech and highlight the text being spoken. Reading content is not included in diagnostic logs. Downloaded voice models, pronunciation data, voice settings, playback preferences and limited technical performance/error information are stored locally. Local diagnostics do not contain the reading text. Downloaded voices can be deleted from the voice-management page; uninstalling the extension removes its extension storage according to your browser's behavior. Temporary browser audio buffers and ordinary HTTP caches are managed by the browser.

## Network requests

A voice is downloaded only after you explicitly choose Download. Model files and configuration are fetched from pinned Hugging Face resources. Our own prerecorded voice sample is requested from the project's read-aloud repository on GitHub only after you select Listen. Samples use original preview texts and contain no user reading content. These requests disclose ordinary connection information, including your IP address, to the hosting providers; they do not contain your selected/page text or synthesized audio. Those providers apply their own privacy policies. License/source links open the referenced external sites when you choose them.

Reading an online PDF may fetch that PDF from its original website. The extension may request access to that site to complete the fetch. This is access to the source document, not remote synthesis. Local file access depends on browser permissions. Browser/store update checks are controlled by the browser and extension store.

## Permissions

The extension uses the active tab and scripting to read a page after you invoke it, context menus for selection/article reading, and local storage for preferences and explicitly downloaded models. Large voice models use unlimited storage. Chrome uses an offscreen document to keep playback independent of the popup. Optional site/file access supports PDFs where browser restrictions require it. The extension does not request general browsing-history access or read unrelated tabs to collect content.

## Contact and changes

Syllune uses the requested document content and its URL only to provide the reading feature. It does not sell this data, transfer it for unrelated purposes, use it for advertising or creditworthiness decisions, or give the developer access to users' reading content. This use follows the Chrome Web Store User Data Policy, including its Limited Use requirements. The explicit download and sample requests described above still disclose ordinary connection information to their hosting providers.

Questions and privacy reports can be filed at https://github.com/Fidasek009/read-aloud/issues. Avoid including private page text or documents in a public issue. Policy changes are versioned in this repository. No claim of complete offline capability is made before a model has been explicitly downloaded and any source document made available locally.
