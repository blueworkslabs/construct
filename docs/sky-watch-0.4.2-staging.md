# Sky Watch 0.4.2 Follow staging

Status: **24/24 Android acceptance passed in one uninterrupted exact-package run.
Ready for physical-phone checks; not a release or physical alignment claim.**
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

## Android acceptance — 24/24

Run **`20260930T195552Z-73aabea2`**, 19:55:52–20:23:20 UTC on
30 September 2026, completed all 24 gates without interruption or manual rescue.
The signed 0.4.2 and alpha37 bytes are unchanged from the earlier attempts.

[Exact-artifact receipt, check names and original-image hashes](evidence/sky-watch-0.4.2-acceptance-2026-09-30.json).

- All seven new native Follow gates: denial; north/east and rotated pinch;
  raised/high/rolled guidance; landscape and 200% text; Off/menu lifecycle;
  Quick Settings with explicit restart; revocation and process restart.
- Signed synthetic update/rollback, on the same checksummed APK.
- Native Internet denial/grant; manual coordinates; live ADSB.lol, OpenSky and
  Combined; real two-pointer map pinch; explicit attributed ADSBdb lookup.
- Map/details layouts and menu resume; separate module/Android location denial;
  granted-location auto-start with live loading; preference persistence; direct
  “Use my location”; background exit discarding the previous area; startup choice.
- Visible offline transport error without a crash; revoked Internet remaining
  denied after reopen while location auto-start still works.

The successful post-location live fetch is part of **this run**, not borrowed
from a previous attempt. Offline coverage verifies the visible failure state,
not an offline aircraft cache or successful offline downloads.

Independent teardown: emulator service inactive, main PID 0, result success,
exit status 0; no emulator process remained. The suite recorded zero attached-
WebView destroy warnings. Its crash buffer contains a guest Bluetooth-service
abort, not a Construct crash.

## Inspected native evidence

All **40 original emulator-console PNGs from the accepted run** are retained
unchanged with SHA-256 hashes in its receipt. These are Android captures, not
browser previews. Landscape PNGs retain the console's original orientation.

Inspected captures show the full high-angle viewfinder and its aircraft label,
landscape/200% guidance, readable Combined/100 km toolbar, live restored
preferences, attributed metadata, and the explicit offline error.

ADSBdb returned a record for D-AIJM (Airbus A320-271N), registry owner Lufthansa
Cityline and callsign airline City Airlines (LHX). The UI correctly displayed
“Database identity differs from the live feed. Records may be outdated.” These
fields and the warning are evidence of attributed lookup, not independent
verification of the aircraft's present owner or operator.

- [High-angle native pointing](images/sky-watch-0.4.2-staging/attempt6/android-sky-point-high.png)
- [Landscape pointing instruction](images/sky-watch-0.4.2-staging/attempt6/android-sky-point-landscape-guidance.png)
- [200% pointing instruction](images/sky-watch-0.4.2-staging/attempt6/android-sky-point-large-text-guidance.png)
- [200% Combined/100 km toolbar](images/sky-watch-0.4.2-staging/attempt6/android-modular-map-font2.png)
- [Live ADSBdb fields, mismatch warning and attribution](images/sky-watch-0.4.2-staging/attempt6/android-modular-metadata-portrait-fields.png)
- [Live data and restored preferences](images/sky-watch-0.4.2-staging/attempt6/android-modular-preferences-restored.png)
- [Offline error](images/sky-watch-0.4.2-staging/attempt6/android-modular-offline.png)

Native listener counts: denial 0; watching 1; Off 0; menu pause 0; menu return 1;
Quick Settings/focus return/still-off 0; explicit restart 1; revoked 0;
fresh process 0. Virtual compass uncertainty is not a physical heading-accuracy
measurement. Sensor and location injection do not replace phone alignment,
calibration or TalkBack testing.

[Install catalog and physical-phone checklist](sky-watch-0.4.2-hardware-check.md).

## Prior attempts — retained, not pooled

[Separate incomplete receipts and 57 original-image hashes](evidence/sky-watch-0.4.2-staging-2026-09-30.json)
remain unchanged:

- `20260930T190849Z-b3f3afd7`: **17/24**, 19:08:49–19:31:21 UTC.
  At granted-location auto-start, OpenSky loaded but ADSB.lol returned
  “Request unavailable or cancelled”; later checks were not completed.
- `20260930T193245Z-aa9dedbd`: **9/24**, 19:32:45–19:49:17 UTC.
  Initial live ADSB.lol loading failed with the same message. Later real-module
  checks were not reached.

Both stopped cleanly. Their source/provider failure evidence is not erased by
the later successful run. The generic host error does not establish whether
transport failure or cancellation caused either stop; that ambiguity is a
separate host follow-up. Earlier 0.4.0/0.4.1 attempts also remain separate and do
not contribute checks to 0.4.2 acceptance.
