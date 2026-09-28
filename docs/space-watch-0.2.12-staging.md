# Space Watch 0.2.12 staging

Status: **16/16 Android checks passed; hardware handoff held for next-rise accuracy.** No hardware clearance,
merge or production promotion yet. Production remains 0.1.6.

## Remaining blocker

The planner's adaptive grazing-pass fix does not cover the legacy next-rise
lookup. `SpaceOrbit.nextPass` still samples every 30 seconds, and is used by
ordinary-object Details/spot cards and the grouped member search.

Reproduction: bundled NORAD 16792, synthetic observer 49.5°N, 13.4°E, 40 m,
lookup start 2026-09-29 00:39:10 UTC. The lookup returns **02:16:35**; adaptive
`SpacePlan.passes` finds **00:42:18.834–00:42:34.834**, peak **10.011864°**.
The fixture object is a rocket body, not asserted to be a qualifying train;
the underlying next-rise helper is shared by both paths.

The feature author has been asked to apply grazing-aware next-rise detection,
preserving the above-10°/36-hour semantics, daylight/shadow classification,
current-pass behavior and per-member work yields/cancellation. Cross-path
regression and propagation/responsiveness evidence are required. Existing
Android scenarios do not exercise this grazing lookup and cannot clear it.

## Artifacts

Module-only on API 0.9; unchanged origins/capabilities and alpha34 host APK.
Module source `fdb1c2c`; author member-planning fix `fb5e87e`.
Signed package and runner commit `a5201ef2f88964e84ce042de24658b1dbd301a09`.

- Real module SHA-256: `593f15d0c6e47161060951e424763e9b014e628b7306831cae5297679c1ec004`.
- Synthetic fixture SHA-256: `fc5b4d8c7a798851fdff73540b7e002561f28974f3f4ae2ee8cea908cca2d86d`.
- Host APK SHA-256: `990f178d0516f4d0797b98d12c62da3813d665087e725a464ec7300851b65dbc`.
- Host source: `e1318303cbb64e43360a2807b81c3beebb5806c6`.

Served hashes and publisher signatures verified over HTTPS before the run.
Native installation diagnostics check installed module digests separately.
[Immutable catalog and phone checklist](space-watch-0.2.12-hardware-check.md).

## Review

The earlier train-planner blocker is fixed. Each distinct member element set
has its own queue entry; member intervals merge by earliest start/latest end
and highest peak. Shared-element batches are planned once. The Berlin fixture
at 18:24 UTC now reads **Now · Guowang train**, starting around 18:23:55 rather
than the centre's 18:26:50. The controller regression passes.

Each member remains one object's scan, and a propagation-count regression bounds
fixture-member work to 1.2 times the centre. That preserves the existing yield
granularity; the approximately 15 ms target is not a hard per-object deadline.
It is not a universal Android timing guarantee.

Five small review fixes are included in 0.2.12:

- Only overlapping or touching visible intervals merge. A real 50-second dark
  gap stays separate, so a preview cannot land in the gap. The old one-minute
  merge allowance failed the new regression.
- Selection is keyed by both object and pass start. Two passes of one object
  no longer both announce pressed; Back to now and rewind clear the selection.
- Every rendered train bead is a canvas hit target mapped to the train ID.
  A real-browser canvas test taps a bead outside the representative's hit radius.

The regressions fail before and pass after their fixes. Seventeen
orbit/data groups, actual-controller checks, 34 Python/package tests,
real-browser DOM/canvas checks and architecture ratchet pass. Prior grazing,
range-edge, twilight, stale-train, cache and provider-data regressions remain.
The 72-hour train freshness filter is unchanged.

- Train details search all distinct members for the next rise, one scan per
  event-loop turn. Closing, replacing or pausing the dialog discards unfinished
  work. The 16:50 fixture finds member 100800 at 18:20 rather than the
  representative at 18:28. The label explicitly says Next member above you,
  not a merged-pass peak or duration.

- The below-horizon train card shares that same all-member lookup. Results are
  cached briefly for the same membership/place and discarded after selection or
  lifecycle changes. Its old 18:28 estimate now agrees with the 18:20 member rise
  in the 16:50 fixture. Train cards omit a single-member fade countdown; merged
  group endings remain in the planner.

## Android scope and limitations

The acceptance runner is intended to exercise 16 scenarios: dome and pass list,
future train preview/details/Wikipedia, preview/native-menu resume, Back to now,
pointing, real same-launch lookup, red/rewind, process restart, canvas selection,
landscape, 200% text, native menu resume, real native denial/grant gates,
automatic live CelesTrak loading without Refresh, and offline reopen.

Synthetic location/orbits intentionally bypass those native capabilities;
real-module checks separately establish native gates and actual provider access.
Desktop controller/browser checks do not substitute for Android screenshots.
No physical-device spotting, brightness, weather or compass alignment is tested.
Follow/orientation is not included; no new APK is required.

[0.2.8 evidence](space-watch-0.2.8-staging.md) remains a separate 16/16 run on
older bytes, with its now-fixed train-planner blocker recorded honestly.

The [0.2.10 run](space-watch-0.2.10-staging.md) stopped cleanly at 12/16 on a
native-menu transition race. Its real-module checks were not reached. The
runner now waits for Mark working before tapping it; native assertions remain.

The [0.2.11 run](space-watch-0.2.11-staging.md) passed 16/16 and stopped
cleanly before the final grouped-card correction. Its evidence stays separate.

## Android result

Run `20260928T123528Z-space-e4655982` completed all 16 checks.
[Exact-package receipt](evidence/space-watch-0.2.12-staging-2026-09-28.json):
`complete=true`, `stopped=true`. Runner service exited 0; runner and emulator
services independently confirmed inactive. The real module loaded live
CelesTrak data automatically after grants without a Refresh tap, then reopened
with Wi-Fi and mobile data disabled. Both captures show Now, 0 visible / 10 above;
provider elements were 9 h old. No physical spotting claim follows from this.

Original Android captures: [pass list](images/space-watch-0.2.12/space-plan.png),
[18:24 train preview](images/space-watch-0.2.12/space-train-preview.png),
[member lookup](images/space-watch-0.2.12/space-train-details.png),
[Wikipedia credit](images/space-watch-0.2.12/space-train-wikipedia.png),
[landscape](images/space-watch-0.2.12/space-landscape.png),
[200% text](images/space-watch-0.2.12/space-large-text.png),
[live data](images/space-watch-0.2.12/space-real-network.png), and
[offline reopen](images/space-watch-0.2.12/space-real-offline-cache.png).
All 19 original captures have SHA-256 digests in the receipt. Landscape keeps
the original capture orientation; rotate for viewing. The crash buffer contains
an emulator Bluetooth startup abort, not a Construct fatal exception; it is not
claimed to be globally empty.

The remaining next-rise blocker is outside those 16 scenarios. No hardware
clearance, merge or production promotion. Broader GitHub source-and-android CI
was still pending when this evidence was finalized.
