# Known issues

## Firefox/Zen: opening an already-open local PDF may require choosing the file again

Last reviewed: **2026-11-04**.

When Read Aloud opens its reader for a local PDF, it already knows the file URL and tries to read it directly. In tested Firefox/Zen builds, that request is blocked. Knowing the file's location does not give the extension access to its bytes. The fallback asks you to choose the same PDF again; the browser then provides a readable `File` object. The file stays on your device and is not uploaded.

This is an unresolved limitation, not the intended reading experience. Firefox also prevents extensions from injecting code into its built-in PDF viewer, so we cannot retrieve the document through that viewer. A Mozilla report describes direct fetch/XHR failing even with both file host permission and local-file access granted. The report remains unconfirmed; we have not established that automatic access is permanently impossible or ruled out every alternative.

Chrome supports direct access after **Allow access to file URLs** is enabled in the extension's settings. The extension attempts the known URL before offering a file chooser.

References: [Mozilla file-access issue 2085199](https://bugzilla.mozilla.org/show_bug.cgi?id=2085199), [Firefox PDF-viewer restrictions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_scripts#limitations), [file-picker restrictions](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/input/file#notes), and [Chrome file-access settings](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions#allow-access).
