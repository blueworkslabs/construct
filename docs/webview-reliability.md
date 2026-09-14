# WebView lifecycle reliability investigation

The reference Android 16 / WebView 133 runner intermittently exposes a module's
WebView title without its descendants after closing and reopening a module.
The page remains visibly rendered. A screenshot alone is not an accessibility
or saved-state acceptance pass.

## Focused reproduction

`runner.sh suite APK SHA256 --reliability-only` restores the normal app-free
snapshot and installs the supplied APK. It uses the bundled Hello module, not a
registry download. Ten cycles increment and verify a stored counter, return from
the menu and Diagnostics, reopen from Module access, and close/reopen normally.
Every checkpoint requires the real accessible button, ready status and expected
counter value. The host PID must remain unchanged. There is no automatic scroll,
observer restart or application restart fallback. Failure saves the hierarchy,
screenshot, window/activity/accessibility state and bounded logcat, then stops
the emulator. These raw files stay private unless reviewed and sanitized.

This is a focused transition test, not complete host/camera acceptance and not a
substitute for testing with a screen reader on a physical device.

## Investigation evidence

- On the unchanged alpha 13 optimized APK, two clean runs failed at the first
  cycle's normal close/reopen transition after passing menu, Diagnostics and
  Module access transitions. A separately recorded observer-only restart did not
  recover the missing controls.
- The original host destroyed its WebView while still attached. Removing it from
  its parent before destruction eliminates that lifecycle violation; authority
  is released before detachment. The focused test still reproduced after this
  correction, so it is **not sufficient** to close the accessibility issue.
- A diagnostic debug build showed the expected DOM and Chromium internal
  accessibility nodes while Android still exposed only the title. Reading the
  Chromium tree did not recover the Android tree. DevTools was diagnostic-only;
  it is not an acceptance fallback or enabled in the non-debuggable pilot.
- Neither disabling the emulator autofill service nor enabling the DevTools
  accessibility domain recovered the controls. A label-only mutation updated
  that label but not the missing children. A diagnostic child-node insertion
  immediately restored the actual Android descendants. These interventions are
  **not** included in the acceptance driver or app.

This is consistent with upstream Android accessibility cache-invalidation bugs,
including [parent cache invalidation after subtree creation](https://github.com/chromium/chromium/commit/5264f68b996bbc89451afa1a1aa02d8d1d3087a2).
It is not a bisection proving that one specific upstream commit fixes every case.

## Pinned provider comparison

The runner supports an explicit `--webview-apk FILE --webview-sha256 SHA256`
comparison. The hash must match before the emulator starts. Installation and
selection of `com.android.webview` require the configured disposable userdebug
image. The receipt records both original and selected provider versions and the
override hash; the suite still verifies the exact Construct APK. The original
snapshot is not rewritten and the provider is not shipped inside Construct.

The current comparison uses the official Chromium development snapshot:

- [AndroidDesktop_x64 revision 1697040](https://storage.googleapis.com/chromium-browser-snapshots/AndroidDesktop_x64/1697040/chrome-android-desktop.zip)
- ZIP member: `chrome-android-desktop/apks/SystemWebView.apk`
- Package/version: `com.android.webview`, `155.0.8058.0`
- APK SHA-256: `7642516b8037c637bb8117d46e020f10a6f005f07dcdcfca61da1ca45e3cbf1b`

This is a development-signed, x86-64 **test provider**, not a recommendation to
install it on a personal phone. Extract the named member from the official ZIP,
verify its SHA-256, and copy it to the disposable runner before using the flags.
Production phone WebView updates remain Android/Google's normal update path.

Investigation and final optimized acceptance are in progress. No claim of a
complete accessibility fix is made by the evidence above.
