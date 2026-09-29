# Space Watch 0.3.1 follow-mode staging

Status: **superseded by 0.3.2; incomplete, 15/23 checks passed.** Not cleared for phone testing.
No merge, APK release or production-catalog change is included.

## Ownership and exact artifacts

Module-only HTML/CSS/JavaScript on the existing alpha37 API 0.14 host. The
module owns WMM2025 magnetic-to-true correction, smoothing, sky rotation and
pointing UI. The host owns consent, bounded sensor access and lifecycle.
Optional `orientation.read` adds native opt-in, with no Android permission or
new network origin. Existing module storage/network privacy boundaries remain.

- Reviewed module source: `1ee6551` (review foundation `b59b222`, author base `4b604ae`).
- Signed real/fixture packages: `e2e7a1d8cb2d6e8906a7cf1d37960ce6ba1ed2cf`.
- Real module SHA-256: `8ba399c769f72f1a25cdd4b166a933096303ccb5c575690b93589d232d687385`.
- Fixture SHA-256: `824b25f961347041a017b962af30de3965eb2f3952ca68dd65069ed184840e12`.
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

The initial 0.3.0 run passed 14/23 checks, then stopped at an immediate listener
check after Follow off; teardown completed. Its accessibility helper also exposed
the screen-reader-only paragraph. Version 0.3.1 preserves the hidden class, with
a before-failing/after-passing browser regression. A first test incorrectly treated
the clipped element's CSS minimum height as visible output; the corrected check
verifies that it is absolutely positioned and fully clipped. Package assertions
now name 0.3.1. The runner waits up to three seconds for asynchronous native
listener transitions and records each wait. No failed gate is waived.

## Retained incomplete run

Run `20260928T234407Z-space-8d070276` passed the original twelve UI checks,
Follow denial, north/east pointing, upright suspension and explicit off. Menu
return then failed: the host correctly denied the watch with `RUN_PAUSED` while
the native menu still held window focus. Version 0.3.2 adds a bounded, cancellable
menu-return retry; no general background restart is introduced.

The emulator is stopped, but teardown reported `SIGABRT` (exit signal 6), not a
clean process exit. The receipt’s `stopped` flag only means the service is inactive.
[Retained receipt](evidence/space-watch-0.3.1-staging-2026-09-28.json).
