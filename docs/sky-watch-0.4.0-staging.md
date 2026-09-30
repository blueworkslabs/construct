# Sky Watch 0.4.0 Follow staging

Status: **Android acceptance in progress; not cleared for hardware yet.**
No merge, release or production-catalog promotion is included.

## Exact candidate

- Author head: `82edf00`; reviewed and signed candidate: `2056d87`.
- Real module SHA-256: `a367a7d7f5771ae20b6703e596a8f896f63c8955cbbc7a8bf20531d0fabdc600`.
- Unchanged alpha37 x86_64 APK SHA-256: `23cd4b27f95fbc0124fbb6cf69af4d80a6cc8534c58e2235b95e24f4526b5477`.
- [Immutable real catalog](https://raw.githubusercontent.com/blueworkslabs/construct/2056d876c4efd8e087581532b61fc22cd144ba7c/catalog/candidates/sky-watch-040/index.json).
- [Synthetic update/Follow catalog](https://raw.githubusercontent.com/blueworkslabs/construct/2056d876c4efd8e087581532b61fc22cd144ba7c/catalog/candidates/sky-follow-040/index.json).

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

## Android acceptance

Pending: native denial/grant; north/east and rotated gestures; raised/high/rolled
pointing; landscape and 200% text; Off, menu, focus-loss and revoke/restart listener
checks; actual live providers and metadata; location, offline, and signed update/
rollback checks. Only the final exact-run receipt will count as acceptance.
Original Android captures require visual inspection. Teardown is checked
independently from the runner's stopped flag.

[Physical-phone checklist](sky-watch-0.4.0-hardware-check.md).
