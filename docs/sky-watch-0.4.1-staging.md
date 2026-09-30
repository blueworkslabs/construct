# Sky Watch 0.4.1 Follow staging

Status: **fresh Android acceptance pending; not yet cleared for hardware.**
No merge, release or production-catalog promotion is included.

## Exact candidate

- Author head: `82edf00`; reviewed and signed candidate: `ca4d431`.
- Real module SHA-256: `f61c39dc9ed93f11f43e7343779991d8c39a7c4138009c69a6d55aa8c6ae7c70`.
- Unchanged alpha37 x86_64 APK SHA-256: `23cd4b27f95fbc0124fbb6cf69af4d80a6cc8534c58e2235b95e24f4526b5477`.
- [Immutable real catalog](https://raw.githubusercontent.com/blueworkslabs/construct/ca4d431dd4bf318d6f6258a926f927df5d1ad174/catalog/candidates/sky-watch-041/index.json).
- [Synthetic update/Follow catalog](https://raw.githubusercontent.com/blueworkslabs/construct/ca4d431dd4bf318d6f6258a926f927df5d1ad174/catalog/candidates/sky-follow-041/index.json).

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

## Android acceptance

Pending: native denial/grant; north/east and rotated gestures; raised/high/rolled
pointing; landscape and 200% text; Off, menu, focus-loss and revoke/restart listener
checks; actual live providers and metadata; location, offline, and signed update/
rollback checks. Only the final exact-run receipt will count as acceptance.
Original Android captures require visual inspection. Teardown is checked
independently from the runner's stopped flag.

[Physical-phone checklist](sky-watch-0.4.1-hardware-check.md).
