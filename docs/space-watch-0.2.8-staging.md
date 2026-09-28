# Space Watch 0.2.8 staging

Status: **fresh exact-package Android acceptance in progress.** No hardware
clearance, merge or production promotion yet.

## Artifacts

Module-only on API 0.9; unchanged origins and capabilities. No new APK.
Host source `e1318303cbb64e43360a2807b81c3beebb5806c6`, alpha34 x86 APK SHA-256
`990f178d0516f4d0797b98d12c62da3813d665087e725a464ec7300851b65dbc`.

Reviewed module source `ef679fe`, including the author's `a2f7c30` refinement.
Signed package and runner commit `b334f14ccd20da82931f963fd4c105f99774a665`.

- Space Watch: `720cb7182dbd18db70faeb1b5bf95acb29cf84580ff789e08a72d5975c2c72f2`.
- Synthetic Space Watch: `9f10ff26443bdf4869a034d1f5b73c9fbe1c577870e64687ca91b9c49f7859e8`.

The served hashes and publisher signatures were verified over HTTPS before the
run. Native installation diagnostics independently check installed digests.
[Immutable catalog and phone checklist](space-watch-0.2.8-hardware-check.md).

## Review and regressions

- Adaptive peak refinement finds the captured SL-14 grazing pass without making
  the full scan finer. Added first/last-interval checks and deduplication: the
  same pass was otherwise still missed near a planning-range edge.
- A 30-minute calculation buffer preserves the full rolling 12-hour displayed
  horizon between refreshes; later passes enter the list only when within 12 h.
- Train beads are emitted only for individually visible members, not styled as
  visible merely because the representative is visible.
- The 72-hour train-element freshness filter is explicitly agreed with the
  feature author. Stale shared Starlink data remains negative coverage.

- Recent-launch orbit and SATCAT feeds are processed in full before grouping.
  A >400-row regression ensures unrelated prefix rows cannot hide a later train
  or its launch date. The host response-byte bound and storage quota remain.

- Short solar darkness between ten-minute samples is detected by minimum
  refinement, including interval edges. Real regression: 60.03°N, 0°E,
  2026-06-25/26, dark from approximately 23:59:24 to 00:06:15 UTC.
- Known immutable launch dates survive a temporarily missing batch or date
  in the fresh recent SATCAT response; complete orbit updates still apply.

- The grouped train uses an individually visible member for current/preview
  state and pointing, or its highest member if none is visible. The real fixture
  at 18:24 UTC covers a visible member while the original centre remains low.
  Wikipedia identity remains tied to the train if its representative changes.

Each of the seven additional review regressions fails on the pre-fix code and
passes afterward. Sixteen orbit/data test groups, the actual-controller suite,
34 Python/package tests, real-DOM browser checks and architecture ratchet pass.
The fixture equivalence/cost regression covers 24 objects at three places.
The [separate propagation-count measurement](evidence/space-watch-0.2.5-propagation-check.json)
uses the plain old 60-second/5-second algorithms as comparisons, not wall-clock
or Android performance claims. The author's 156-object/eight-place benchmark
remains attributed in the module documentation, not claimed as independently
repeated here. Sampling comparisons do not prove completeness for every orbit.

## Android scope

New run `20260928T110237Z-space-b65de3d4`, using the signed bytes above. The
16-check runner covers the planner and future train preview, Back to now,
lookup/Wikipedia, red/rewind, process restart, canvas selection, landscape and
200% text, native menu resume, real denial gates, automatic live CelesTrak
loading after grants, and fully offline reopen.

The driver now explicitly waits up to 90 seconds for initial live data after
native grant return, without tapping Refresh or accepting a downloading state.
The earlier driver could exhaust its scrolling search before that asynchronous
reply. This is a wait correction, not a waiver of real network or offline checks.
Synthetic location/orbit answers exercise UI only; real-module checks are separate.

## Limits and prior evidence

No physical-phone spotting accuracy or follow/orientation capability is tested.
“Visible” means geometric light/darkness/elevation conditions, not a guarantee of
brightness or weather. Train estimates depend on uncertain early orbit data.

The [0.2.4 report](space-watch-0.2.4-staging.md) records the old predictor finding
and its incomplete 14/16 run. The earlier 0.2.2 complete run is not substituted
for acceptance of 0.2.8. No checks or captures are combined across versions.

The [0.2.5 attempt](space-watch-0.2.5-staging.md) stopped on a native-menu
stability wait before checks. The new driver may resolve and tap the verified
native button at fresh bounds after that specific no-click failure; subsequent
native-menu assertions still establish navigation. This is not a generic retry
of a missing module control.


The [0.2.6 run](space-watch-0.2.6-staging.md) passed all 16 checks, including
automatic live data and offline reopen, and stopped cleanly. Its receipt and
screenshots are retained separately, not substituted for this version.


The [0.2.7 run](space-watch-0.2.7-staging.md) also passed all 16 Android checks
and stopped cleanly, before the late train-state fix. No results are substituted
for this new version.
