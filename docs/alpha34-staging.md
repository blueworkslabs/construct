# Alpha34 — camera-result geometry and privacy

**8/8 Android checks passed on the final APK**, run `20260927T200243Z-capture-metadata-9252f045`, complete/stopped true. Actual captures reviewed. 243 JVM tests, lint, 89 runner-helper checks, APK size/alignment and signatures pass.

## Artifacts

Host source `e1318303cbb64e43360a2807b81c3beebb5806c6`; runner `af57ff9`. Both ABIs retain alpha33's signer and the pinned module publisher.

- ARM64 SHA256 `b87217671df8029f2420e7883b34f4c5501d97fd79d1770b78bf265422f66ed2`.
- x86-64 executed SHA256 `990f178d0516f4d0797b98d12c62da3813d665087e725a464ec7300851b65dbc`.

[Receipt](evidence/alpha34/acceptance.json) · [Phone checklist](alpha34-hardware-check.md).

## Findings and corrections

The initial alpha34 run exposed live module and native-dialog contents in Recents. This code was shared with alpha33: earlier black-frame evidence did not establish reliable protection. `af57ff9` adds opaque non-focusable covers to actual activity/dialog windows, controlled by lifecycle and each window's own focus. No confirmation is approved/cancelled by hiding it. Foreground content is restored and dying windows retain their cover. Snapshot suppression and secure flags remain separately enforced. Actual settled Recents images on the final APK hide contents; all transient gesture frames remain a phone check.

Still-frame lens metadata now uses focal length, crop, zoom and active-camera facts when compatible. Unsupported off-centre crops omit FOV and axis-dependent tilt/heading, without a fallback escape. The late fix `e131830` waits through the complete bounded 500 ms observation window before deciding none/one/several still results. This runs on the capture worker and does not block the UI; it adds approximately 500 ms to metadata-enabled captures. Arrival-time correlation does not prove identity against arbitrarily late callbacks. Pixel logical-camera behavior remains unverified until hardware testing.

Earlier attempts remain separate: the first was manually blocked despite automatic checks; the privacy-fixed second passed 8/8 but was superseded by the timing correction. Only this receipt clears the final host bytes. Aimé acceptance is separately identified in its receipt; no cross-run stitching.

## Observations

Legacy API, stable library IDs, both pitch and roll signs, near-zero level, 1×/2× crop formula, foreground screenshot opt-in/persistence/off and protected native windows pass. Actual module/dialog Recents and foreground restoration were reviewed. No separate viewfinder-Recents test, landscape camera layout or physical sensor accuracy pass is claimed.

Recorded retakes: []. Raw capture entries preserve every attempt. The emulator's capture-result FOV path is exercised, but this is not a logical multi-camera. Dataset remains r2, r3 held. No merge, public release or production promotion.

Shutdown caveat: all eight checks completed before the requested stop, and no emulator remained running, but the emulator process aborted during teardown (systemd core-dump/SIGABRT). This is not recorded as a clean emulator exit or a Construct crash. The guest crash buffer contains only its known Bluetooth boot abort.
