# Space Watch 0.3.0 follow-mode staging

Status: **Android acceptance pending.** Not yet cleared for phone testing.
No merge, APK release or production-catalog change is included.

## Ownership and exact artifacts

Module-only HTML/CSS/JavaScript on the existing alpha37 API 0.14 host. The
module owns WMM2025 magnetic-to-true correction, smoothing, sky rotation and
pointing UI. The host owns consent, bounded sensor access and lifecycle.
Optional `orientation.read` adds native opt-in, with no Android permission or
new network origin. Existing module storage/network privacy boundaries remain.

- Reviewed module source: `b59b222` (author base `4b604ae`).
- Signed real/fixture packages and runner: `47f038b6d9d0ced166f1b5e03d6a504f9e5fcc6d`.
- Real module SHA-256: `72a0baea94c47f6224eac4205b0313ef5a5ad940dbcc05838ed44955e18d32f3`.
- Fixture SHA-256: `874cc6c75eafce030d30b86ea56155bbb07e380178aa68ae82bb45bdc8154dd4`.
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

## Planned Android scope

The existing 16 signed-fixture and real-module checks are retained. Seven added
Follow gates exercise native denial/grant, injected north/east sensor readings,
upright handling, explicit off/listener release, menu pause/return, Quick Settings
and explicit restart, display rotation/200% text, revocation and process restart.
The fixture replaces location/orbit data only: orientation goes through the real
host. Real-module checks separately cover native location/network denial,
automatic live provider loading and offline cached reopen.

Calibration hints, no-compass handling, pending-reply races, missing headings and
stale samples have controller coverage. Physical compass accuracy, a real sky
alignment and screen-reader usability remain phone-test work. No earlier
Space Watch run is substituted for acceptance of these bytes.
