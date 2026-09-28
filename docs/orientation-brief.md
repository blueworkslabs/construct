# Orientation brief — `orientation.read`

Status: **host side implemented as an API 0.14 source candidate** (2026-09-28),
stacked on API 0.13 (#42) and unreleased. The implemented contract is in
[the module API](module-api.md#foreground-compass-and-tilt-orientationread-api-014-source-candidate).
Deviations from this proposal:
- `get` times out after 2 s with `ORIENTATION_UNAVAILABLE`.
- `calibrate` is also set when the heading accuracy is worse than 30°.
- The accuracy prefers the sensor's own estimate (values[4]) over the status
  mapping.
- The host was built by Fable; Astra handles review and acceptance.
  **Acceptance is held** for activity-pause enforcement; see the
  [alpha35 staging report](orientation-alpha35-staging.md).

## Why

- **Space Watch follow mode.** The dome turns with the phone: hold it flat, the
  top points where you face, and a wedge shows your view. This was concept pillar
  6 ([Space Watch](space-watch.md)). The dome already has a `rotation` input
  reserved for it.
- **Aimé.** The [Aimé brief](aime-brief.md) plans a one-shot
  `orientation.read {op:"get"}` for a compass-only mode, and a "later live mode".
- One small host capability serves both. It must not become a camera/AR feature.

## Ownership

| Host (APK) | Module |
| --- | --- |
| Rotation-vector sensor access, rate cap, rounding, foreground-only lifecycle, grant and consent | What the heading means: declination, smoothing, the wedge, calibration hints, UI |

Delivery: a host update with an API bump, **proposed 0.14** (0.13 is #42).
Modules that use it declare `constructApi.min` 0.14. The Space Watch follow mode
ships as a module update after the host is live.

## Proposed contract

Capability `orientation.read` is declared with a reason and may be `optional`.
The consent text is: "Read the phone's compass heading and tilt while this module
is open." No Android runtime permission is involved. The native Module access
switch is the gate, and it is off until granted.

- `{op:"get"}` returns one sample (Aimé's compass-only mode):
  `{azimuthDeg, pitchDeg, rollDeg, headingRef:"magnetic", accuracyDeg?, timestamp}`.
- `{op:"watch", rateHz}` starts a stream and returns `{watching:true, rateHz}`.
  - `rateHz` is one of 5, 10 or 15; the default is 10.
  - Samples arrive as
    `window.dispatchEvent(new CustomEvent('constructorientation', {detail: sample}))`,
    the same push path as `constructvisibilitychange`, at most at `rateHz`.
- `{op:"stop"}` returns `{watching:false}`. It is idempotent.

**Frame.** `azimuthDeg` is the horizontal bearing of the device's top edge when
the phone is held flat, or of the back camera axis when upright. The host picks
the frame from gravity and states it as `pose: "flat" | "upright"`. Signs follow
the Aimé solver (`docs/aime/resection.js`):
- `pitchDeg > 0` when the top or camera axis points below the horizon;
- `rollDeg > 0` when the right side is down.

The host remaps for the current display rotation so modules never handle
`remapCoordinateSystem`.

**Values:**
- rounded to 0.1°;
- `timestamp` in Unix ms;
- **headings are magnetic, and the host applies no declination.** The host has no
  location for this. A module that has one converts to true north itself (Space
  Watch can bundle public-domain WMM coefficients); one that doesn't shows
  magnetic.

**Accuracy.** Android `SENSOR_STATUS_*` maps to `accuracyDeg`: HIGH 8, MEDIUM 15,
LOW 30. When the sensor reports UNRELIABLE, `accuracyDeg` and `azimuthDeg` are
omitted, pitch and roll are kept, and `calibrate: true` is set. Fields are
omitted rather than guessed, as in the 0.13 capture metadata.

**Lifecycle.** Samples flow only while the module is visible.
- A `constructvisibilitychange` with `visible:false` stops the watch in the host.
  After resume, the module must call `watch` again.
- Closing the module or revoking the grant stops the watch at once.
- One watch per session; a second `watch` replaces the rate.

**Errors:**
- `CAPABILITY_DENIED` (grant off);
- `ORIENTATION_UNAVAILABLE` (no rotation-vector or game-rotation sensor);
- `ORIENTATION_PARAMS`;
- `RUN_PAUSED` (called while hidden).

**Privacy and abuse bounds.** Fine-grained motion data can leak typing and
activity patterns. The mitigations are:
- foreground only;
- at most 15 Hz;
- 0.1° rounding;
- no raw accelerometer, gyroscope or magnetometer vectors;
- no background or batched delivery;
- a separate consent line.

## Acceptance (host)

- **JVM tests:** the frame and sign conversions for all four display rotations,
  both poses, and the rounding.
- **JVM tests:** accuracy mapping, the UNRELIABLE omission, and the rate cap.
- **Lifecycle:** the watch stops on menu pause, close and revoke, and does not
  restart by itself.
- **Android runner:** `adb emu sensor set` for orientation and acceleration
  (as in the 0.13 tilt checks); denied and granted; a pause mid-stream.

## Space Watch follow mode (module, after the host)

- **Follow toggle.** It starts a 10 Hz watch. The dome rotation is the true
  heading (magnetic plus declination), smoothed with a short circular average.
- A green wedge (±28°) shows your view. The guidance reads "ISS is ahead of you,
  slightly right, 1 fist up" or "turn left ~40°".
- **Accuracy is always visible** ("Compass ±15°"). A calibration hint (figure
  eight) appears when the host sets `calibrate`. It is never shown as a
  crosshair.
- **Upright pose, later:** edge arrows toward the selected object using pitch.
  There is still no camera.
- **Fallback.** Without the grant or the sensor, the static compass dome keeps
  working as today.

## Open questions

1. Version number (0.14) and whether `get` and `watch` land together. The
   proposal is together: Aimé needs `get`, Space Watch needs `watch`.
2. Who implements the host side. The Aimé pattern is Clawd implementing and Astra
   accepting.
