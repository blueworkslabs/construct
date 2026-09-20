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
