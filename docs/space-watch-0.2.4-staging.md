# Space Watch 0.2.4 staging

Status: **exact-package Android acceptance in progress; not yet a hardware handoff.**
PR stays open. Production Space Watch 0.1.6 is unchanged.

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
All evidence must come from one complete run of the exact package identified above.

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
