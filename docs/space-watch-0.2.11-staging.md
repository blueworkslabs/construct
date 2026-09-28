# Space Watch 0.2.11 staging

Status: **exact-package Android acceptance in progress.** No hardware clearance,
merge or production promotion yet. Production remains 0.1.6.

## Artifacts

Module-only on API 0.9; unchanged origins/capabilities and alpha34 host APK.
Module source `dc19a3d`; author member-planning fix `fb5e87e`.
Signed package and runner commit `aac4a43f3a9a96b258359f495028d8008da5f2d7`.

- Real module SHA-256: `8169bb09e92f17669b35070cbbb2f3729c31f31c27d3108f002f6e66064e2713`.
- Synthetic fixture SHA-256: `319b05cd21b4bcaee6a2f096d608582832c18ab2c2dd816ac0cef4da97377db2`.
- Host APK SHA-256: `990f178d0516f4d0797b98d12c62da3813d665087e725a464ec7300851b65dbc`.
- Host source: `e1318303cbb64e43360a2807b81c3beebb5806c6`.

Served hashes and publisher signatures verified over HTTPS before the run.
Native installation diagnostics check installed module digests separately.
[Immutable catalog and phone checklist](space-watch-0.2.11-hardware-check.md).

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

Four small review fixes are included in 0.2.11:

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
