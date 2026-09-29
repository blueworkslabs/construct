# Space Watch 0.3.4 follow-mode staging

Status: **superseded by 0.3.5; incomplete, 8/23 checks passed.** Not cleared for phone testing.
No merge, APK release or production-catalog change is included.

## Ownership and exact artifacts

Module-only HTML/CSS/JavaScript on the existing alpha37 API 0.14 host. The
module owns WMM2025 magnetic-to-true correction, smoothing, sky rotation and
pointing UI. The host owns consent, bounded sensor access and lifecycle.
Optional `orientation.read` adds native opt-in, with no Android permission or
new network origin. Existing module storage/network privacy boundaries remain.

- Reviewed module source: `128118f` (review foundation `b59b222`, author base `4b604ae`).
- Signed real/fixture packages: `9ecfbf0aca044b0d449709df04f74a0d9a22f9f5`.
- Real module SHA-256: `1ae50cccdbed685744c654bf56e30c4b72d80779e90637df5c0e7f5b89671132`.
- Fixture SHA-256: `e57261f177e626228198f8feb705d0fdaba9bc766cca40168e749049f5a2ae77`.
- Host alpha37 source: `4e7f534`.
- Tested x86_64 APK SHA-256: `23cd4b27f95fbc0124fbb6cf69af4d80a6cc8534c58e2235b95e24f4526b5477`.

Served package hashes and publisher signatures were verified over HTTPS. The
staging host hash matches the earlier [alpha37 acceptance](orientation-alpha37-staging.md).
This is new module acceptance, not a new APK build or a substitute for hardware.

## Review fixes and source checks

- Terminal events invalidate pending watch replies, even before acknowledgement.
  Menu pauses invalidate in-flight replies while preserving menu-return intent.
- Missing headings, upright poses or sample silence suppress stale live pointing.
  A location change resets smoothing. Turning Follow off restores north-up.
- An unavailable true-north correction suspends directional guidance, instead
  of mixing magnetic headings and true sky coordinates.
- High-rate visual compass and turn text is outside live regions. A separate
  deduplicated live status announces discrete lifecycle/calibration changes.

Lifecycle, stale-stream and reference-frame regressions fail on original source
and pass after the fixes. Nineteen orbit/model groups, including all 12 bundled
NOAA WMM2025 values, controller regressions, actual-browser DOM/canvas/layout
checks, 36 Python publisher/package tests, 93 runner-helper tests and the
architecture check pass. Browser accessibility assertions are not a claim of
physical TalkBack testing. Code review/fixes assisted by Codex.

## Menu-return correction

An Android run exposed a focus-transition race: returning from Construct’s menu
can notify the module before the native menu window relinquishes focus. Only
this explicit menu-return path now retries `RUN_PAUSED` at 100 ms intervals for
at most two seconds. A terminal stream event, another pause or Follow off cancels
that retry. Arbitrary failures and Quick Settings never silently restart Follow.
The regression fails before the change and passes afterward, including recovery,
cancellation and the time bound. Upright poses freeze the correctly labelled chart
rotation and suppress live wedge/turn guidance; explicit Follow off restores north-up.

## Android acceptance

Incomplete exact-package run `20260929T003813Z-space-3e3f2154`, 23 required checks.
Follow is exercised immediately after signed installation, including native
compass denial/grant, north/east injection, relative pointing, upright/off,
menu return, Quick Settings, explicit restart, landscape/200% text, revocation
and process restart. The original sky, pass/train/lookup and real location/network,
live-data and offline checks remain required. Native listener transitions use a
bounded three-second wait; the elapsed waits are recorded, not hidden.

The fixture substitutes place and orbit data only, not orientation. Sensor readings
come from the real alpha37 host. Ideal emulator uncertainty values do not establish
physical compass accuracy. Calibration, missing/stale readings and pending-reply
races have controller coverage. Real sky alignment and TalkBack remain phone work.

Earlier [0.3.0](space-watch-0.3.0-staging.md) and
[0.3.1](space-watch-0.3.1-staging.md) incomplete runs remain separate; neither is
combined into acceptance for these bytes. The 0.3.1 emulator stopped but aborted
during teardown, explicitly retained in its report.

The resumed-sample handler now checks the 1.5-second gap before smoothing,
independently of the periodic frame callback. Its new regression fails before and
passes after the fix. Follow gates are automatic and mandatory for version 0.3.0+
and completion requires the expected gate count. This run intentionally omits
`--follow` to exercise that default. [0.3.2 partial evidence](space-watch-0.3.2-staging.md)
is also retained separately; its menu/focus checks are not substituted for this run.

Repeated readings without a supported WMM correction now update the full sky
only on entry to that state, not at 10 Hz. A regression measures ten samples:
ten redundant frames before the fix, none after. The paused message remains.
Earlier [0.3.3 attempts](space-watch-0.3.3-staging.md) are retained separately.
The driver resolves the visible control first, using bounded platform swipes
away from the edge only if needed, avoiding the failed left-padding gesture.

The first 0.3.4 run was interrupted after two gates when padding swipes did not
expose the selected object card. A diagnostic platform swipe exposed the expected
NORTH / “Turn left about 80°” card while facing east. The driver now uses platform
swipes away from the edge, a bounded control search, and accepts/records the actual
relative instruction as the fixture target moves. Exact direction/smoothing remains
controller-tested. Module/APK bytes are unchanged. Teardown was independently
verified successful. [Partial receipt](evidence/space-watch-0.3.4-attempt6-2026-09-29.json).

A subsequent retry stopped after two gates because an unconditional scroll-to-start
required a scrollable WebView immediately after native reopen. The Follow button
was already visible. This driver assumption is removed; native teardown succeeded.
[Retained retry receipt](evidence/space-watch-0.3.4-attempt7-2026-09-29.json).

Another attempt passed five gates then observed one native listener during Quick
Settings. The shade was visible, but no client focus-state receipt preceded that
assertion; logs also show delayed focus processing. This is retained as a failure,
not reclassified as a pass or proof of a post-callback leak. The rerun matches the
host's acceptance method: require system/client resumed-but-unfocused state,
retain those dumps and timing, then assert zero listeners. Teardown succeeded.
[Five-gate failure receipt](evidence/space-watch-0.3.4-attempt8-2026-09-29.json).

The last 0.3.4 run passed all seven added Follow gates, then failed reaching the
original pass list. Its client observation confirms `mResumed=true`,
`mStopped=false`, `mHasWindowFocus=false`, followed by zero native listeners;
return remained off until an explicit tap. Orientation revocation and process
restart also had zero listeners. Dynamic text had prevented the driver's scroll
boundary detection; a regression now uses named-control positions instead.
The landscape and large-text Follow captures include a driver-induced Android
text-selection toolbar over Rewind. Teardown independently succeeded.
[8/23 receipt](evidence/space-watch-0.3.4-attempt9-2026-09-29.json).
