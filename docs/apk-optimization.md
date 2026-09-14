# Alpha 16 packaging and Pocket Measure review response

## Why the universal APK grew

Inspection of the alpha 15 artifact (197,794,762 bytes) found approximately:

- 136.65 MB OpenCV native libraries, across four architectures.
- 45.93 MB MediaPipe native libraries, across four architectures.
- 4.86 MB other native runtime code.
- 4.83 MB models and 5.27 MB other APK entries, plus ZIP/signing/alignment overhead.

The ARM64-only entry estimate before trimming was 45.44 MB. This was an estimate,
not an accepted build. Users do not need emulator or 32-bit binaries on an ARM64
phone, and marker detection does not need the full OpenCV Java API.

## Changes

- Standalone ARM64 phone and x86-64 emulator APKs; no universal artifact by default.
- Same upstream OpenCV 4.12.0 ArUco dictionary ID 0, subpixel corner refinement,
  pure-Kotlin measurement geometry and native photo/grant boundary.
- Pinned source build, static libraries and link-time section removal through a
  narrow JNI bridge. No all-purpose OpenCV Java wrapper, DNN or camera/codec layer.
- Optional KleidiCV/Carotene, IPP, OpenCL and other unrelated backends disabled;
  no extra downloaded acceleration source is needed by this configuration.
- Independent native dimension/array-size validation and sanitized JNI failures.
  C++ scoped objects release detector/image allocations on normal and error paths.
- Actual artifact size budgets, single-architecture checks, model hash checks and
  16 KB ELF checks in CI. APK signatures and ZIP alignment are checked separately.

This does **not** move native code into web module ZIPs. Optional support is a
[separate design proposal](capability-packs.md), not an implemented download feature.
No new Android permissions or new module package are required for this optimization.

## Review: stable photo placement at larger fonts

[PR #5 feedback](https://github.com/blueworkslabs/construct/pull/5#discussion_r4004751737)
correctly points out that `minLines = 3` reserves a minimum, not a constant space.
Status text can exceed it on narrow screens or at larger system font scales.

The status now occupies a fixed three-line-height region at the current font scale.
Its full content remains scrollable; changing messages resets its scroll position.
The region does not grow when an instruction/result wraps, so status changes cannot
steal height from the photo. This is a focused bug fix, not the planned UX redesign.

The device suite adds normal/narrow widths (720/600 pixels) at font scale 1.3,
checking exact photo bounds across both taps, result and clear, plus known length.
It restores the disposable device configuration afterward.

## Acceptance status

Build and Android results for alpha 16 are pending. Historical alpha 15 receipts
remain in [Pocket Measure](pocket-measure.md); they do not validate the new native
bridge. Record new APK hashes and sizes, optimized offline measurement checks,
host baseline, and existing vision regression before offering a candidate.

The emulator tests x86-64. ARM64 packaging/signature/alignment checks are not a
substitute for executing ARM64 on a phone. A focused Pixel check follows delivery.
The user has reported alpha 15 working well in multiple real-world settings;
that is not a new quantified accuracy guarantee for either version.
