# Alpha34 — capture-result lens geometry

**8/8 Android checks passed on the final APK**, run `20260927T193519Z-capture-metadata-f9c0e25b`, complete/stopped true. One disclosed stale-tilt retake. Exact images reviewed; phone candidate, not physical-camera validation.

Native host change: bounded camera acquisition now associates a still capture result with the saved image, considers its focal length, active physical camera, crop and zoom, and logs a camera-only CAPTURE_FOV source/omission explanation. Ordinary module calibration UI and solver remain downloaded Aimé code.

Reviewed source `1f20448` corrects the off-centre crop finding. The current API has no principal-point offset; unsupported asymmetric crops therefore omit FOV, tilt and heading, including characteristics fallback. Centred crops retain their previous behavior. Two-pixel rounding in the regression is tolerated; four pixels exceed the 0.05° bound. This is a conservative omission contract, not a promise all phones provide a measured lens.

243 JVM tests and lint pass. Both optimized APKs retain the established signer, pinned publisher key and 16 KiB alignment/size checks. Build operator inputs and cached checkout were restored after completion.

- ARM64 SHA256: a7cc744382723a1abae391d5a2ded5beb174ca65e9913773de470d3355ae17aa
- x86-64 SHA256: 2036f59f5de643430649aa4133b04d07ad02a4df59c1047412e3100e8b4d0743

Final APK source and runner `af57ff9` requires measured centred emulator FOV at 1× and 2×, correct tilt signs, stable photo IDs, legacy API compatibility, screenshot opt-in persistence and secure viewfinder/dialog/Recents evidence. It records native FOV diagnostics. Physical logical multi-camera capture remains a Pixel hardware check; emulator success does not establish that the Pixel supplies an active physical camera ID.

Aimé 0.2.2 is staged separately on the exact same APK. Data revision r3 remains held for classification/deduplication defects; existing r2 is unchanged. No public release, catalog promotion or merge is implied.

## Recents correction discovered during acceptance

The first 1f20448 APK completed automated camera checks but failed manual privacy review: actual settled Recents showed both the module and native photo-confirmation contents. The raw run is preserved as blocked, not accepted. Earlier alpha33 black-frame evidence does not prove this was reliable: its ModuleActivity privacy code is identical. The new camera path itself returned tied capture-result FOVs; three bounded stale-tilt retakes were recorded in that superseded diagnostic run.

`af57ff9` adds opaque, non-focusable drawable covers to actual activity and native-dialog windows. Direct lifecycle and per-window focus events cover live surfaces, with foreground restoration; hiding never approves, cancels or dismisses a confirmation. Dying windows retain their cover through final disposal. Screenshot flags and snapshot suppression remain enabled separately. Four event-order tests cover delayed pause/focus, per-dialog focus, leave-hint latching and older-platform lifecycle fallback. Runner assertions examine the actual Recents tile and retain lifecycle/window dumps.

Source reasoning does not guarantee every transient gesture frame. Final settled-Recents images and restoration behavior must be checked on the exact rebuilt APK, with physical-phone gesture behavior still part of the phone test.

## Final run

All five poses returned valid tilt; positive roll needed one retake after a 297 ms sample correctly omitted tilt. Valid ages 153–250 ms. The FOV source was `capture-result` for every measured capture; 1× 39.97°×51.73°, 2× 20.61°×27.25°. Stable IDs, legacy API, screenshot default/off/on/persistence and foreground restoration pass. Both actual settled Recents images hide private contents. Native viewfinder and photo confirmation remain screenshot-protected. No separate viewfinder-Recents test is claimed. Only the known emulator Bluetooth boot abort appears in the crash buffer.

[Receipt](evidence/alpha34/acceptance.json) · [Phone checklist](alpha34-hardware-check.md). Earlier alpha33 claims of reliable Recents privacy are superseded by this finding and correction; earlier evidence is retained, not rewritten.
