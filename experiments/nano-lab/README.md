# Construct Nano Lab

A **separately installed experimental app**, not a Construct host update or module.
It asks the public ML Kit Prompt API whether AICore can serve this app and, only
when available, offers independent short text prompts with streamed output.

## Why a separate app?

The current Prompt SDK has newer dependencies than the host. This isolated Java
Android project avoids upgrading the working host or exposing an unproven model
capability to module JavaScript. Gemini Nano's model is managed by AICore, **not
bundled in this APK**. There is no API key or cloud inference fallback.

Google's [current device list](https://developers.google.com/ml-kit/genai#device_support)
does not include Pixel 8a. The developer-settings switch, an installed AICore app,
or an Android version upgrade alone does **not** establish third-party Prompt API
eligibility. The actual API result is the experiment. Checking before and after a
system update is useful; an update is not a prerequisite for this probe.

## Run the experiment

1. Install Nano Lab alongside Construct. Open it and tap **Check availability**.
2. `AVAILABLE`: choose **Tiny story** or type a short prompt, then **Send prompt**.
3. `DOWNLOADABLE`: **Download model** shows a confirmation first. AICore controls
   the size/progress; use Wi-Fi and sufficient storage. Check availability again
   after completion. A shared download may continue after the app closes.
4. `DOWNLOADING`: allow preparation to finish and check again later.
5. `UNAVAILABLE` or an error: copy the technical report. Do not infer that Nano is
   broken or that a developer switch can override Google's device/API rollout.
6. Once a real prompt succeeds, turn networking off and repeat to test offline
   inference on that device. Keep Nano Lab visible. Never count an emulator's
   unavailable result as proof of either successful inference or phone support.

The other presets are a spaceship mechanic and rough-note-to-checklist example.
Each call has no app-maintained conversation history, at most 2,000 prompt
characters, fewer than 4,000 input tokens, and 128 requested output tokens.
Outputs are experimental suggestions, not executed commands. There is no image,
audio, tool execution, background service, saved chat, or automatic retry loop.

**Stop request** cancels the client's operation; it cannot promise to stop a
shared AICore download. Leaving the screen (including rotation) clears text,
invalidates callbacks, cancels the future and closes the client. Android/AICore
may independently reject requests for foreground, resource or quota reasons.

## Privacy and scope

The APK has **no `INTERNET` permission**, no cloud backend, and no camera, contacts,
microphone or storage permission. It binds to AICore through the SDK. AICore is a
separate system service with its own permissions, configuration and networking;
the APK's permission restriction is not a claim that AICore never uses a network.
The SDK includes Google's transport/initialization components, but the app UID
cannot directly make Internet requests. SDK/system-owned caches are distinct
from the app's policy of not saving prompt or response text.

The app does not log input, output or raw SDK exception messages. Its technical
report includes app/SDK/device/Android/AICore/model versions, status/error codes
and elapsed time—not prompt/response text or persistent device identifiers.
Copying it is explicit. The window is screenshot-protected and backup/transfer
is disabled. Keyboard/OS behavior remains outside this app's control.

## Build and verify

Requirements: JDK 17, Android SDK platform/build-tools 35, root Gradle wrapper.
From the repository root:

```sh
./gradlew -p experiments/nano-lab --no-daemon \
  :app:testDebugUnitTest :app:lintDebug :app:assemblePilot --max-workers=1
python3 experiments/nano-lab/check_apk.py \
  experiments/nano-lab/app/build/outputs/apk/pilot/app-pilot.apk
```

Package: `dev.construct.nanolab`. The pilot uses the local Android debug signer,
but is non-debuggable and R8-optimized. Keep that signer for in-place updates.
No host fixtures, operator configuration, model download or Construct signing
material are needed. ML Kit is pinned to `genai-prompt:1.0.0-beta4`.
Lint is independently pinned to 32.1.1 for the SDK's Kotlin 2.3 metadata; the host
toolchain is unchanged. This small English-only lab retains localization warnings.

CI builds the optimized probe and checks lifecycle contracts and APK boundaries.
The separate `acceptance.py` driver requires an explicitly selected disposable
Android device, ADB and `uiautomator2`. It tests the **unavailable** path with the
real SDK; it neither mocks a successful inference nor downloads a model.
Phone inference, download consent/progress on an eligible device, streaming,
cancellation of a real inference, and offline operation remain device checks.

Official references: [Prompt API](https://developers.google.com/ml-kit/genai/prompt/android),
[setup](https://developers.google.com/ml-kit/genai/prompt/android/get-started),
[foreground and quotas](https://developers.google.com/ml-kit/genai).

## Alpha 1 verification checkpoint — 2026-09-14

- App/build source: `5d56689548620385d96144a5655ab4ccd1704c80`.
- Optimized, non-debuggable APK: **1,583,118 bytes**.
- SHA-256: `76230bd83a71db4674d5bf1457af7951b90d67a17b2525cd10d14168af4f7a67`.
- Five JVM lifecycle tests passed. Lint: zero errors, 30 warnings
  (target-version and English-only localization warnings).
- [Fresh-checkout probe CI passed](https://github.com/blueworkslabs/construct/actions/runs/34889705858),
  including optimized packaging and actual APK permission/size checks.
- Seven real Android 16 emulator checks passed on that exact APK, with no AICore
  package installed. Emulator stopped; no emulator process remained.

- Fresh launch makes no automatic check or download.
- Real Prompt SDK returns UNAVAILABLE without crashing.
- Unavailable state disables download and inference.
- Technical clipboard report contains versions/status and excludes synthetic prompt.
- Background/return clears text and readiness without process restart.
- Rotation starts a fresh empty session.
- Explicit Clear and Close work.

Earlier incomplete receipts are retained separately. They exposed test-driver
problems around the notification shade, asynchronous keyboard appearance and
unstable/edge tap coordinates. The final driver settles text-entry transitions,
dismisses only the detected keyboard, bounds scrolls, and requires stable tap
rectangles. No failed receipt is counted as a complete pass; the APK remained
unchanged throughout these runs.

**Still unverified:** access on a physical device, offered model download and
inference/streaming/offline behavior. The emulator's real `UNAVAILABLE` result
is only unavailable-path evidence, not proof of a working Nano model. The
Construct host was not modified or re-tested for this standalone experiment.

### Clipboard driver option

`acceptance.py --paste-key` verifies the same real copied technical report using
Android's native Paste key into the focused prompt field. The default still uses
the floating Paste menu. This option exists because an API-37 test run did not
expose that menu; it does not inject report text, read it from source, change the
APK, or claim that the long-press menu was fixed. Both paths require the actual
clipboard contents and absence of the synthetic prompt marker.
