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
The result/placeholder row similarly remains one horizontally scrollable line,
so a shorter numeric result cannot reclaim height from a wrapped placeholder.

The device suite adds a 720×1280 / font-scale 1.3 layout and a deliberately narrow,
tall 480×1600 / font-scale 1.8 stress layout (not a claim of testing another phone),
checking exact photo bounds across both taps, result and clear, plus known length.
It restores the disposable device configuration afterward.

## Built candidates and verification contract

Optimized operator-profile artifacts from app/packaging source `9a2959d`:

- ARM64 phone: **23,265,389 bytes** (about 23.3 MB; 88.2% smaller than alpha 15),
  SHA-256 `366f522999e9dc7693a4e6ca475af2978a04700bf3e053c06aed41506cc00a98`.
- x86-64 emulator: **26,132,670 bytes**, SHA-256
  `0c1a320405a888b875ae28efd2ae551dbf98c61915c7b81135bde8651dee687c`.
- Trimmed measurement library: 3,045,168 bytes ARM64 / 3,379,720 bytes x86-64.
  The previous ARM64 OpenCV library alone was 23,465,088 bytes.

Both artifact checks passed: unchanged APK signing identity and permissions,
nine unchanged publisher/demo/model assets, byte-identical MediaPipe native
library, correct single architecture, 16 KB ELF load alignment and APK ZIP alignment.
The installed NDK's strip tool initially rewrote eight bytes of MediaPipe section
metadata; `keepDebugSymbols` now preserves that already-stripped upstream library.
It does not disable stripping of our newly built measurement library.

The [PR acceptance record](https://github.com/blueworkslabs/construct/pull/5)
records the new exact-hash Android runs and their outcome before promotion:
optimized offline measurement and large-font checks, host baseline, and existing
vision regression. Historical alpha 15 receipts remain in
[Pocket Measure](pocket-measure.md); they do not validate the new native bridge.

The emulator tests x86-64. ARM64 packaging/signature/alignment checks are not a
substitute for executing ARM64 on a phone. A focused Pixel check follows delivery.
The user has reported alpha 15 working well in multiple real-world settings;
that is not a new quantified accuracy guarantee for either version.
