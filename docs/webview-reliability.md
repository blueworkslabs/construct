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

## Recorded comparison

On the same optimized alpha 13 APK
(`3093571752a82dd00a6f8ad6c6b5d65c4b80731e5d0eb71cca6a7c1969cb55dc`):

- Original WebView `133.0.6943.137`: clean runs
  `20260914T055121Z-9d7bfcae` and `20260914T055326Z-6c8c239b` failed on
  the first cycle's normal close/reopen. The latter includes the failed
  observer-only recovery experiment, not a passing retry.
- Pinned WebView `155.0.8058.0`: `20260914T061343Z-79de64b8` completed all
  **10 cycles / 51 checkpoints**, with the same host process and counter values
  preserved. No recovery interventions were present. Emulator stopped.
- On that provider, `20260914T061914Z-7c0182c3` also passed the focused camera
  direct-Reopen scope after module grants, Android permission and native
  cancellation dialogs, with revocation still enforced. No
  `--camera-fresh-launches` override was used. This is not the full capture,
  gallery or vision suite. Emulator stopped.

This isolates the reference provider as a material cause of the observed
failures; it is not an app-only fix for WebView 133.

## Alpha 14 host correction and review

The separate teardown correction is in native commit `2cb2d3f`, version
`0.1.0-alpha14`. Its optimized APK SHA-256 is
`03c32d601efc755464ce5501291d9fb62a29bbac2ccae1a9afad174cc0528414`.
The existing APK signer, publisher identity, bundled modules, vision models and
Android permissions are unchanged. Generated dex optimization profiles change
with the compiled code and are not module/model assets.

All 97 JVM tests pass, including release-before-detach-before-destroy ordering;
lint has no errors. The renderer-loss driver resolves the selected provider
instead of assuming Google's package name, still requiring one newly created
isolated renderer, an unchanged provider/PID identity, and a different host PID
before injection. Its identity/rejection cases are covered in the 43 runner tests.

The current review status and **separate alpha 14 exact-build Android receipts**
are recorded in [the reliability PR](https://github.com/blueworkslabs/construct/pull/4).
The alpha 13 comparison above must not be reused as alpha 14 acceptance.
