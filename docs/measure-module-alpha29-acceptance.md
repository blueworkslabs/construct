# Module-owned Measure — alpha29 acceptance

Host source `c26c85e7f061f5f539e7f29d12d2022cc1809dae`; Pocket Measure
0.2.2 module source `1022428b9dc0d6fd02a836662681a25c5c4704f9`.
Later runner, catalog and documentation changes do not change either artifact.
See the [machine-readable receipt](evidence/measure-module-alpha29-2026-09-17.json).

## Ownership and migration

Seven native Measure workflow/geometry/UI classes, the Activity and dispatch are
removed. The host provides bounded `image.read` and `image.markers`; the signed
module owns reference selection, calibration, projective geometry, endpoints,
undo, gestures, units and screens. Camera is the remaining native workflow.
Alpha28 is the final native Measure host. Alpha29 preserves old installations and
saved module data but requires a supported module update, rejects retired
installation/rollback and does not reuse old consent for pixel delivery.

## Completed checks

- 174 JVM tests; lint zero errors; 18 module, 30 publisher/script and 67 runner tests.
- Complete functional/lifecycle/layout scope: **18/18**, `functional-20260917T224311Z-measure-module-4951d354`; complete and emulator stopped.
- In-place retirement/upgrade scope: **5/5**, `retirement-20260917T223133Z-retirement-b1d465be`; complete and emulator stopped.
- Signed module-only units update/rollback: **2/2**, `update-20260917T223839Z-measure-module-c8ec69c8`; complete and emulator stopped.
- Separate focused lifecycle scope passed 8/8 while diagnosing the driver; final full-scope evidence above is authoritative.


Both APKs retain the publisher identity, Android permissions and 17 protected
assets from alpha28. Native Sky/Measure classes and aviation provider strings are
absent. Only the marker JNI library changes; other native libraries are identical.
ARM64 APK is 23,806,322 bytes; x86_64 is 26,689,907 bytes, with 16 KiB alignment
checks passing. Host CI for the frozen source passed; later hosted CI is reported
separately in the PR.

## Corrections and excluded runs

A real pinned-WebView input difference was found: Android cancellation delivered
`touchcancel` without `pointercancel`, leaving an uncommitted endpoint preview.
Actual UI-handler tests reproduced it. Module-only fixes add touch-cancellation,
lost-capture handling and explicit capture release; no host rebuild was needed.
Final module tests pass 18/18, including the previously failing regressions.
Intermediate 0.2.0/0.2.1 packages remain immutable for provenance but are not offered
in the final candidate catalog. The diagnostic pointer-probe fixture is not
acceptance or a production module.

Earlier runs also exposed driver assumptions about accessibility nodes outside
the scroll viewport, label versus input bounds, keyboard/layout transitions,
displayed-unit rounding, pinch geometry and returning during the launcher
animation. A follow-up driver also mistook Android’s retained
`mLastPausedActivity` reference for a live Activity; the focused dump showed the
module had actually been removed and reopening cleared its state. These were
corrected against observed Android behavior. One exploratory trace run failed while serializing XML; another was explicitly superseded by the
new immutable module. Debug prototype and all interrupted/incomplete runs are
excluded from the completed scopes above.

## Visual and evidence limits

Android image windows retain `FLAG_SECURE`; ordinary screenshots are black.
Reviewed synthetic emulator-console captures show the actual display without
weakening that protection. Portrait/landscape and 2× text are exercised; at large
text sizes supporting copy requires scrolling the bounded control panel. Raw
landscape console PNGs may be rotated relative to the saved raster.

Synthetic flat, perspective and EXIF-oriented fixtures establish implementation
behavior, not real-photo accuracy or physical ARM64 acceptance. Preview fixtures
prove the scoped units update/rollback only; final Pocket Measure acceptance uses
its own exact signed 0.2.2 bytes. Photos and calibration are intentionally transient
between runs, so no retained-measurement claim is made. The full Camera and live
Sky device suites were not rerun for this change. Main/catalog promotion and PR
merge are separate from publishing a pilot.
