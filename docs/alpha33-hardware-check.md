# Alpha33 — camera metadata and screenshot controls

Android staging passed 8/8 on the exact x86-64 APK, with one disclosed freshness-related retake. ARM64 is ready for a physical-phone check.

Source f172276bfb4b191f08acff7fb148b3d3e057503d. ARM64 SHA256: 45437aafaf3e09f37a547c37665a675722a6e0429b5f5571dec0cf9748486376.

Install the ARM64 APK over alpha32; do not uninstall or clear storage. Existing photos, marks and module data must remain. This host adds API 0.13; Aimé 0.1.9 still works but cannot request the new level/zoom controls. Aimé 0.2.0 is a separate forthcoming module update.

## Screenshot preference (works with existing Aimé)

1. Open Aimé and confirm screenshots remain blocked by default.
2. In Construct menu → Module access, enable Allow screenshots, reopen Aimé, and take a screenshot.
3. Open Android Recents: the app thumbnail should remain hidden on Android 13+. Return through the host and reopen the module; backgrounding intentionally ends a module session.
4. Restart Construct and confirm the per-module preference persists. Turn it off and confirm screenshots are blocked again. The native camera viewfinder and private-photo confirmation dialogs stay protected regardless.

## Combined camera test after Aimé 0.2.0 is ready

Use the same known viewpoint for comparable 1× and 2× photos, level indicator on, one known landmark, no horizon taps initially. Check three recognizable targets and report top-three hits and ±°. Compare against the earlier module, without assuming digital zoom guarantees more real detail.

Zero pitch means the camera points horizontally at the horizon. Hold the phone upright with the image right side level to check near-zero pitch/roll. A phone laid face-up/down flat has pitch near ±90°, not 0°; roll becomes ill-defined there and capture tilt may correctly be omitted.

Lens angle, tilt and heading are estimates, not guarantees; unsupported/stale/unreliable values must be omitted. Heading is magnetic until the module applies available cell declination. Do not expect all phones/lenses to provide every field.

No public APK release or module promotion is implied by this candidate.

If measured tilt is unavailable on a photo, report it; the host intentionally omits stale/unreliable values. The emulator needed one retake when the sample age was 254 ms, above the 250 ms tilt bound.
