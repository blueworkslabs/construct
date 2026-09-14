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
  downloaded native code. Exercise both OpenCV and MediaPipe on the selected image; report 4 KiB and
  16 KiB execution separately, without inferring one from ELF alignment.
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
using `-camera-back emulated`. The reference guest uses a 3 GiB sparse data partition (6 GiB could not be
created within the original disk budget). A 3 GiB RAM snapshot also consumed the
emulator's required free-space reserve, even after verified off-runner archival
of historical staging APK copies. A dedicated virtual data volume (initially 16 GiB, now 24 GiB for both
page-size profiles) was therefore added for the **new** AVD; its files are checksum-verified during the
move and its absolute paths retained. Existing boot disks, Android-16 snapshots,
current APK/provider files and recovery backups are not modified. Provision both
actual image/snapshot capacity **and** the emulator's startup free-space reserve;
apparent sparse partition size is not sufficient capacity planning.
Save only after Android setup and automation are
ready, both apps are absent, and reboot/restore can be independently verified.

## Execution status

An initial API-37/16-KiB snapshot booted but was **rejected**, not accepted:
SurfaceFlinger aborted in GoldfishMapper::readFromHost with
`!rcEnc->featureInfo()->hasReadColorBufferDma`; system-server/package-service
failure prevented Nano Lab installation. The failure also appeared during first
boot, before either candidate app was installed. Disabling `GLDMA`/`GLDMA2` did **not** fix it, and that experimental option was
removed. Android's `LOG_ALWAYS_FATAL_IF` condition actually signals *missing*
required DMA support. The host advertises read-color-buffer DMA only when both
`GLDirectMem` and `HasSharedSlotsHostMemoryAllocator` are enabled; its default
GLDirectMem is off. The replacement baseline uses explicit
`--enable-direct-memory` (both features on), without updating the shared emulator
binary or changing the API-36 profile.

Source: [guest mapper](https://android.googlesource.com/device/generic/goldfish/+/refs/heads/main/hals/gralloc/mapper.cpp)
and [host RenderControl](https://android.googlesource.com/platform/hardware/google/gfxstream/+/refs/heads/main/host/RenderControl.cpp).
The direct-memory experiment passed one 45-second system-server check with an
empty crash buffer, but UI automation timed out and the next cold boot restarted
system-server. It is **not** a stable baseline or a successful UI-driver comparison.
Emulator 37.2.9 runs in a separate SDK root; the shared API-36
emulator remains pinned at 37.1.11. With the new binary and fresh 2 GiB guest,
Android's low-memory killer removed setup/settings/permission-controller processes.
The 3 GiB profile (`--memory-mb 3072`) then passed fresh boot, a stable
system-server interval, UI-driver initialization and app-free snapshot save with
empty startup and pre-snapshot crash buffers. The 5 GiB process cap and 6 GiB VM
remain unchanged. Snapshot restoration and all seven Nano Lab checks subsequently passed. These
combined environment changes are not an app fix or isolated proof of one cause. Stock Google WebView is 145.0.7632.218. The image reports its memory limiter
**disabled by default**; no override was applied, so this is not evidence of
enforced app-memory-limit behavior.

## Accepted compatibility evidence

Nano Lab alpha 1 passed all seven checks on the restored API-37 snapshot:
fresh launch without automatic work, real SDK `UNAVAILABLE`, disabled download
and inference, genuine clipboard report privacy, background cleanup without
process restart, rotation reset, and explicit Clear/Close. The run completed with
an empty crash buffer and stopped emulator. This image has no AICore: **neither
Nano generation nor Pixel eligibility is established**.

The Android 17 floating text-selection toolbar did not expose Paste during the
first UI run. The accepted run uses the optional native Paste key into a focused
EditText, reads the actual clipboard report and retains the original privacy
assertions. It does not substitute generated report text or claim that the
floating toolbar issue was fixed. Only the test driver changed; the APK did not.

- Nano APK SHA-256: `76230bd83a71db4674d5bf1457af7951b90d67a17b2525cd10d14168af4f7a67`
- Platform: Android 17 / API 37, x86-64, 16384-byte pages.
- System image: Google APIs 16 KiB revision 6, build `CE2A.260420.019`.
- Emulator: 37.2.9; stock WebView 145.0.7632.218.

Construct alpha 19 passed its complete host baseline on **API 37 / 4 KiB** with
Chromium snapshot 1697462 / WebView **155.0.8059.0**: Checklist 5/5, bounded probes
5 BLOCKED / 6 CONTAINED / 0 FAIL, injected renderer-loss recovery, tones 7/7 and
consent 5/5. The original background-stop assertions passed. No Construct native
crash appears in this receipt; its separate Bluetooth hardware-error crash is
retained, not described as an empty platform crash buffer. Native photo and other
module scopes remain in progress.

- Construct x86-64 APK SHA-256: `739289ca1f9aa0f7b82e6ede687c6f5cb76275fd51b25968400b21d5516ca303`
- Host receipt: `20260914T223302Z-d490fcb1`, complete and emulator stopped.
- Both APKs remain unchanged; only runner code/environment changed.
- Physical ARM64 behavior and enforced memory-limit behavior remain outside this
  emulator evidence. Both images report the limiter disabled by default; no
  override was applied.
- Android 17's installed-package dump reports an automatically granted
  `ACCESS_LOCAL_NETWORK` compatibility permission (`REVOKE_WHEN_REQUESTED`) for
  the target-35 host. This was not added to the APK and is not a tested target-37
  runtime-consent flow.

## Construct runtime investigation

The initial stock-WebView run passed all five checklist checkpoints, probes at
5 BLOCKED / 6 CONTAINED / 0 FAIL, renderer-loss recovery and the first six tone
checks. Its final background check failed after a fixed 600 ms Home/return
interval; that receipt remains failed. A second run observes a real launcher
transition before returning and retains the cleanup assertions. The module
activity finished, but **the host process then crashed**: SIGILL in WebView
145's `libwebviewchromium.so`, called from `onTrimMemory`. This is not a passing
background check or merely a missing accessibility node.

A controlled comparison uses the existing explicitly pinned Chromium provider
via `--webview-apk` / `--webview-sha256` on a fresh disposable snapshot. It changes
no Construct bytes and no phone provider. WebView 155.0.8058.0 reproduced a
SIGILL in the same `onTrimMemory` path, so this is not isolated to provider 145. An earlier
stock run also recorded an unrelated emulator Bluetooth hardware-error crash;
it is retained separately rather than described as an app failure or an empty
platform crash log.

The 16 KiB vision run also stopped **before inference** with
`CAMERA_UNAVAILABLE`. CameraX reported an expected front camera absent while the
emulator exposed one rear camera. No detector success is inferred from this.
The first vision attempt stopped even earlier because its guard still named
the API-36 AVD; the guard now checks `CONFIG.profile(True)` while retaining the
exact synthetic-camera constraints.

An official API-37 Google APIs **4 KiB** x86-64 revision-6 image is being compared
in a separate runner root/AVD home on the same dedicated data volume. Its first
boot, stable system-server interval, UI initialization and app-free snapshot
save passed. A focused native-host + real Checklist WebView launch, Home and
10-second background interval then passed on stock WebView 145: unchanged host
PID, empty crash buffer, verified stop. Full acceptance remains in progress;
this is not yet a matched reproduction of the complete failing tone sequence. Only one emulator runs at a
time, and neither Android-16 snapshot is replaced. A native-host-only launch
and Home test survived on the 16 KiB image; the focused comparison must load a
real WebView module before backgrounding to exercise the relevant path.

The first full 4 KiB run passed Checklist but stopped in probe setup with
`REGISTRY_URL`: ADB simulated typing had produced invalid catalog input.
Probe setup now uses the existing exact-value `replace_text` helper and requires
`Catalog refreshed.` before selecting the exact fixture. The clean rerun reached
probe execution successfully; no app URL validation was relaxed.

## Upstream memory-footprint fix under test

Inspection of the pinned provider's crashing instruction found an intentional
`ud2` arithmetic trap, including a checked resident-minus-shared page calculation,
not an unsupported SIMD instruction. Chromium landed a matching defensive fix
on 2026-09-14: [return nullopt for inconsistent private-memory readings](https://chromium.googlesource.com/chromium/src/+/7cde02997c20dbf455d80ca98b536092c577bded),
commit position **1697321**. This is a strong lead; a successful matched runtime
comparison is still required before attributing the observed failure to it.

The official AndroidDesktop_x64 snapshot **1697462** contains that guard in its
recorded source revision `e35794544a1e03e7d1f89b8ad1ac8970923c6f2b` (verified from
`REVISIONS` and the source at that revision). Its exact test-provider APK is:

- [Official archive](https://storage.googleapis.com/chromium-browser-snapshots/AndroidDesktop_x64/1697462/chrome-android-desktop.zip)
- Member: `chrome-android-desktop/apks/SystemWebView.apk`
- APK bytes: 412051160
- APK SHA-256: `e4ded2f4d0f22dce452fd0d9f485a9b78926a9e2c3d4ffe64f4a385346d20497`

This is a **development test provider for the disposable emulator**, not a phone
WebView recommendation or a component embedded in Construct.

The runner also supports `--emulate-front-camera`: only the literal generated
front-camera mode is allowed; legacy profiles still use front `none`. Android 17
CameraX reported missing advertised front hardware with the rear-only profile,
so the replacement snapshot supplies **both generated cameras**. Guards verify
the configured AVD and actual front/rear arguments; physical webcams remain
excluded. A native Close-module completion assertion now prevents host navigation
from racing the closing menu's old accessibility tree.

Keeping both page-size comparisons exhausted the initial 16 GiB data volume's
startup reserve. That new volume alone was expanded to **24 GiB**, restoring
about 9 GiB headroom; no existing boot disk, Android-16 snapshot or recovery data
was replaced. Startup now fails promptly when the emulator service fails.

The both-camera 4 KiB vision attempt (`20260914T224714Z-7672048b`) still returned
`CAMERA_UNAVAILABLE` before preview/capture or inference. CameraX successfully
listed both cameras and reached lens validation, unlike the earlier missing-front
failure. This run is failed, not a native-inference pass. Further diagnosis uses
an explicitly separate debug build to reveal the caught binding exception; it
cannot substitute for acceptance of the unchanged optimized APK.

The first measurement attempt also stopped before native work: the bounded
catalog navigator exposed the final measurement heading but not its install
button. Its scroll distance now covers more of the content viewport per step;
the 20-scroll limit, exact module/version boundary and stable enabled-action
requirements are unchanged. Camera/vision waiting also fails immediately on an
explicit native camera error rather than waiting for a result that cannot arrive.

## Confirmed CameraX compatibility fix (alpha 20 candidate)

The diagnostic build exposed the exact exception:
`NullPointerException: Dynamic range profile cannot be converted to a DynamicRange object: 8192`
in CameraX 1.4.2's `DynamicRangesCompatApi33Impl`, during `bindToLifecycle`.
Google documents this [Android 17 dynamic-range compatibility issue](https://developer.android.com/jetpack/androidx/releases/camera#1.5.2)
and recommends CameraX 1.5.2 or newer. The selected stable **1.5.3** source was
checked: unknown profiles are logged/skipped rather than dereferenced. Its AAR
requires compile SDK 35 and AGP 8.6, within the existing toolchain.

Alpha 20 updates all three CameraX dependencies together to 1.5.3. No camera UI,
permission, image-storage, model or target-SDK change is intended. The diagnostic
logging patch is not in the candidate. Optimized exact-build acceptance remains
required; a source-level match alone is not a camera pass.

The measurement cancellation driver now waits for `Photos` in the actual native
media-picker package before Back. A fixed post-tap delay had sent Back before the
new picker appeared; the original cancellation-result assertion remains.

Android 17 uses the separately packaged system photo picker
`com.google.android.photopicker/com.android.photopicker.MainActivity`. The driver
recognizes its observed package as well as legacy media-provider pickers. After
selecting the single synthetic thumbnail, it either observes an immediate return
(legacy behavior) or requires one selected photo before tapping native `Done`.
It still requires real decoded/calibrated results afterward; selection alone is
not a pass.

A separate focused test catalog keeps only the exact probe, camera and measurement
versions under test. It copies the original signed entries and verifies unchanged
ZIP hashes; historical catalogs and the user's home catalog remain untouched.
This avoids repeatedly traversing unrelated historical fixture versions during
native acceptance. Full-catalog navigation remains represented by earlier host
and failed-driver receipts.
