# Bounded image APIs — API 0.10 implementation contract

This branch implements the Measure migration; it is not a claim about alpha28.
Delivery requires both a new host and a newly signed Pocket Measure module.

## Ownership

The module owns reference-ID selection, minimum marker-edge policy, homography,
calibration, measurement units, placement/drag/nudge/undo, zoom/pan and all ordinary
screens. Native code owns the system image picker, bounded decoding, per-run image
authority and a model-free OpenCV marker-detection primitive. No measurement
workflow or domain result belongs in that primitive.

## `image.read` (fresh explicit consent, denied by default)

- `{op:"pick"}` opens Android's single-image picker. No caller URI/path, persistent
  grant or broad media permission. It returns `{handle,url,width,height,mime}`.
  The URL is a run-private same-origin raster resource, not an original provider
  URI. The `construct-images/` path prefix is reserved only for modules declaring
  `image.read`; older modules retain their packaged-resource paths. Replacing the
  image invalidates the previous handle. User cancellation is
  `IMAGE_CANCELLED`; no image is selected automatically.
- `{op:"release",handle}` discards that run's image. Unknown/expired/foreign
  handles fail `IMAGE_STALE`. One current image and one pending operation per run.
  Chooser launches have a two-second floor; detection calls a one-second floor.
- Original encoded input <=20 MiB, source dimensions <=12000 each; software-decoded,
  EXIF-oriented working image <=1600 each with longest side <=1600. Rendered PNG
  <=12 MiB; original EXIF, filename, URI and provider metadata never reach JS.
- Host checks declared capability, fresh grant, current package digest and active
  foreground session before selection, decoding, delivery and resource access.
  Reusing the old `photo.measure` grant cannot authorize these pixels.
- The system picker is the only deliberate background exception. The module is
  paused while it is open; unrelated privileged requests are cancelled or their
  replies invalidated. A result
  can be delivered only after the same activity resumes and authority is checked
  again. A replaced/closed session cannot receive it. Ordinary backgrounding,
  closure and process recreation discard the entire run and image authority.
- Native menu pause invalidates pending work, but an already delivered image may
  remain visible after returning. Rotation retains the session. In-memory image
  bytes are never written to a native album/cache. Decode/detection are serialized
  globally; a cancelled worker must finish before another can start. Decode or
  detection has a 15-second delivery deadline; no late results are accepted.

## `image.markers`

`{op:"detect",handle,dictionary:"DICT_4X4_50"}` returns
`{dictionary,markers:[{id,corners:[{x,y},…]}]}` with four normalized, ordered corners
per marker and at most 64 detections. All dictionary IDs may be returned, including
repeated IDs. The module chooses which reference and how many are acceptable.
No marker-side length, calibration, length/result formatting or endpoint input is
accepted. Only this fixed dictionary is initially implemented; unknown dictionaries
and fields fail. Requires both its own grant and live `image.read` authority.
Detection reads only the current run's opaque handle; no path/image uploads.

Selected-image module windows retain Android’s secure-window protection against
ordinary screenshots/screen recording. Synthetic emulator display capture, if
available, is an operator-owned test surface, not an app capability.

## Data composition and limits

Trusted install/access text explains that selected pixels reach module JavaScript.
Other granted storage/diagnostic APIs may retain data, and approved internet
sources may receive it. Revocation prevents future authorized access, not copies
already delivered. Pocket Measure declares no networking, storage or logging;
its application policy is transient local work only. The host does not claim that
these choices constrain a differently signed module with broader grants.

## Migration and acceptance

Preserve immutable old packages. Verify modern Measure with synthetic flat,
perspective and EXIF images, negative/multiple markers, offline detection,
calibration changes, placement/drag/nudge/undo, stable viewport, zoom/pan, rotation,
large text, picker cancellation, lifecycle and fresh consent. Verify two signed
module versions changing real measurement behavior and rollback on an identical
APK. The candidate removes the legacy implementation after core prototype checks;
publishing/promoting that retirement requires the full optimized-APK checks above
and the installed-version transition. `photo.measure` uses the same explicit
update-required/data-preserving boundary as Sky.
