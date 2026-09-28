# Space Watch 0.2.14 staging

Status: **review complete; exact signed candidate passed 16/16 Android checks.**
Ready for physical-device checks. No merge or production promotion; production
stays 0.1.6 until the hardware handoff is accepted.

The shared grazing-aware next-rise search fixes the 00:42 SL-14 reproduction.
Review additionally refines the final lookup interval and clips coarse samples
to the requested rise window; its regression fails before and passes after.
Eighteen core test groups pass. The fixture lookup cost is 18,619 propagations
versus 99,483 for the plain 5-second reference. This is propagation-count evidence,
not a universal Android latency guarantee. The author's larger +8% benchmark
is attributed separately, not claimed as independently repeated.

Exact signed artifacts, Android receipt and original captures are recorded
below. Earlier [0.2.12 evidence](space-watch-0.2.12-staging.md)
belongs to different module bytes and is not acceptance of this version.

## Reviewed artifacts and scope

Module-only on API 0.9, with unchanged capabilities/origins. No new host APK.

- Module source: `22d44f4`, including author fix `6569018`.
- Signed package / runner commit: `01825b7e694b0945b535d794b3f83d19d8a3c05e`.
- Real module SHA-256: `a6654fe67444d1fdcf84fcc0d246c246213295915fa0a653c90198cb4832f425`.
- Synthetic fixture SHA-256: `779b48cfd61a1fd5dfa042d2ce9dbc932e1f02f8fc7e9fcf33dcff3fc88a9a61`.
- Host source: `e1318303cbb64e43360a2807b81c3beebb5806c6`.
- Host APK SHA-256: `990f178d0516f4d0797b98d12c62da3813d665087e725a464ec7300851b65dbc`.

Served hashes and publisher signatures verified over HTTPS before the run.
Native install diagnostics independently check installed module digests.
[Catalog and pending phone checklist](space-watch-0.2.14-hardware-check.md).

## Checks and limitations

Eighteen orbit/data groups, actual-controller regressions, real-browser DOM and
canvas checks, 34 Python/package tests and architecture ratchet pass. The
next-rise/planner cross-path regression agrees within 2 seconds; the final-window
regression proves a graze inside the window is found and one outside is excluded.
Current-pass skipping and fixture-wide 5-second-reference equivalence pass.
Counters now include look propagations inside SpaceOrbit's shared peak search.

The Android runner is intended to exercise 16 scenarios: signed fixture dome,
pass list, merged train preview/details/Wikipedia, native pause/Back to now,
pointing, live same-launch lookup, red/rewind, process restart, canvas selection,
landscape, 200% text, native resume, real location/HTTP denial, automatic live
loading after grants without Refresh, and Wi-Fi/mobile-data-off cache reopen.
The grazing boundary itself is exercised by the code regressions, not claimed
as an Android sky observation.

Synthetic location/orbits bypass their native gates intentionally; real-module
checks separately exercise grants and actual providers. Screenshots must come
from this exact signed version. Physical spotting, brightness/weather and
orientation/compass alignment remain untested; follow mode is not included.
Earlier complete and partial runs stay tied to their own bytes.

## Android result

Run `20260928T143338Z-space-7db34c99`: **16/16**, `complete=true`,
`stopped=true`. Runner service exited 0; runner and emulator services were
independently confirmed inactive. [Exact-package receipt](evidence/space-watch-0.2.14-staging-2026-09-28.json).
Native grants triggered automatic live CelesTrak loading without a Refresh tap.
The real module then reopened with Wi-Fi and mobile data disabled. Both captures
show Now; live had 0 visible / 14 above and the later offline view 0 visible / 15
above. These are different instants, not an equal-time cache comparison.
Provider elements were 11 h old.

Original Android captures: [pass list](images/space-watch-0.2.14/space-plan.png),
[train preview](images/space-watch-0.2.14/space-train-preview.png),
[Details](images/space-watch-0.2.14/space-train-details.png),
[Wikipedia credit](images/space-watch-0.2.14/space-train-wikipedia.png),
[landscape](images/space-watch-0.2.14/space-landscape.png),
[200% text](images/space-watch-0.2.14/space-large-text.png),
[live data](images/space-watch-0.2.14/space-real-network.png), and
[offline reopen](images/space-watch-0.2.14/space-real-offline-cache.png).
All 19 original PNGs have SHA-256 digests in the receipt. Landscape retains its
original capture orientation; rotate for viewing. The crash buffer contains an
emulator Bluetooth startup abort, not a Construct fatal exception; it is not
claimed to be globally empty.

All confirmed code findings are resolved. A stale docs exclusion claiming that
pass planning was absent is corrected without changing tested module bytes.
Broader GitHub source-and-android CI was still pending when evidence was
finalized; this module-only handoff does not claim that CI was green.
