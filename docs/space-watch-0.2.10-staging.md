# Space Watch 0.2.10 staging

Status: **incomplete: 12/16 checks passed; stopped cleanly.** No hardware clearance,
merge or production promotion yet. Production remains 0.1.6.

## Artifacts

Module-only on API 0.9; unchanged origins/capabilities and alpha34 host APK.
Module source `9c01e41`; author member-planning fix `fb5e87e`.
Signed package and runner commit `0941dae45310d5d8805464223e3bccb325fdfbd2`.

- Real module SHA-256: `5223d446b04fce537acd403d0ef0555553ee2b24d71cdb610a8083c214b9375e`.
- Synthetic fixture SHA-256: `941db0d91226d71b0c7bf589b371251d2cd187e8ae9571ec69cd7549a24c214f`.
- Host APK SHA-256: `990f178d0516f4d0797b98d12c62da3813d665087e725a464ec7300851b65dbc`.
- Host source: `e1318303cbb64e43360a2807b81c3beebb5806c6`.

Served hashes and publisher signatures verified over HTTPS before the run.
Native installation diagnostics check installed module digests separately.
[Immutable catalog and phone checklist](space-watch-0.2.10-hardware-check.md).

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

Three small review fixes are included in 0.2.10:

- Only overlapping or touching visible intervals merge. A real 50-second dark
  gap stays separate, so a preview cannot land in the gap. The old one-minute
  merge allowance failed the new regression.
- Selection is keyed by both object and pass start. Two passes of one object
  no longer both announce pressed; Back to now and rewind clear the selection.
- Every rendered train bead is a canvas hit target mapped to the train ID.
  A real-browser canvas test taps a bead outside the representative's hit radius.

All three regressions fail before and pass after their fixes. Seventeen
orbit/data groups, actual-controller checks, 34 Python/package tests,
real-browser DOM/canvas checks and architecture ratchet pass. Prior grazing,
range-edge, twilight, stale-train, cache and provider-data regressions remain.
The 72-hour train freshness filter is unchanged.

## Android scope and limitations

The runner was intended to cover 16 scenarios: dome and pass list,
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

## Result

Run `20260928T121132Z-space-1c27eaf4` stopped after the 12 synthetic checks.
The native transition to Mark working failed with `UI label not found: Construct menu`;
the failure capture shows the native menu and Mark working present. The runner
was corrected to wait explicitly for Mark working before tapping, avoiding a
second menu navigation during its enter transition. Real-module denial, live
and offline checks were **not reached**. Emulator is inactive.

[Partial receipt](evidence/space-watch-0.2.10-staging-2026-09-28.json),
[18:24 train preview](images/space-watch-0.2.10/space-train-preview.png),
[landscape](images/space-watch-0.2.10/space-landscape.png),
[200% text](images/space-watch-0.2.10/space-large-text.png),
[failure screen](images/space-watch-0.2.10/failure.png).
A late review also found the Details next-pass lookup still used one train
representative. Both follow-ups are covered in the separate 0.2.11 candidate.
