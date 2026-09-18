# Measure precision loupe — alpha30 candidate verification

This is a candidate verification record, not a production release or physical-phone
acceptance. PRs #28 and #29 remain unmerged. Production catalog and alpha29 bytes
are unchanged.

## Ownership and corrections

The magnifier, placement/drag preview, crop math, UI and frame scheduling remain
inside the signed Measure module, using only its existing image pixels. No new
host workflow, grant, provider, geometry interpretation or permission was added.

The review/Android pass corrected:

- Fractional photo coordinates and exact zoom scale in the loupe, so its crosshair
  and overlay line agree with the accepted endpoint.
- Explicit text-input styling for calibration and a 44 CSS-pixel Reset target.
- Android text zoom: fixed larger panel splits based on rendered text metrics,
  plus scroll reset, keep the collapsed result/actions visible without endpoint
  edits shifting the photo.
- Resize-driven layout work is deferred outside ResizeObserver delivery. The
  synchronous version reproduced a ResizeObserver loop error; the corrected
  version passes the before/after browser and actual-module event tests.

Host alpha30 also carries PR #28's manifest dependency validation correction.
The module retains its corrected long-lived human picker request.

## Exact artifacts

The optimized APK was built from `8de6f89`; subsequent changes are module, test and
documentation only. All native libraries and protected assets are byte-identical
to alpha29. The signed Measure 0.2.5 source is `120f38e`, with identical
module bytes on the review integration branch. APK/module digests, checks and
reviewed screenshot hashes are in the accompanying sanitized receipt.

Candidate packages are immutable. Rejected 0.2.3 and 0.2.4 test packages remain
historical bytes but are excluded from the offered candidate index. They were
never accepted as the replacement pilot.

## Verification

- **29 module tests**, **67 runner tests**, and **175 host JVM tests** pass; lint has zero errors. Signing identity, Android permissions, protected assets, native-code boundary and APK size checks pass.
- Exact-artifact Android functional scope: **19/19**, including held A/B placement, drag/cancel and late-release handling, Undo, nudges, zoom/pan, both orientations at normal/2× text, picker, image variants, lifecycle and privacy.
- Signed **0.2.2 → 0.2.5 → 0.2.2** update/rollback: **2/2** on identical installed APK hashes. Actual held-drag captures show no loupe before, a working loupe after updating, and the original editor after rollback.
- All 13 retained synthetic display captures were reviewed with `FLAG_SECURE` still enabled. The final run is complete and the emulator stopped.
- [Sanitized digests and full check list](evidence/measure-loupe-alpha30-2026-09-18.json).

Representative actual Android captures:

- [Placement preview](images/measure-loupe-alpha30/precision-placement-b.png), [held drag](images/measure-loupe-alpha30/precision-drag-held.png), [cancelled drag](images/measure-loupe-alpha30/precision-drag-cancelled.png).
- [2× portrait](images/measure-loupe-alpha30/module-measure-large-0.png) and [2× landscape](images/measure-loupe-alpha30/module-measure-large-1.png).
- Same-APK delivery: [before](images/measure-loupe-alpha30/loupe-update-before.png), [updated](images/measure-loupe-alpha30/loupe-update-after.png), [rolled back](images/measure-loupe-alpha30/loupe-update-rollback.png).

The synthetic 2×-text measurements can display 24.1 cm because integer touch coordinates round differently after the fitted photo changes size; they remain within the existing test tolerance. This is not a real-world accuracy claim.

## Failed attempts retained

The first 0.2.3 Android run exposed clipped 2×-text controls and a driver that
missed a toggle settling after rotation. It is incomplete, not a pass. The 0.2.4
sizing correction then exposed a resize-observer loop error; that run is also
incomplete. Neither receipt is substituted for final 0.2.5 acceptance. A focused 0.2.5
layout probe later stopped on an overly exact displayed-value expectation after
integer touch-coordinate rounding (22.9 rather than 22.8 cm). The runner now uses
the existing 3 mm calibration tolerance; module bytes did not change.

## Limits

Evidence uses a disposable Android 17 emulator and synthetic photos, not a
physical ARM64 phone or real-camera accuracy calibration. Camera/live Sky and the
full legacy-retirement suite were not repeated for this UI follow-up. Alpha29's
retirement receipt remains tied to alpha29, not silently reattributed to alpha30.
Photos, calibration and measurements are intentionally transient between module
runs; update/rollback does not claim to persist them.
