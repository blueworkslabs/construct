# Camera extraction experiment — API 0.11 proposal

Status: implementation/retirement candidate, not a shipped contract or acceptance claim.
The native workspace is absent from the source candidate; alpha30 remains the
released baseline until exact-artifact replacement and migration acceptance.

## Question and boundary

The existing camera has a live native CameraX viewfinder, but face/object analysis
is user-requested **still-photo** inference. Feature parity does not require a
continuous frame stream into JavaScript. This experiment keeps a reusable visible
native acquisition surface and bundled inference native; the signed module owns
album navigation, selection, analysis presentation, overlays and ordinary UI.
No DEX loading, WebView camera permission, unrestricted URLs or filesystem access.

A high-frame-rate web video/inference pipeline is outside this first experiment.
Success here must not be presented as proof of that capability. If the measured
still-image boundary or native handoff is poor, retain the old implementation and
record the failure. Do not lower the acceptance threshold to finish the migration.

## Proposed contracts

API 0.11, with fresh independently enforced native opt-in grants:

- `camera.photo {op:"capture"}` opens only a visible native viewfinder, switch
  camera, shutter and Cancel. A human shutter saves one photo under the existing
  per-module private store and returns `{saved:true}`. No automatic shutter, live
  frames, filenames or album UI. Android CAMERA remains separate. Capture is
  canceled by background/rotation; the module handoff returns on foreground resume.
- `photos.library {op:"list"}` returns up to eight session-scoped opaque refs in
  capture order, without filenames, dates, EXIF or paths. `open` with a ref requires
  `image.read` and yields its bounded image handle/PNG URL, at most 1024 pixels per
  edge. `delete` and `export` require a trusted native confirmation showing the
  selected image; module code cannot confirm either action. Export requires API29.
  The fresh grant explicitly exposes this module's pre-existing private photos,
  not the phone's general gallery. No private-photo bytes change during migration.
- `image.analyze {op:"detect",handle,kind:"faces"|"objects"}` requires
  `image.read` and consumes that session's current image, from either the Android
  picker or the private-photo library. Reuse the existing offline models, 0.5
  threshold, at most20faces/5objects, normalized boxes/labels/scores,1024pixel limit.
  No identities, emotions, new models, model downloads or analysis persistence.

Image handles additionally retain their source authority: library images need
`photos.library` on resource reads and inference delivery, not only on selection.
`photos.library` and `image.analyze` declarations require `image.read`; optional
flags cannot bypass dependencies. The old `camera.capture` grant authorizes none
of these. A current grant/digest/session check precedes asynchronous data delivery
and committing any photo mutation. Menu/close/revocation cancel pending work;
a native task may finish later, but its result cannot revive a canceled session.
Human capture/confirmation has no artificial JS timeout. Native processing has a
15s deadline, one process-wide worker/slot, no unbounded queue, and 1s inference
spacing. Native image selection/normalization avoids base64 traffic over the bridge.

Storage keeps8photos,4MiB/file,20MiB/module,64MiB/global. Existing camera-photos
layout remains unchanged. Selected raster and analysis are transient; private
originals survive module replacement, capture cancel, process death and supported
rollback. Retired legacy rollback will be explicit, only after replacement proof.

## Verification and decision

Host+module delivery is necessary for new authority/API; subsequent album/overlay
workflow changes must be module-only. Prototype the image+inference+Canvas path
before retiring anything. Record timings for native inference, image acquisition,
bridge turnaround, canvas render and interactive UI responsiveness; distinguish
emulator from physical-phone results. Use actual synthetic frames/screenshots,
not fabricated benchmark numbers. Record cold/warm and face/object cases.

Then verify default denial, fresh grants, per-source revocation, malformed/cross-
session refs, bounded jobs, timeout/cancellation, capture handoff, both orientations
and large text, real offline inference, trusted delete/export cancellation and
success, EXIF, private original hashes, lifecycle and diagnostics. Upgrade from
alpha30 with pre-existing private photos; verify fresh authority and preserved
bytes. Demonstrate a real module workflow update and rollback on identical APKs.
The candidate removes legacy CameraActivity only after prototype parity evidence;
shipping that removal requires all exact-artifact replacement and migration scopes
to pass. Until then alpha30 remains the released baseline.

User explicitly accepts a demonstrated hybrid limitation as a valid learning.
A failed probe or incomplete scope stays a failure/incomplete, never acceptance.

Material agent assistance: Astra/Codex implementation and verification.

## Prototype instrumentation

The debug-only runner can read `window.cameraMetrics` through the local WebView
debugger to capture native inference time, bridge turnaround, animation-frame
count and the largest frame gap while waiting. This requires `websocket-client`
in the runner environment. The measured image content is never logged. Debug
probes are separate from optimized APK acceptance; debugger access is not enabled
in a pilot build. Report actual samples rather than assuming 60 fps from the use
of requestAnimationFrame.
