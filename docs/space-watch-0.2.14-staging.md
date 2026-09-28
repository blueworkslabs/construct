# Space Watch 0.2.14 staging

Status: **signed candidate verified; exact-package Android acceptance in progress.**
No hardware clearance, merge or production promotion. Production stays 0.1.6.

The shared grazing-aware next-rise search fixes the 00:42 SL-14 reproduction.
Review additionally refines the final lookup interval and clips coarse samples
to the requested rise window; its regression fails before and passes after.
Eighteen core test groups pass. The fixture lookup cost is 18,619 propagations
versus 99,483 for the plain 5-second reference. This is propagation-count evidence,
not a universal Android latency guarantee. The author's larger +8% benchmark
is attributed separately, not claimed as independently repeated.

Exact signed artifacts, Android receipt and original captures will be recorded
here once available. Earlier [0.2.12 evidence](space-watch-0.2.12-staging.md)
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
