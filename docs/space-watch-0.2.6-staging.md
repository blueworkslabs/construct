# Space Watch 0.2.6 staging

Status: **16/16 exact-package Android checks passed; superseded by 0.2.7.**
`complete=true`, `stopped=true`; emulator independently inactive. Two late review
findings (brief solar darkness and missing launch-date coverage) are corrected in
0.2.7, which needs its own acceptance. No merge or production change.

## Artifacts

Module-only on API 0.9; unchanged origins and capabilities. No new APK.
Host source `e1318303cbb64e43360a2807b81c3beebb5806c6`, alpha34 x86 APK SHA-256
`990f178d0516f4d0797b98d12c62da3813d665087e725a464ec7300851b65dbc`.

Reviewed module source `69e0635`, including the author's `a2f7c30` refinement.
Signed package and runner commit `83c12aaf493e61a21ba65298f3e11004654b9400`.

- Space Watch: `6fffa17e085d40903eab7c780c7db730e5725f83f395ee8a66fd09780be53955`.
- Synthetic Space Watch: `2d34af57c1495ceb393fbace2997b0953963b5dc90f0f32296525a8200b6b776`.

The served hashes and publisher signatures were verified over HTTPS before the
run. Native installation diagnostics independently check installed digests.
[Immutable catalog and phone checklist](space-watch-0.2.6-hardware-check.md).

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

Each of the four additional review regressions fails on the pre-fix code and
passes afterward. Fifteen orbit/data test groups, the actual-controller suite,
34 Python/package tests, real-DOM browser checks and architecture ratchet pass.
The fixture equivalence/cost regression covers 24 objects at three places.
The [separate propagation-count measurement](evidence/space-watch-0.2.5-propagation-check.json)
uses the plain old 60-second/5-second algorithms as comparisons, not wall-clock
or Android performance claims. The author's 156-object/eight-place benchmark
remains attributed in the module documentation, not claimed as independently
repeated here. Sampling comparisons do not prove completeness for every orbit.

## Android scope

New run `20260928T103452Z-space-0f9e5622`, using the signed bytes above. The
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
for acceptance of 0.2.6. No checks or captures are combined across versions.

The [0.2.5 attempt](space-watch-0.2.5-staging.md) stopped on a native-menu
stability wait before checks. The new driver may resolve and tap the verified
native button at fresh bounds after that specific no-click failure; subsequent
native-menu assertions still establish navigation. This is not a generic retry
of a missing module control.

## Completed exact-version evidence

[Sanitized receipt](evidence/space-watch-0.2.6-staging-2026-09-28.json).
Live CelesTrak loaded automatically after native grants, then fully offline
process reopen used the cache. Live was 0 visible / 12 above; offline was
0 visible / 11 above at a later time. Both captures show Now. Provider status
was Orbit data 32 h old. The retained crash buffer has an emulator Bluetooth
abort, with no Construct fatal exception found in the runtime log or buffer.

[Train preview](images/space-watch-0.2.6/space-train-preview.png),
[Wikipedia credit](images/space-watch-0.2.6/space-train-wikipedia.png),
[landscape](images/space-watch-0.2.6/space-landscape.png),
[200% text](images/space-watch-0.2.6/space-large-text.png),
[live data](images/space-watch-0.2.6/space-real-network.png),
[offline cache](images/space-watch-0.2.6/space-real-offline-cache.png).
Original emulator-console captures, not edited or browser previews. Landscape
retains native rotated orientation. No results are substituted for 0.2.7.
