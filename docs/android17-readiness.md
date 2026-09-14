# Android 17 readiness

This checkpoint distinguishes **running existing APKs on Android 17** from
**targeting API 37**. Construct alpha 19 and Nano Lab alpha 1 currently target
API 35. An OS update does not require rebuilding them or silently opting users
into new permissions. Android 17 does not establish Gemini Nano eligibility.

## Platform audit

Reviewed Google's [all-app changes](https://developer.android.com/about/versions/17/behavior-changes-all)
and [target-37 changes](https://developer.android.com/about/versions/17/behavior-changes-17)
on 2026-09-14.

- **Memory limits (all apps):** prioritize real native photo measurement and
  offline face/object execution. Measure bounds encoded input to 20 MiB and
  decodes to at most 1600 pixels per side; camera analysis previews to 1024.
  These bounds are not proof of acceptable peak process memory. Record actual
  platform/page size, memory-limiter status and process exits; do not disable
  the limiter to obtain a pass.
- **Background audio hardening (all apps):** Construct's fixed tones are
  foreground-only and released when leaving. Verify grant/revoke, quiet modes
  and background cleanup; emulator submission does not prove physical audibility.
- **IME restoration (all apps):** Android no longer restores previous keyboard
  visibility after an unhandled configuration change. Construct's module and
  measurement activities handle rotation; Nano Lab deliberately clears a
  recreated session. Check interactions, not an assumption that the IME remains.
- **Networking:** current host uses HTTPS and network security configuration.
  The API-37 `ACCESS_LOCAL_NETWORK` runtime permission must be designed into a
  future target-SDK migration before LAN registry refresh or discovery relies
  on it. Do not pre-emptively add a permission to the current pilot. Certificate
  transparency/ECH changes also need testing with the intended trust profile.
- **Native loading:** bundled libraries use normal APK loading, not writable
  downloaded native code. Exercise both OpenCV and MediaPipe on a 16 KiB image.
- **Contacts:** explicit READ_CONTACTS and module grants precede bounded reads;
  the projection does not request account-name/type columns restricted in API 37.
  Verify synthetic browse/search/details/revocation rather than real contacts.
- **Screen content:** native camera/measurement/Nano Lab use FLAG_SECURE already;
  they do not rely on the newly deprecated content-capture-disable method.
- No SMS, widget, Bluetooth, pointer-capture or cross-profile loopback feature
  is implemented in these apps. These are not new acceptance claims.

## Isolated runner profile

`setup_runner.py` accepts `--api-level 37`, a unique
`--service construct-emulator-api37.service`, and optional `--single-avd`.
The default API-36 names and separate normal/camera snapshots are unchanged.
The new root and AVD home must be separate from existing baselines. A shared
SDK installation can hold both images without updating the emulator binary.

A single-AVD profile uses `construct-api37` and app-free `clean` for every scope,
with an **emulated** rear camera even in baseline runs, so snapshot hardware
stays identical. No physical webcam or phone is attached. Use only one emulator
on the fixed local port at a time; never enable boot autostart. Start refuses an
occupied emulator serial, and acceptance checks the actual SDK level before
installing a candidate. Receipts record kernel page size and memory-limiter state.

Provision image `system-images;android-37.0;google_apis_ps16k;x86_64` and follow
[runner bootstrap](android-runner.md), substituting the configured AVD name and
using `-camera-back emulated`. The reference runner uses a 3 GiB sparse data partition (6 GiB could not be
created within its available disk); retain free space for snapshot growth.
Save only after Android setup and automation are
ready, both apps are absent, and reboot/restore can be independently verified.

## Execution status

An initial API-37/16-KiB snapshot booted but was **rejected**, not accepted:
SurfaceFlinger aborted in GoldfishMapper::readFromHost with
`!rcEnc->featureInfo()->hasReadColorBufferDma`; system-server/package-service
failure prevented Nano Lab installation. The failure also appeared during first
boot, before either candidate app was installed. A replacement baseline is being
checked with the explicit emulator-only `--disable-graphics-dma` option
(`GLDMA` and `GLDMA2` off). Existing API-36 settings remain unchanged.
Stock Google WebView is 145.0.7632.218. The image reports its memory limiter
**disabled by default**; no override was applied, so this is not evidence of
enforced app-memory-limit behavior.

Compatibility execution is in progress. No Android 17 app
acceptance or Nano generation is claimed yet. Existing APKs remain unchanged.
