# Space Watch 0.2.4 staging

Status: **hardware clearance held for a confirmed planner accuracy issue.**
Exact-package Android run stopped at **14/16**, with `complete=false` and
`stopped=true`. The emulator service was independently confirmed inactive.
PR stays open. Production Space Watch 0.1.6 is unchanged.

## Open planner finding

The 60-second rise scan skips a grazing visible pass between its samples. The
repository's captured NORAD 16792 (`SL-14 R/B`) at a **synthetic** observer
49.5°N, 13.4°E, altitude zero has a 5-second-sampled visible interval on
2026-09-29 from 00:42:20 to 00:42:35 UTC, with maximum elevation 10.0124°.
Starting the 12-hour planner at 2026-09-28T17:50:40Z misses it at the current
60-second cadence; `SpacePlan.passes(..., 5000)` finds it.

See the [numeric reproduction](evidence/space-watch-grazing-pass-2026-09-28.json)
and [review discussion](https://github.com/blueworkslabs/construct/pull/49#issuecomment-5867869561).
A separate desktop probe over 24 objects measured approximately 138 ms at 60-second
cadence and 532 ms at 5-second cadence; this is not an Android benchmark. The
recommended follow-up is adaptive peak/rise refinement with a regression and
responsiveness evidence. It has been handed back to the feature author for the
accuracy/performance decision. Android UI checks cannot establish completeness
of the pass predictor. Do not treat their pass count as release approval.

## Artifacts and boundary

Module-only on API 0.9, with the existing origins and capabilities. No host change
or new APK. The unchanged alpha34 staging host source is
`e1318303cbb64e43360a2807b81c3beebb5806c6`, x86 APK SHA-256
`990f178d0516f4d0797b98d12c62da3813d665087e725a464ec7300851b65dbc`.

Module source `e9dbb9a`; signed package/runner commit
`f9f6753992b90383ff8bf8cf76d44b7d45dbb744`.

- Space Watch: `abc81b10103b749eb77c7398d1c139b9d428eb09272ebe941f4c2560760615ce`.
- Synthetic Space Watch: `50d9458172c1c62d3d639878bd340d026721d44ff8d9660b41ec4adf235b1231`.

Served package hashes and publisher signatures were checked over HTTPS. The
runner separately checks the APK hash and native installed package digests.
The [phone checklist](space-watch-0.2.4-hardware-check.md) contains the immutable
catalog; install **Space Watch**, not Synthetic Space Watch, on a real phone.

## Review fixes and local checks

- Retain complete qualifying source batches in cache: the Guowang group stays
  **9 of 11** across a process restart instead of changing to 9 of 9.
- Require usable launch designators and reject wholly or partially malformed
  recent-orbit/SATCAT responses before
  replacing a working snapshot; preserve prior data and apply provider backoff.
- Persist genuinely empty recent snapshots as fresh, avoiding repeat downloads.
- Keep short previews inside their visible interval; distinguish an already
  visible pass and a clipped planning-window end from an actual rise/set.
- Clear the pass button's pressed state immediately on Back to now or rewind.
- Switch upcoming passes to Now at their actual start, not at the next minute;
  refresh the planner progress indicator after each calculation batch.
- Exclude train members with elements more than 72 hours from the current time;
  re-evaluate grouping each minute. This conservative review policy was surfaced
  for discussion. The fixture's shared Starlink elements are eight days old and
  now serve as exclusion data; Guowang remains the qualifying train (9 of 11).
  Fresh Starlink/Qianfan/Guowang/Kuiper/OneWeb batches remain supported.

The source regression checks include failing-before/passing-after cases for cache
identity, malformed data, stale elements and pressed-state clearing. Fourteen
orbit/data test groups (including the Heavens-Above ISS reference), the actual
controller suite, 34 Python/package tests, 75 runner-unit tests, real-DOM browser
checks and the architecture ratchet passed. The browser checks are additional,
not a substitute for Android acceptance. The DOM checks exercise both Back to now
and rewind selection state, responsive train screens and dialogs.

## Android coverage

The extended standalone runner has 16 checks: signed fixture dome/list; visible
pass list; future train preview and explicit real Wikipedia; preview pause/resume
and Back to now; original stage pointing; real same-launch/Wikipedia; red/rewind;
red persistence; actual canvas selection; landscape cached-train identity;
200% text; native menu resume; real location denial; real HTTP denial; automatic
live CelesTrak loading after native grants; and fully offline process reopen.

The fixture intentionally supplies its own location/orbits. Only the separate
real-module checks establish native permission behavior and live/offline data.
Latest run: `20260928T100229Z-space-f1f5ce4d`, Android API 37, WebView 155.
The first 14 checks passed, through the real-module permission-denial checks.
The live-data status did not become reachable within the driver bound; the final
UI still showed **Downloading orbit data from CelesTrak…**, zero overhead objects,
and **Now**. Offline reopen was not reached. This does not identify whether the
remaining wait was provider latency or a driver timing issue; neither check is
waived. See the [explicitly incomplete receipt](evidence/space-watch-0.2.4-staging-2026-09-28.json)
and [last screen](images/space-watch-0.2.4/failure.png).

No earlier version's live/offline success is substituted for these missing checks.
At publication, Pages passed and the broader GitHub source-and-Android builds were
still pending. No claim of complete CI or release readiness. The retained crash buffer has a
Bluetooth emulator-service abort during startup; no Construct fatal exception was
found in that buffer or the runtime log.

## Original Android captures

These captures are from the incomplete 0.2.4 run above. They are original
emulator-console screenshots, not browser previews or edited mockups. Portrait
preview captures are scrolled to the pointing card, so the dome can be partially
outside the viewport; landscape and enlarged-text dome captures require the complete
square canvas. The landscape PNG retains the emulator's native rotated orientation.
Wikipedia captures are scrolled to the actual article credit. Details are explicitly
labelled RIGHT NOW even when opened from a future preview; the spot card instead
labels the preview time.

- [Visible-pass list](images/space-watch-0.2.4/space-plan.png)
- [Future train preview](images/space-watch-0.2.4/space-train-preview.png),
  [train details](images/space-watch-0.2.4/space-train-details.png),
  [Wikipedia with visible attribution](images/space-watch-0.2.4/space-train-wikipedia.png)
  and [Back to now](images/space-watch-0.2.4/space-train-back-now.png)
- [Dome](images/space-watch-0.2.4/space-dome.png),
  [stage pointing](images/space-watch-0.2.4/space-spot.png),
  [stage Wikipedia](images/space-watch-0.2.4/space-wikipedia.png)
- [Red/rewind](images/space-watch-0.2.4/space-red-rewind.png),
  [red after restart](images/space-watch-0.2.4/space-reopened.png),
  [canvas-selected ISS](images/space-watch-0.2.4/space-canvas-selected.png)
- [Landscape dome](images/space-watch-0.2.4/space-landscape.png),
  [landscape details](images/space-watch-0.2.4/space-landscape-details.png),
  [200% text dome](images/space-watch-0.2.4/space-large-text.png),
  [200% details](images/space-watch-0.2.4/space-large-text-details.png)
- [Real location denied](images/space-watch-0.2.4/space-real-location-denied.png)
  and [real internet denied](images/space-watch-0.2.4/space-real-internet-denied.png)

## Prior complete run

0.2.2 run `20260928T094648Z-space-df2a9c23` completed all 16 checks with
`complete=true`, `stopped=true`, and an independently confirmed inactive emulator.
Its signed bytes and evidence are retained separately. The later launch-ID
validation fix produced new 0.2.4 packages, which require their own acceptance.
No checks or captures from the earlier version are combined with the final run.

## Earlier incomplete runs

These are retained separately, not combined into acceptance:

- 0.2.0 `20260928T092931Z-space-d3d2794e`: 3 checks, native-return timing race
  in the driver. Bounded wait added; emulator stopped cleanly.
- 0.2.0 `20260928T093510Z-space-1e89e6ed`: 10 checks, driver scrolled a
  top-clipped canvas the wrong way during enlarged-text capture. Capture now
  scans down from above the canvas; emulator stopped cleanly.
- 0.2.1 `20260928T094401Z-space-4e285c91`: intentionally interrupted when
  the late pressed-state finding required new signed bytes. Runner termination
  did not complete its normal receipt teardown; the owned emulator service was
  explicitly stopped and independently confirmed inactive before the next run.

- 0.2.3 `20260928T095652Z-space-74357e0d`: 5 checks, then real CelesTrak
  same-launch lookup returned the unavailable UI instead of companion data.
  This external-provider failure was not waived; the emulator stopped cleanly.

## Limits

"Visible" means geometric sunlight/dark-sky/elevation conditions, not guaranteed
naked-eye brightness or weather. Train grouping uses uncertain early elements;
a cluster estimate cannot establish actual spacing or a visible line of lights.
Physical spotting accuracy and other phone models still need hardware testing.
Follow/orientation mode is not included. No merge or production promotion.
