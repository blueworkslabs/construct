# Private photo capabilities — API 0.11 candidate

This describes the published alpha31 pilot. Its emulator replacement/migration
scopes have passed, and the pilot tester reports that it works as expected on a
Pixel. That feedback is not a quantitative phone-performance benchmark. See [the experiment contract](camera-module-plan.md) and
[exact-artifact evidence and limits](camera-alpha31-acceptance.md).

The native live CameraX viewfinder is acquisition infrastructure. The module owns
the album, selected photo, analysis commands, detection list, overlays and ordinary
application UI. Analysis operates on an explicitly selected **still photo**, not
on a video stream. This does not establish feasibility of high-frame-rate web
video processing. The alpha31 source candidate retires the older workspace. Its
completed replacement and migration verification is tied to the artifacts in the
acceptance report; changed artifacts need their own applicable verification.
Alpha30 remains the released native baseline.

## Authority and data

Declare API `min` and `target` `0.11.0` and the relevant capability. Each new
capability is explicit opt-in, independently of Android permissions. The former
`camera.capture` grant cannot authorize pixels or private-library access.

`photos.library` and `image.analyze` must also declare `image.read`, even if the
first declaration is optional. All grants start off unless separately accepted.
Private-library consent covers this module's **existing** saved originals, not
just photos captured after granting access. It does not expose other modules'
photos or the phone's general gallery. Picker images still use the Android system
picker under the [selected image API](module-images.md).

Pixels and detection results are data available to module JavaScript. Camera's
module declares no network capability. Do not generalize that to a promise that
every module with image access can never transmit selected pixels: separately
granted network access is a distinct, explicitly disclosed composition.

## `camera.photo`

Request: `{ "op": "capture" }`. No shutter flag, path, background or automatic
capture option is accepted. Android CAMERA permission is required in addition to
the module grant. A visible native viewfinder provides Switch camera, Take photo
and Cancel capture. Only a human shutter saves an original into the calling
module's private storage.

Result: `{ "saved": true }` after a successful save, or `{ "saved": false }` on
ordinary cancellation. No filename, pixels or analysis accompanies this result.
To display a captured photo, the module separately lists and opens its private
library. A capture-only grant does not implicitly grant those operations.
API 0.13 adds optional request fields and capture metadata; see
[capture metadata](#capture-metadata--api-013-source-candidate). API 0.11/0.12
callers keep exactly this request and result: the new fields fail with
`CAMERA_PARAMS`.

The tracked native handoff may pause the WebView. Returning from shutter/Cancel
resumes that same run. Backgrounding or rotating the acquisition activity closes
the parent image run; a late save/result must not restore a closed session.
Human choice has no JavaScript deadline. Camera permission and current module
authority are rechecked before publishing a saved original.

## `photos.library`

All operations require both `photos.library` and `image.read` grants. Exact keys
are required; additional caller-controlled confirmation or path fields fail.

| Request | Result |
| --- | --- |
| `{ "op": "list" }` | `{ "photos": [{ "ref": "opaque run token" }], "limit": 8 }`, capture order |
| `{ "op": "open", "ref": "…" }` | Same image handle/PNG URL shape as `image.read`, normalized to at most 1024 pixels per edge |
| `{ "op": "delete", "ref": "…" }` | `{ "completed": true }` only after native confirmation and deletion; false on cancellation |
| `{ "op": "export", "ref": "…" }` | `{ "completed": true }` only after native confirmation and successful phone-gallery copy; false on cancellation |

Each list issues fresh unpredictable refs; they are invalid after refresh or run
closure. No dates, filenames, EXIF or filesystem paths cross the bridge. A ref
from another run or module cannot select an original. Only one selected raster
exists at a time; opening another image invalidates its predecessor's URL/handle.
The selected image retains its source authority: reading its PNG stream or
delivering its analysis also rechecks `photos.library`.

Native confirmation shows a bounded preview of the actual selected original.
Module text cannot substitute the confirmation. Cancel preserves the original.
Revocation, close or a stale module digest prevents a late confirmation from
committing deletion/export. Export requires Android 10/API29; the original
remains private and unchanged. The confirmed copy can be read/backed up by other
photo apps according to the phone's settings.

Private storage retains the existing layout and limits: 8 photos per module,
4 MiB per original, 20 MiB per module, 64 MiB globally. Upgrading a module is not
an instruction to delete originals. Opening, decoding and inference never rewrite
them. A library task has one process-wide worker slot and a 15-second processing
deadline, with no unbounded queue. The separate human confirmation wait has no
artificial deadline. Stale work cannot publish after cancellation or timeout.

## Stable photo identity — API 0.12 source candidate

Implemented in source for slice 1a of [Aimé](aime-brief.md); not in any released
host APK, and not accepted until the staging check below has run on exact bytes.
It adds `id` beside `ref` in the successful
`photos.library {op:"list"}` result: `{photos:[{ref,id}],limit:8}`. `id` is an
opaque ASCII identifier of 1–80 characters, allocated and persisted by the host
for one original in one module's library. It is not a filename, path, EXIF value,
content hash or cross-module correlation handle. Identical captures get distinct
IDs; deletion retires an ID permanently. Refresh, run/process restart and module
update/rollback preserve it while that original is retained. This is a module
rollback guarantee, not a promise that an older host APK implements API 0.12.

`id` is **identity, never authority**. All current declaration, opt-in, run and
image-grant checks still apply to listing. Open/delete/export continue to accept
only the current unpredictable `ref`; stable IDs are not accepted in its place,
nor as additional request fields. Listing remains complete and bounded to eight
photos in capture order. A list failure must not become an empty/partial success.
Existing originals receive IDs durably before their first successful 0.12 list;
interruption/retry must not change IDs already published, rewrite originals or
silently pair a different original. Fail with the existing structured photo
error family if identity cannot be safely persisted. Native deletion/clear-all
retires the corresponding identity but does not atomically delete module KV data.

Modules requiring IDs declare API `min` and `target` `0.12.0`; API 0.11 callers
retain their existing response shape and behavior. Neither the 0.12 negotiation
nor this result field exists in the released alpha31 host. Capture still returns
only `{saved:true|false}`: a module may associate a capture by comparing successful
before/after ID lists, but must leave it unassociated if no unique new ID can be
established. Deletion reconciliation must run only after a successful complete
list and a successful storage write, never on denied/failed access.

Acceptance for the new host must cover legacy-photo backfill, repeated list and
process restart, identical-content captures, module update/rollback, deletion and
recapture, native clear-all, interrupted persistence, cross-module isolation,
grant denial/revocation and rejection of an ID used as authority. A staging check
must tie these observations to the exact APK; this specification is not evidence
that those checks have run.

Source implementation: the host derives `id` as a truncated HMAC-SHA256 of the
original's host-allocated random filename under a 32-byte per-module key
(`.identity-key`, a versioned checksummed record beside the originals, and a
durable `.identity-initialized` fingerprint marker). Both are written via fsynced
stage+rename before the first ID is returned; retries repeat the directory
durability barrier. Filenames are never renamed or reused, so IDs are stable
while the original exists and retired with it. Legacy backfill creates a key
only when originals exist and no initialization marker exists. A missing
established key or damaged record fails the list (`PHOTO_FAILED`) instead of
re-keying. These checks detect accidental metadata damage, not hostile root
rewriting or simultaneous loss of all identity metadata. JVM coverage is `PhotoIdentityTest`; the
exact-APK staging check is `scripts/android-runner/photo_identity.py`
([reproduce](reproduce.md)). The [alpha32 candidate receipt](photo-identity-alpha32-acceptance.md)
records completed review and exact-APK staging, separately from pending phone feedback.

## `image.analyze`


Request: `{ "op": "detect", "handle": "…", "kind": "faces" }` or kind
`objects`. The handle must be the calling run's current selected image. No model
path, image path, identity or emotion request is accepted.

Result: `{ "kind": "faces", "boxes": [{ "left": 0.1, "top": 0.2,
"right": 0.3, "bottom": 0.4, "label": "Face", "score": 0.92 }],
"processingMs": 123 }`. Coordinates are normalized relative to the
orientation-corrected selected image. Results are estimates, not identity or
ground truth. The module determines labels, layout and selection workflow around
this reusable result; it must fit overlays to the image's actual letterbox.

The unchanged bundled CPU models operate offline on at most a 1024-pixel edge,
threshold 0.5, at most 20 faces or 5 objects. The image worker is shared with image
normalization/marker detection: one active job, no unbounded queue, a 15-second
deadline and a minimum one-second interval between inference requests. Processing
may finish after cancellation but cannot deliver into a stale run. Selected
pixels and results are transient; neither is appended to diagnostic logs.

`processingMs` measures the native detector call, including model initialization
when needed, not total user-perceived latency or rendering smoothness. Report
end-to-end and frame measurements separately, with build/device/automation context.
Debug-only WebView instrumentation is not a feature enabled in a pilot build.

## Error and lifecycle expectations

Existing structured errors distinguish denied or stale authority from unavailable
hardware/models, invalid parameters, busy/rate limits and processing timeouts.
`PHOTO_STALE` requires refreshing the library; `IMAGE_STALE` requires reselecting
the image. Never turn failed inference into a zero-detection success. Closing or
backgrounding the module clears its transient image run while retaining originals.
Review [security boundaries](../SECURITY.md) and the actual acceptance evidence
before treating a prototype success as a completed migration.

## Capture metadata — API 0.13 source candidate

Implemented in source for slice 2b of [Aimé](aime-brief.md); not in any released
host APK, and not accepted until the staging check below has run on exact bytes.
Modules declare API `min` and `target` `0.13.0`.

Request: `{ "op": "capture", "level"?: boolean, "zoom"?: [ratio, …] }`. Exact keys;
`level` must be a JSON boolean; `zoom` is 1–4 numbers in 0.1–10 that differ by at
least 0.05 (closer steps would be indistinguishable chips and are rejected, never
merged or rounded). Anything else fails with `CAMERA_PARAMS`. `level: true` shows a level indicator in the native
viewfinder (horizon line plus a pitch/roll readout, green within ±1°) for the rear
camera. `zoom` offers fixed steps as chips, each clamped to the bound camera's range
(ratios keep their precision; only steps clamped onto the same range limit merge). The initial step is 1× when offered,
otherwise the first; without `zoom` the capture is at 1×. There is no free zoom.

Result after a save:

```json
{ "saved": true, "id": "p…", "capture": {
  "zoomRatio": 2.0,
  "fovDeg": { "h": 33.6, "v": 43.9 }, "fovSigmaDeg": 1.0,
  "tilt": { "pitchDeg": 4.2, "rollDeg": -0.8, "sigmaDeg": 1.0, "ageMs": 31 },
  "headingDeg": 212.5, "headingRef": "magnetic", "headingAccuracyDeg": 11.5, "headingAgeMs": 44 } }
```

Cancellation still returns `{ "saved": false }`. `id` is the new original's stable
ID, identical to its `photos.library` list `id` (API 0.12 scheme); it is identity,
not authority. If the host cannot persist that identity, the original is discarded
and the capture fails instead of returning a photo the module cannot identify.
No location is included.

Every value describes the saved image **as the module opens it** (after EXIF
orientation), sampled at the shutter. These are estimates from published camera
characteristics and phone sensors, not a lens calibration. Every measured field
except `zoomRatio` is optional, carries its own uncertainty (`fovSigmaDeg`,
`tilt.sigmaDeg`, `headingAccuracyDeg`) and, for sensor values, its age (`tilt.ageMs`,
`headingAgeMs`); it is **omitted** rather than guessed when unavailable or
unreliable. Modules treat a missing key as unknown, never as zero, and set a
"measured" flag only for fields that are present.

**Timing.** Sensor ages use each sample's measurement time (`SensorEvent.timestamp`,
the `elapsedRealtimeNanos` clock), never its delivery time: a sample measured 2 s
ago and delivered late is 2 s old. The exposure is known to start between the
moment before `takePicture` and the arrival of CameraX's `onCaptureStarted` (or,
if that callback never arrives, the moment the image is saved). A sample's age is
its largest possible distance from any instant in that window, in milliseconds
rounded up, and the host picks the sample with the smallest such age. Samples
measured after their own delivery (clock mismatch), with unreliable or no-contact
status, or with non-finite values are never used.

- `zoomRatio`: the ratio CameraX reports as applied when the shutter is pressed.
- `fovDeg`: from the still frame's own lens. The host reads the saved frame's
  Camera2 capture result (a still-capture request completed after the shutter; exactly
  one, or the result is not used): its focal length, active physical camera (API 29+),
  crop region and applied zoom ratio (API 30+). With the physical camera's sensor size,
  pixel and active arrays, the output region is the crop region reduced by the zoom
  ratio, and the saved image is the largest centred crop of it with the output aspect.
  Angles are measured from the active-array centre, so for a centred digital crop
  `fov(z) = 2·atan(tan(fov(1)/2)/z)`; the angle is never divided by the ratio. `h` is
  across the image as opened, so portrait photos have `h < v`. On a logical
  multi-camera (for example main + ultrawide) the crop region is in the logical
  camera's coordinates, so it is applied only when the active physical camera is the
  unique one with the logical camera's sensor geometry and the result's focal length
  is one it lists; a different active lens omits the FOV. Without a usable result
  (none or several still results, API 28, or no active physical ID) the published
  characteristics apply: one focal length only, and no possible lens switch (below 1×,
  or a narrower lens that could cover the view). Each capture writes one host
  diagnostic line, `CAPTURE_FOV`, with the FOV source or `fov-omitted: <reason>`
  (`multiple-focal-lengths`, `physical-unknown`, `lens-switch-possible`,
  `no-geometry`, `focal-mismatch`, `crop-region-invalid`, `crop-off-centre`,
  `crop-unverifiable`), `tilt-heading-omitted: <reason>` when applicable, and camera
  facts only: no image, location or sensor values.

  **Centred optical axis.** The contract has no principal-point field: `fovDeg`,
  `tilt` and the heading all assume the optical axis passes through the saved
  image's centre (taken as the active-array centre). When the still result reports
  a crop region whose centre is more than **0.05°** off that axis (the larger of the
  horizontal and vertical angles, using the shortest candidate focal length, so the
  strictest), `fovDeg`, `fovSigmaDeg`, `tilt` and all heading fields are omitted
  (`crop-off-centre`); the characteristics fallback is not used for such a frame. The
  same applies to a crop outside the active array (`crop-region-invalid`) or one that
  cannot be checked for lack of sensor geometry (`crop-unverifiable`). 0.05° keeps the
  axis error well below 0.1° and still tolerates integer crop rounding (about 2–3
  pixels on a 1.4 µm, 4.4 mm phone camera). Supporting off-centre crops would need an
  explicit principal-point contract and consumer support.
  Distortion correction and lens tolerances are not modelled; `fovSigmaDeg` (always
  present with `fovDeg`, at least 0.5°) is 1° by default and 2° when the camera
  advertises distortion correction, which can change the saved crop. This host never
  enables video or preview stabilization for the capture.
- `tilt`: the gravity sample (raw accelerometer where there is no gravity sensor)
  nearest the exposure, in the solver's signs (`basis()` in [`resection.js`](aime/resection.js)):

  | Field | Positive means | Negative means |
  | --- | --- | --- |
  | `pitchDeg` | camera looks below the horizon | camera looks above it |
  | `rollDeg` | image's right side points down; horizon appears higher on the right | right side up; horizon higher on the left |

  The conversion uses the display rotation the photo was saved for, so a photo
  taken with rotation locked while the phone is sideways reports roll near ±90°.
  `sigmaDeg` is one standard deviation, never below 1°: √(1² + s²)/cos(pitch),
  where s is the angular RMS of the samples measured within 250 ms of the chosen
  one (hand motion). `ageMs` is that sample's age (above). Omitted for the front
  camera, mirrored or inconsistently oriented output, no sample within 250 ms, an
  accelerometer reading more than 1.5 m/s² from 1 g, or `sigmaDeg` above 10°
  (including poses within about 5° of vertical). The viewfinder's level readout
  uses a smoothed copy and is never the reported value.
- `headingDeg`: azimuth of the rear camera's optical axis from the rotation-vector
  sensor, clockwise from **magnetic** north (`headingRef: "magnetic"`; no
  declination is applied because the capture carries no location). A weak hint
  only. `headingAccuracyDeg` is the sensor's own accuracy estimate and is always
  present with the heading; `headingAgeMs` is the sample's age. All heading fields
  are omitted for the front camera, when the sensor reports unreliable accuracy or
  no contact, gives no accuracy estimate (no uncertainty is invented), estimates
  worse than 45°, has no sample within 1 s, or the optical axis is within about 15°
  of vertical.

Orientation sensors run only while the API 0.13 viewfinder is in the foreground;
the host keeps at most the last 5 s of samples and no stream reaches the module.

Source implementation: `CaptureMetadata.kt` (pure derivations), `CaptureSensors.kt`
and `PhotoCaptureActivity`. JVM coverage is `CaptureMetadataTest` (validation, FOV,
tilt in all four display rotations and both signs, sample timing including delayed
delivery, fresh samples and clock mismatch through an injected clock, heading
omission, result shape, version gating) and `PhotoIdentityTest`; the exact-APK staging check is
`scripts/android-runner/capture_metadata.py` ([reproduce](reproduce.md)).

## Allow screenshots — API 0.13 source candidate

Module sessions that can show image pixels (`image.read`, which `photos.library`
requires) run with Android's secure-window flag, so screenshots and screen
recordings come out black. Module access offers a per-module **Allow screenshots**
switch for those modules, off by default. When on, that module's session drops
the flag. On Android 13+ the Recents thumbnail stays hidden
(`setRecentsScreenshotEnabled(false)`); on older Android the thumbnail follows the
flag, and the switch's text says so. The native viewfinder always keeps the flag.
The choice is stored with the module's install record (`allowScreenshots`), survives
update and rollback, and is forgotten when the module is removed. It is a host
setting: it applies whatever API version the module declares, and modules cannot
read or change it. JVM coverage is `ScreenCaptureTest`; the staging check above
also covers it.
