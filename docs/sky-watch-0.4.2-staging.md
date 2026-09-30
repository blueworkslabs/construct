# Sky Watch 0.4.2 Follow staging

Status: **HELD — review fixes complete, full Android acceptance blocked by repeated
ADSB.lol unavailability. Not cleared for hardware.**
No merge, release or production-catalog promotion is included.

## Exact candidate

- Author head: `82edf00`; reviewed and signed candidate: `f2845cd`.
- Real module SHA-256: `ed066d96a8148e661ae859928ecb6ad683608cc17f86f409b6d8ed5180e8c0c2`.
- Unchanged alpha37 x86_64 APK SHA-256: `23cd4b27f95fbc0124fbb6cf69af4d80a6cc8534c58e2235b95e24f4526b5477`.
- [Immutable real catalog](https://raw.githubusercontent.com/blueworkslabs/construct/f2845cdd5739929a4926774c1928812f8f9001d3/catalog/candidates/sky-watch-042/index.json).
- [Synthetic update/Follow catalog](https://raw.githubusercontent.com/blueworkslabs/construct/f2845cdd5739929a4926774c1928812f8f9001d3/catalog/candidates/sky-follow-042/index.json).

Served packages have verified hashes and signatures against the publisher key
extracted from the accepted alpha37 APK. The aircraft fixture substitutes a
single clearly synthetic provider row, not orientation, native grants or storage.
Its two versions differ in the aircraft glossary and version; they are not live
traffic or a physical accuracy test.

## Review

Three regressions reproduce before and pass after the fixes:

- Rotated anchored zoom preserves the geography under the touch point.
- Missing aircraft altitude cannot create a false horizon target, lock or
  “In the middle” identification. Bearing remains usable on the flat map.
- Calibration recovery restores spoken guidance even if the direction has not
  changed.

The accuracy note now explains that the chosen area centre is the assumed
observer location, and observer altitude is unknown. There is no one-or-two-degree
error bound: 500 m observer height at 1 km can change elevation by about 27°.
Feed latency, barometric altitude and compass uncertainty also limit alignment.

Sky core/map/controller checks, both modules' real-browser checks, Space core
and controller checks, 18 package tests and 99 runner-helper tests pass.

## Additional layout correction

Native screenshots exposed canvas grid overflow: the visible guidance was
clipped even though Android exposed its text. A failing-before browser overflow
regression now passes. The viewfinder reserves space for guidance and keeps its
canvas square rather than stretching the aiming geometry. The hidden map is
also removed from accessibility while pointing.

The toolbar also wraps its source/radius controls at narrow widths rather than
truncating selected values at 200% text. A before/after browser text-fit regression
covers Combined and 100 km.

## Android acceptance — incomplete, separate attempts

[Sanitized exact-artifact receipts and original-image hashes](evidence/sky-watch-0.4.2-staging-2026-09-30.json).

- `20260930T190849Z-b3f3afd7`: **17/24**, 19:08:49–19:31:21 UTC.
  All seven native Follow gates, signed update/rollback, native Internet consent,
  live ADSB.lol/OpenSky/Combined, real map pinch, ADSBdb, layouts, menu resume and
  location denial passed. At granted-location auto-start, OpenSky loaded but
  ADSB.lol returned “Request unavailable or cancelled”. The live assertion failed;
  remaining preference/background/offline/revocation checks were not completed.
- `20260930T193245Z-aa9dedbd`: **9/24**, 19:32:45–19:49:17 UTC.
  The same seven native Follow gates, signed update/rollback and Internet consent
  passed. Initial live ADSB.lol loading failed with the same message. The later
  real-module checks were not reached.

**Do not pool these attempts, or the earlier 0.4.1 24/24 functional receipt, into
0.4.2 acceptance.** A fresh complete exact-package run remains required before
phone handoff. No further provider retries were started after the second failure.
The host maps network I/O failures and cancellation to the same HTTP_UNAVAILABLE
message, so the recorded evidence does not establish the underlying cause.

Both runs were independently confirmed stopped: emulator service inactive,
main PID 0, result success, exit status 0. Their crash buffers contain guest
Bluetooth-service aborts, not Construct crashes. There were no attached-WebView
destroy warnings in either suite receipt.

## Inspected native evidence

All **57 original emulator-console PNGs** are retained unchanged, separately by
run, with SHA-256 hashes in the receipt. They are Android captures, not browser
previews. Landscape PNGs retain the console's original orientation.

The first run's inspected captures confirm the full high-angle viewfinder,
landscape/200% guidance, heads-up map, live pinch, attributed ADSBdb record and
readable Combined/100 km toolbar in both orientations. The ADSBdb response
contained Airbus A320 214SL, registration D-AIZR, registry owner Eurowings and
callsign airline Lufthansa; those fields remain explicitly distinguished.
The rerun's high-angle and landscape/200% guidance captures were separately
inspected, and its provider-failure capture matches the recorded error.

- [First run: 200% Combined/100 km toolbar](images/sky-watch-0.4.2-staging/attempt4/android-modular-map-font2.png)
- [First run: live ADSBdb fields and attribution](images/sky-watch-0.4.2-staging/attempt4/android-modular-metadata-portrait-fields.png)
- [Rerun: high-angle pointing](images/sky-watch-0.4.2-staging/attempt5/android-sky-point-high.png)
- [Rerun: 200% pointing instruction](images/sky-watch-0.4.2-staging/attempt5/android-sky-point-large-text-guidance.png)
- [Rerun: live-provider failure](images/sky-watch-0.4.2-staging/attempt5/android-modular-failure.png)

Native listener counts in both attempts were: denial 0; watching 1; Off 0;
menu pause 0; menu return 1; Quick Settings/focus return/still-off 0; explicit
restart 1; revoked 0; fresh process 0. Virtual compass uncertainty is not a
physical heading-accuracy measurement. Sensor and location injection do not
replace phone alignment or TalkBack testing.

[Physical-phone checklist — still held](sky-watch-0.4.2-hardware-check.md).

## Earlier exact-package attempt

Run `20260930T190849Z-b3f3afd7` passed 17/24 checks, including all new
Follow gates and the corrected toolbar captures. At the granted-location gate,
OpenSky loaded but ADSB.lol returned “Request unavailable or cancelled”; the
required live-provider assertion failed. This is incomplete evidence, not
acceptance. It ran 19:08:49–19:31:21 UTC on 30 September 2026. Independent teardown
confirmed an inactive emulator, PID 0 and successful exit. The crash buffer
contains a guest Bluetooth service abort, not a Construct crash.

The host maps network I/O failures and cancellation to that same message; the
recorded evidence does not establish the underlying cause. A fresh full run uses
the same signed module and APK, with no weakened gate or automatic test retry.
