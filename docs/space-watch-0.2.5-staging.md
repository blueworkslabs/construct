# Space Watch 0.2.5 staging

Status: **incomplete: runner stopped before the first check.** The native menu
button remained present but its accessibility bounds did not settle. No tap was
issued by that failed stability wait. The emulator stopped cleanly; a narrowly
scoped fresh-target driver fallback is included with the 0.2.6 rerun. Not cleared
for the phone handoff. The 0.2.4 grazing-pass blocker is corrected; its earlier
incomplete acceptance remains separately recorded. No merge or production change.

## Artifacts

Module-only on API 0.9; unchanged origins and capabilities. No new APK.
Host source `e1318303cbb64e43360a2807b81c3beebb5806c6`, alpha34 x86 APK SHA-256
`990f178d0516f4d0797b98d12c62da3813d665087e725a464ec7300851b65dbc`.

Reviewed module source `1d5e5bb`, including the author's `a2f7c30` refinement.
Signed package and runner commit `6df9483761b95b1aab2b14cdcf2c2cb083fcf05b`.

- Space Watch: `7fd83f71dea5a742e042be1ef66d1bd2fba6dbece4fe9b419b19a0f29158427a`.
- Synthetic Space Watch: `916bd9e23d9fedf667b8f6963c6bb8a7ba5ae74f456614836c52b94b9c43f919`.

The served hashes and publisher signatures were verified over HTTPS before the
run. Native installation diagnostics independently check installed digests.
[Immutable catalog and phone checklist](space-watch-0.2.5-hardware-check.md).

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

Each of the three additional review regressions fails on the pre-fix code and
passes afterward. Fifteen orbit/data test groups, the actual-controller suite,
34 Python/package tests, real-DOM browser checks and architecture ratchet pass.
The fixture equivalence/cost regression covers 24 objects at three places.
The [separate propagation-count measurement](evidence/space-watch-0.2.5-propagation-check.json)
uses the plain old 60-second/5-second algorithms as comparisons, not wall-clock
or Android performance claims. The author's 156-object/eight-place benchmark
remains attributed in the module documentation, not claimed as independently
repeated here. Sampling comparisons do not prove completeness for every orbit.

## Android scope

New run `20260928T102900Z-space-df952097`, using the signed bytes above. The
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
for acceptance of 0.2.5. No checks or captures are combined across versions.
