# Camera hybrid boundary: prototype results

This records a **debug emulator experiment**, not optimized alpha31 acceptance or
physical-phone performance. The API and retirement candidate remain under review.

## What was actually moved

The released Camera performs analysis on saved photos, not continuous video.
CameraX still provides the live viewfinder and explicit human shutter. The host
also retains bounded local face/object inference. The signed module owns the
album, selected photo, analysis actions, result list, boxes and score filtering.
Neither entire album screens nor camera application logic hide behind a generic
native Activity. Native capture has only preview, camera switching, shutter and
cancel. The new grants require explicit consent to expose private-photo pixels.

## Controlled comparison

Both versions ran on the same debug APK (`cc6f3d8`) and pinned Android API37
WebView, with two virtual CPUs and SwiftShader. Each controlled probe measured
four real inference requests with no concurrent accessibility dumps/screenshots.
The metrics include native processing, request-to-result turnaround, animation
frame gaps during the request, and time through two subsequent animation frames.
They are small samples, not an FPS guarantee or a precise compositor latency.

Camera 0.2.0 repeatedly resized its canvas backing store and animated busy status.
Camera 0.2.1 retains the backing store when dimensions are unchanged and removes
the continuous busy animation. Both changes were tested together; this experiment
does not attribute the improvement to either change individually.

- Before: face result turnaround 665–738 ms, objects 891–1066 ms; maximum
  animation-frame gaps during inference 200–283 ms.
- After: faces 201–213 ms, objects 416–522 ms; maximum gaps 28–50 ms.
  Native processing itself took 155–176 ms for faces and 403–511 ms for objects.
- The after version's idle probe produced 117 frames in about two seconds,
  median gap 16.7 ms, maximum 33.3 ms.
- **Repeated full-canvas painting remains poor**: 16 frames during the after
  stress probe, median gap 216.7 ms, maximum 300 ms. This is not a viable
  high-frame-rate canvas pipeline on this emulator.

The ordinary UI-automated run also recorded much worse frame gaps (200–267 ms)
while accessibility polling was active. Those values are retained, not discarded
or represented as the controlled figures. No inference-time smoothness claim is
based on screenshots alone. Each native request recreates/closes its detector;
“warm” means later requests in the same process, not a retained warm detector.

[Sanitized full samples and checks](evidence/camera-prototype-2026-09-18.json).

## Functional prototype

The final debug scope passed 13/13 checks: fresh denial, independent Android
permission, native cancel/shutter, interruption releasing the camera, trusted
photo deletion, offline inference, EXIF/blank/object fixtures, actual orientation
and 2× text, confirmed gallery export, backgrounding, independent analysis
revocation, and byte-identical private originals. Synthetic camera input and
licensed test photos were used; secure-window protection remained enabled.

Earlier attempts remain incomplete. Failures included unreachable/scrolled
controls, an unsupported WebSocket context manager, a rotation that had not taken
effect, and taps on accessibility nodes clipped outside the controls panel.
The runner now asserts real dimensions and visible panel bounds. One wrong-catalog
attempt was deliberately stopped; it is not evidence for either module version.
The 0.2.0 functional run was incomplete even though its controlled timing samples
finished. Optimized replacement, migration and same-APK workflow update/rollback
are [separate exact-artifact scopes](camera-alpha31-acceptance.md), not implied
by these debug results.

## Conclusion and limits

The measured boundary is promising for the **existing saved-photo feature**.
It supports continuing with a module-owned workflow and reusable native capture
and computation, without transporting video frames through JSON or JavaScript.
It does **not** demonstrate realtime video analysis in a WebView, nor prove that
such a design is impossible. Full-canvas stress is a concrete limitation here;
physical GPU-backed devices and a purpose-built stream path would need a separate
experiment. The current extraction must not be marketed as that experiment.

## First optimized-candidate visual rejection

Source `e153819` passed the alpha30-to-alpha31 migration scope (6/6), but its
expanded functional run exposed a separate native acquisition bug: the default
CameraX SurfaceView preview drew outside its Compose bounds in landscape,
covering the heading and reducing control contrast. That APK is not accepted.
The run was stopped after reviewing the actual emulator display; functional
button assertions alone would not have caught the visual defect.

The old native camera explicitly used `PreviewView.ImplementationMode.COMPATIBLE`
(TextureView). Restoring that setting is an acquisition-layout correction, not a
change to module inference or evidence of a WebView video limitation. A corrected
optimized build requires fresh exact-artifact scopes. The debug measurements
above ran on the separate, saved-photo module screen with the native preview
closed; they remain debug measurements, not replacement-APK acceptance.

The compatible-mode-only build (`7fad73a`) still showed overflow in its real
landscape capture and was also stopped/unaccepted. The final correction
(`b11381e`) gives the
Android preview an explicit containing Box, clips both the Compose container and
Android view, uses fit-center scaling, and separates viewfinder from scrollable
acquisition controls in landscape. A focused native layout probe preceded the
final optimized acceptance scopes; their results are linked above. No module bytes
or inference policy changed with this native-layout investigation; native capture
remains acquisition-only.
