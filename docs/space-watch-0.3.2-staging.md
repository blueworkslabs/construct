# Space Watch 0.3.2 follow-mode staging

Status: **superseded by 0.3.3; partial 6/23 evidence only.** Not cleared for phone testing.
No merge, APK release or production-catalog change is included.

## Ownership and exact artifacts

Module-only HTML/CSS/JavaScript on the existing alpha37 API 0.14 host. The
module owns WMM2025 magnetic-to-true correction, smoothing, sky rotation and
pointing UI. The host owns consent, bounded sensor access and lifecycle.
Optional `orientation.read` adds native opt-in, with no Android permission or
new network origin. Existing module storage/network privacy boundaries remain.

- Reviewed module source: `b644884` (review foundation `b59b222`, author base `4b604ae`).
- Signed real/fixture packages: `b796656d67ad244e46b8b866784b5da417eea06f`.
- Real module SHA-256: `52ca8609068cd81270c20e5f003111ab86b22f61599227132e7dd764be8fd199`.
- Fixture SHA-256: `0ff39b7243272de166f85d308b4a6d95f58886bf7c7f5dbad63f6a938b9c8956`.
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

Interrupted exact-package run `20260928T235821Z-space-eaa5d8f9`, 23 required checks.
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

The first six gates passed, including menu-return recovery and Quick Settings
explicit-restart behavior. This run was deliberately stopped for the sensor-gap
smoothing fix. The raw receipt has `stopped=false` because it was interrupted;
independent teardown then confirmed emulator inactive, PID zero and successful
exit. [Partial receipt](evidence/space-watch-0.3.2-staging-2026-09-28.json).
