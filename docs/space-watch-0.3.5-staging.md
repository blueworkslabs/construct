# Space Watch 0.3.5 follow-mode staging

Status: **Android acceptance pending.** Not yet cleared for phone testing.
No merge, APK release or production-catalog change is included.

## Ownership and exact artifacts

Module-only HTML/CSS/JavaScript on the existing alpha37 API 0.14 host. The
module owns WMM2025 magnetic-to-true correction, smoothing, sky rotation and
pointing UI. The host owns consent, bounded sensor access and lifecycle.
Optional `orientation.read` adds native opt-in, with no Android permission or
new network origin. Existing module storage/network privacy boundaries remain.

- Reviewed module source: `e8f286c` (review foundation `b59b222`, author base `4b604ae`).
- Signed real/fixture packages: `a0d9448bedf10fe84c622da31607bd3778f2338a`.
- Real module SHA-256: `e8adfd0a526d67b64b667f3a5ad5ac932cd2d56db02ca2e4923bd0526de8fea1`.
- Fixture SHA-256: `408c6c636dab6d8df64ff410d86ad6c91c9a0b90bbf15b7bb451e4b807fb1e3e`.
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
checks, 36 Python publisher/package tests, 95 runner-helper tests and the
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

Pending exact-package run `20260929T005357Z-space-4267d43b`, 23 required checks.
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

## Measurement time and magnetic zones

Queued readings are rejected if their supplied measurement timestamp is missing,
invalid, in the future or older than 1.5 seconds. Usable age and expiry derive from
measurement time, not event-handler processing time. Regressions cover a stalled
renderer receiving an old reading, fresh recovery and expiry of an already-aged
sample. Both relevant before/after tests fail on the old source and pass on this
candidate.

Declination is conservatively unavailable when the horizontal model field is
below 6000 nT: both the [NOAA caution and blackout zones](https://www.ncei.noaa.gov/products/world-magnetic-model/accuracy-limitations-error-model).
The regression includes 85°N, 130°E (~105 nT), a caution-zone point at 75°N,
130°E, and a valid high-latitude point at 70°N, 130°E. Berlin and all twelve
NOAA field test values remain green. No unstable directional instruction replaces
the ordinary north-up sky there.

Earlier [0.3.4 attempts](space-watch-0.3.4-staging.md), including the eight-gate
run, remain separate. The runner now compares stable named-control positions for
scroll boundaries rather than rapidly changing compass/sky text. It uses shorter
swipes to avoid driver-induced text selection. Focus-loss acceptance explicitly
records system/client state before testing native listener release.
