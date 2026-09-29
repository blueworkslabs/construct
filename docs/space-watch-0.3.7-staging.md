# Space Watch 0.3.7 follow-mode staging

Status: **Android acceptance pending.** Not yet cleared for phone testing.
No merge, APK release or production-catalog change is included.

## Ownership and exact artifacts

Module-only HTML/CSS/JavaScript on the existing alpha37 API 0.14 host. The
module owns WMM2025 magnetic-to-true correction, smoothing, sky rotation and
pointing UI. The host owns consent, bounded sensor access and lifecycle.
Optional `orientation.read` adds native opt-in, with no Android permission or
new network origin. Existing module storage/network privacy boundaries remain.

- Reviewed module source: `4f59c2b` (review foundation `b59b222`, author base `4b604ae`).
- Signed real/fixture packages: `8aaf99611385dafe3b17914f55ca55694f2ab390`.
- Real module SHA-256: `6c376ca889fa7887c08f70f822508a176f87f5e694b832c044ba60094c22d3c2`.
- Fixture SHA-256: `dbee0598f0cbfec21add381fb3a20641030267a4367a95ba0eadde54a5563232`.
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
checks, 36 Python publisher/package tests, 96 runner-helper tests and the
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

Pending exact-package run `20260929T012150Z-space-925801ac`, 23 required checks.
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

## Cancellable sample expiry

A dedicated cancellable timer expires directional guidance 1.5 seconds after
measurement time, independently of the slower sky-render timer. Fresh readings
replace it; lifecycle changes cancel it. Regressions cover silence without frame
callbacks and an older timer being unable to clear a newer reading. These fail
before the change and pass afterward. JavaScript event-loop scheduling is not a
hard real-time guarantee. Earlier [0.3.5 runs](space-watch-0.3.5-staging.md) remain
separate and cannot establish acceptance for these new bytes.

## Model validity window

Correction is available only for WMM2025’s documented decimal-year interval
2025.0–2030.0, inclusive. Boundary regressions reject the instants just outside
it and accept both endpoints; the old extrapolating guard fails this test.
All twelve NOAA field values remain green. 0.3.6 was signed but superseded
before Android execution and has no acceptance run.

## Driver corrections retained separately

The current driver excludes fixed Android system-bar controls from scroll-progress
signatures and searches down first for later pass entries. The status-bar
regression fails before and passes after the driver correction. This changes no
module or host bytes and does not turn earlier incomplete receipts into passes.
Original captures from each run remain tied to their own run ID.

## Capture caveats

The original Follow landscape and 200%-text captures include driver-induced selection handles
on the Rewind label. The full rotated dome remains visible; this is not presented
as an untouched-layout capture. No screenshot pixels have been edited. Emulator
captures may retain portrait file orientation while the display is in landscape.
