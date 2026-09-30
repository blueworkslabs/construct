# Sky Watch 0.4.2 Follow staging

Status: **fresh Android acceptance pending; not yet cleared for hardware.**
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

## Android acceptance

Pending: native denial/grant; north/east and rotated gestures; raised/high/rolled
pointing; landscape and 200% text; Off, menu, focus-loss and revoke/restart listener
checks; actual live providers and metadata; location, offline, and signed update/
rollback checks. Only the final exact-run receipt will count as acceptance.
Original Android captures require visual inspection. Teardown is checked
independently from the runner's stopped flag.

[Physical-phone checklist](sky-watch-0.4.2-hardware-check.md).

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
