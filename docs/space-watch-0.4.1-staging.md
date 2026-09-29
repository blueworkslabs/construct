# Space Watch 0.4.1 pointing-view staging

Status: **Android acceptance pending. Not cleared for phone handoff yet.**
No merge, APK release or production-catalog update is included.

## Ownership and immutable artifacts

Module-only viewfinder, orientation reconstruction, smoothing and pointing words
on the existing API 0.14 `orientation.read`. Host alpha37 owns native consent,
sensor delivery and foreground lifecycle. No camera access, new capability or
new network origin is added. Position, heading and orientation are not persisted
or sent to providers.

- Author source: `a291e4ccd56f441e0bfffa7494e1c70ee2f3fca6`.
- Review fixes: `d221708` and `3d9d027`.
- Signed packages: `301fd638e329a76ef02a5c8b11a880973371eb86`.
- Real module SHA-256: `10dcb4fc379af3606a32f227cafc68f1f77d98c01ab581724975b2eb7aad9e83`.
- Synthetic fixture SHA-256: `d130aa79a5d9942cb764eafef3599628b02483e9dcdd35d88b169ce8de6a7b69`.
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
- Selecting a future pass while already pointing now keeps the object selected
  but stays at Now, instead of trapping a preview behind hidden rewind controls.
  The controller and real-browser regressions fail before and pass after.
- The turn and calibration regressions also fail before and pass after.
- Host-formula reconstruction checks all four display rotations, elevations
  through 90° and rolled poses near ±180° (1,760 combinations).
- 22 unit groups, controller tests, real-browser DOM/canvas checks including
  pointing recovery/expiry and portrait/landscape/2x layout, 36 Python package
  tests, 97 runner-helper tests and the architecture check pass.
- Stale documentation excluding upright pointing was corrected.

Review and fixes assisted by Codex. Automated accessibility assertions do not
claim physical TalkBack coverage. Emulator compass readings do not establish
real-world pointing accuracy or validate the physical feel of the 4° lock.

## Android acceptance

Run `20260929T105608Z-space-02b65b18` is in progress. Required count: **25**.
Expanded coverage includes native high-elevation (60°, host flat pose), rolled
pointing, landscape and 200% text alongside existing grants, Follow lifecycle,
pass/train/lookup, real live download and offline-cache gates. Final receipt,
original captures and teardown result will be added only after completion.
The fixture is reopened before pointing layout checks to reset its advancing
clock; Follow is explicitly started and the satellite reselected.

[Phone checklist](space-watch-0.4.1-hardware-check.md).


Earlier [0.4.0 driver evidence](space-watch-0.4.0-staging.md) stays separate and
is not substituted for acceptance of these updated bytes.
