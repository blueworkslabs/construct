# Space Watch 0.4.1 pointing-view staging

Status: **25/25 Android checks passed on the exact signed 0.4.1 packages. Ready for physical-phone checks.**
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
  tests, 98 runner-helper tests and the architecture check pass.
- Stale documentation excluding upright pointing was corrected.

Review and fixes assisted by Codex. Automated accessibility assertions do not
claim physical TalkBack coverage. Emulator compass readings do not establish
real-world pointing accuracy or validate the physical feel of the 4° lock.

## Android acceptance

Run `20260929T115722Z-space-c0df65aa` completed **25/25** unaided, using runner
`5354e6285b9616084a98da1af95bd27be698c74b`. Emulator teardown independently reported `Result=success`,
`ExecMainStatus=0`, `MainPID=0`, `ActiveState=inactive`.

[Sanitized exact-artifact receipt](evidence/space-watch-0.4.1-staging-2026-09-29.json)
contains all gate names, native listener counts and SHA-256 hashes of the original
emulator-console captures. Earlier partial and assisted runs below are not used
to manufacture this complete result.

Coverage includes real native north/east Follow, raised viewfinder, 60° camera aim
through the host's flat pose, rolled screen-relative guidance, landscape and
200% text. Off, menu pause, Quick Settings, revoke and fresh-process checks
verify native listener release; focus return stays off until an explicit tap.
Baseline pass/train previews, live Wikipedia and same-launch lookups, rewind,
red persistence, canvas selection and accessible dialog layouts also pass.
The real module separately passes denied location/HTTP, automatic live CelesTrak
loading after native grants, and cache reopen with Wi-Fi/mobile data disabled.

Native sensor connections are 1 while watching and after explicit restart/menu
return; 0 after Off, menu pause, Quick Settings, focus return, revoke and process
restart. The fixture is reopened before pointing layout checks to reset its
advancing clock, with Follow explicitly started and the satellite reselected.

The retained crash buffer contains a system `com.google.android.bluetooth`
SIGABRT (hardware error 0x42) during setup, not a Construct process crash.
The receipt records its hash; the run and independent emulator teardown succeeded.

### Original Android captures

These are retained console captures of the real alpha37 WebView, not browser
previews. Landscape images preserve the emulator's original rotated orientation.
Canvas and guidance have separate captures where scrolling is required.

- [Raised viewfinder](images/space-watch-0.4.1-staging/android-pointing-view.png)
- [60° camera aim](images/space-watch-0.4.1-staging/android-pointing-high.png)
- [Rolled camera aim](images/space-watch-0.4.1-staging/android-pointing-rolled.png)
- [Landscape guidance](images/space-watch-0.4.1-staging/android-pointing-landscape-guidance.png)
- [200% text guidance](images/space-watch-0.4.1-staging/android-pointing-large-guidance.png)
- [Explicit restart after focus loss](images/space-watch-0.4.1-staging/android-follow-ended.png)
- [Train attribution](images/space-watch-0.4.1-staging/android-space-train-wikipedia.png)
- [200% text dialog](images/space-watch-0.4.1-staging/android-space-large-text-details.png)

Physical sky alignment, practical lock-on accuracy and real TalkBack interaction
remain phone checks. No camera access is requested. Full GitHub Android-build CI
is tracked separately from these local and exact-package results.

[Phone checklist](space-watch-0.4.1-hardware-check.md).


Earlier [0.4.0 driver evidence](space-watch-0.4.0-staging.md) stays separate and
is not substituted for acceptance of these updated bytes.

## Retained 0.4.1 driver attempt

`20260929T105608Z-space-02b65b18` stopped at 5/25 recorded gates while trying
to reach Clear after enlarged-text checks. The layout capture still clipped the
visible guidance despite accessible bounds reporting it reachable, so that image
is not accepted as complete guidance evidence. The driver now centres the visual
instruction away from viewport edges and uses stable toolbar positions when a
WebView omits DOM IDs, rather than treating changing pointing words as scroll
movement. It searches downward first for controls below the canvas. Emulator
teardown was independently successful (exit 0, PID 0). This incomplete attempt
is not combined with a later run to claim full acceptance.


`20260929T111124Z-space-a8fc1d29` stopped at 4/25 locating the offscreen
heading after rotation. Its failure image shows a rendered viewfinder; no
acceptance is inferred from that capture. Teardown succeeded (exit 0, PID 0).

A separate assisted diagnostic (`20260929T112344Z-space-08a0bfc3`) confirmed
the expected high-elevation heading and actual content scrolling. It was
interrupted after its five-minute inspection pause; it is not an acceptance
run. Teardown succeeded. The driver now gestures through the content column
and uses margins compatible with the landscape sticky panel. Layout captures
also accept the full visual below-horizon message if the selected object sets;
the earlier high-elevation gates still require directional guidance.


`20260929T113458Z-space-e0c18d0d` stopped at 4/25 while the capture helper
tried to return to the page title. Native north/east, high-elevation and rolled
guidance passed, but no layout gate is inferred. Teardown succeeded (exit 0,
PID 0). The capture helper now positions the actual canvas from its clipped
edge, without requiring the page title first. A separate half-fist matcher
correction is covered by a helper regression. No module or APK bytes changed.


The focused run `20260929T114656Z-space-8a0d452e` was paused for assisted
gesture comparison, then interrupted with successful teardown. Direct execution
of the revised capture helpers produced readable landscape and 200%-text
canvas/guidance images. Those assisted images are diagnostic only, not counted
toward full acceptance. The final driver uses short padding gestures and direct
canvas positioning; the full run must reproduce the checks without assistance.
