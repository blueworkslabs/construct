# Space Watch 0.4.0 pointing-view staging

Status: **Android acceptance pending. Not cleared for phone handoff yet.**
No merge, APK release or production-catalog update is included.

## Ownership and immutable artifacts

Module-only viewfinder, orientation reconstruction, smoothing and pointing words
on the existing API 0.14 `orientation.read`. Host alpha37 owns native consent,
sensor delivery and foreground lifecycle. No camera access, new capability or
new network origin is added. Position, heading and orientation are not persisted
or sent to providers.

- Author source: `a291e4ccd56f441e0bfffa7494e1c70ee2f3fca6`.
- Review fixes: `d221708`.
- Signed packages: `f4b0ff1eaf3e745d0130be0b733c91e685398f7b`.
- Real module SHA-256: `f4799b20c88d22d76f7be7dab2791c929eda8c80140386e6d31dc74f639ea98f`.
- Synthetic fixture SHA-256: `ea3c7d1a1930f89bf13a20aacd319efad2032f7b4fe5fd81e6cb60329c099a56`.
- Host source: `4e7f534`, unchanged alpha37.
- x86_64 APK SHA-256: `23cd4b27f95fbc0124fbb6cf69af4d80a6cc8534c58e2235b95e24f4526b5477`.

Both downloaded packages match their catalog hashes and publisher signatures.
The fixture substitutes clock, Berlin viewpoint and captured orbit lists, but
uses the real host orientation, storage and live lookup paths. Real-module
permission/live/offline gates remain separate from fixture checks.

## Review and local verification

- Large discontinuous turns reacquire directly instead of retaining the old aim
  for seconds through nearly opposite smoothed vectors. Smaller motion retains
  the 35% vector smoothing and orthogonalisation.
- Calibration recovery restores spoken guidance even when its direction/lock
  state is unchanged. Continuous distance updates are still not announced.
- Both regressions fail on author source and pass with the fixes.
- Host-formula reconstruction checks all four display rotations, elevations
  through 90° and rolled poses near ±180° (1,760 combinations).
- 22 unit groups, controller tests, real-browser DOM/canvas checks including
  pointing recovery/expiry and portrait/landscape/2x layout, 36 Python package
  tests, 96 runner-helper tests and the architecture check pass.
- Stale documentation excluding upright pointing was corrected.

Review and fixes assisted by Codex. Automated accessibility assertions do not
claim physical TalkBack coverage. Emulator compass readings do not establish
real-world pointing accuracy or validate the physical feel of the 4° lock.

## Android acceptance

Run `20260929T103325Z-space-e29494d6` is in progress. Required count: **25**.
Expanded coverage includes native high-elevation (60°, host flat pose), rolled
pointing, landscape and 200% text alongside existing grants, Follow lifecycle,
pass/train/lookup, real live download and offline-cache gates. Final receipt,
original captures and teardown result will be added only after completion.

[Phone checklist](space-watch-0.4.0-hardware-check.md).
