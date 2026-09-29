# Space Watch 0.3.3 follow-mode staging

Status: **superseded by 0.3.4; incomplete.** Not cleared for phone testing.
No merge, APK release or production-catalog change is included.

## Ownership and exact artifacts

Module-only HTML/CSS/JavaScript on the existing alpha37 API 0.14 host. The
module owns WMM2025 magnetic-to-true correction, smoothing, sky rotation and
pointing UI. The host owns consent, bounded sensor access and lifecycle.
Optional `orientation.read` adds native opt-in, with no Android permission or
new network origin. Existing module storage/network privacy boundaries remain.

- Reviewed module source: `923e5fb` (review foundation `b59b222`, author base `4b604ae`).
- Signed real/fixture packages: `8aadc397bc5543eee8b0c11c727f6b226160dd5f`.
- Real module SHA-256: `7ec92078b6608a91fc5c31919ff64f48fcc225949e01b5f18dd3e94abcf3f4d5`.
- Fixture SHA-256: `b53a17626aff142efb5cf9eac9e3eb95f1ff91381e435e61aa29161ffee59653`.
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

Interrupted exact-package run `20260929T001514Z-space-84d5f2b3`, 23 required checks.
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

The first 0.3.3 attempt was interrupted after three gates when padding swipes
failed to reach the Follow button. A platform scroll-to-start diagnostic restored
the header; the driver now uses that action before Follow taps. Module/APK bytes
are unchanged. Independent teardown succeeded.
[Partial receipt](evidence/space-watch-0.3.3-attempt4-2026-09-29.json).

The retry was superseded after two gates for the unavailable-correction redraw
fix. No failed or incomplete run is acceptance.
[Retry receipt](evidence/space-watch-0.3.3-attempt5-2026-09-29.json).
