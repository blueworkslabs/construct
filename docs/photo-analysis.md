# Selected-photo analysis — alpha 13

Native **Find faces** and **Find objects** analyze the selected private photo,
only after a user tap. Both use bundled CPU models: no photo upload and no app-time
model download. The module bridge still only opens the camera workspace. No
model results, bitmaps, paths or export authority are passed to JavaScript.

## Contract and limits

- Use the same EXIF-oriented software bitmap displayed in the album, limited to
  1024 pixels per edge. Normalized boxes use matching Fit letterboxing.
- BlazeFace short-range float16 v1 reports up to 20 face regions above score 0.5.
  It is optimized for selfie-like images; small/distant/obscured faces may be
  missed. It does not identify people or infer emotions.
- EfficientDet Lite0 int8 v1 reports up to five objects in its common COCO
  categories, above score 0.5. Labels/scores are estimates, not guaranteed
  identification or calibrated probabilities; arbitrary objects are unsupported.
- Model creation/inference/closure run on the native worker, one request at a
  time. Close/background still ends the workspace. Native inference may finish
  after Close; session/generation/access guards discard late results.
- Changing photo, returning to camera or closing clears results. They are not
  saved, exported or sent to module code. A final module-grant and Android-camera
  check precedes display. Originals/gallery copies are never modified. Diagnostic
  completion events omit counts, labels, boxes, scores, filenames and images.

## Reproducible offline runtime

`python3 scripts/prepare_fixtures.py` also prepares vision assets. Alternatively
run `python3 scripts/prepare_vision.py` with JDK 17 available. Versioned URLs,
sizes and hashes are pinned in `scripts/vision-assets.json`. Models, generated
AARs and test images are ignored by Git; mismatched bytes are rejected.

The packaged upstream MediaPipe Tasks 0.10.35 core selects remote stats logging
and includes Android DataTransport dependencies. Construct reproducibly replaces
its factory with the provided `TasksStatsDummyLogger`, removes remote logger
implementations and excludes DataTransport. This is an explicit third-party
binary modification, not a claim about upstream defaults. See
`scripts/local_mediapipe.py` and `third_party/mediapipe/TasksStatsLoggerFactory.java`.
The compile-only Android type stub is not included in the AAR. A JVM regression
requires the no-op logger. Runtime notices/license accompany the APK assets.

Optimized builds also need `core/app/vision-proguard.pro`: MediaPipe JNI bindings,
Flogger's stack-sensitive caller discovery and Protobuf Lite's reflective message
fields must survive shrinking. Exact-build Android testing found two failures
that debug inference did not: Flogger static initialization after inlining, then
missing `Any.typeUrl_` during native graph serialization. Neither failed run is
counted as a detector pass. Hosted CI now builds the optimized variant as well as
debug; device inference remains a separate acceptance gate.

The runtime is Apache-2.0; models remain upstream assets, not Construct-authored
MIT code. See the official documentation/model cards for
[faces](https://ai.google.dev/edge/mediapipe/solutions/vision/face_detector) and
[objects](https://ai.google.dev/edge/mediapipe/solutions/vision/object_detector).

## Verification scope

Local tests cover stale-result generations, malformed coordinates, Fit geometry,
no-op logging and asset integrity. The optimized candidate below passed all seven
offline vision checks, followed by camera/gallery and host sections across the
scoped runs below. A blank-image pass is not positive detection proof.

The `--camera-only --camera-vision-only --camera-version … --camera-sha256 …`
scope uses the disposable synthetic-camera AVD. It injects verified licensed
fixtures into an empty private album, restores non-root ADB and disables
networking **before first inference**. It checks positive face/cat results, an
EXIF-rotated face, blank negatives, result clearing, unchanged JPEG bytes and
sanitized diagnostics. Full camera/gallery and host baselines remain separate.

The NASA astronaut image is public domain; Chelsea the cat is CC0 by Stefan van
der Walt, as documented in
[scikit-image's versioned data descriptions](https://github.com/scikit-image/scikit-image/blob/v0.19.3/skimage/data/_fetchers.py).
These are public test photos, not synthetic faces or operator personal data.
They are not bundled in the phone APK. Physical detection quality and overlay
alignment require a focused Pixel check. The pre-existing direct-Reopen
accessibility limitation is not claimed fixed.

### Optimized vision receipt

- Native source: `e5d4ce8`; alpha 13 APK SHA-256:
  `3093571752a82dd00a6f8ad6c6b5d65c4b80731e5d0eb71cca6a7c1969cb55dc`.
- Android 16 emulator run `20260913T221106Z-a44eaabd`: seven checks passed,
  complete receipt, non-root ADB restored, emulator stopped.
- First face inference with networking disabled; rotated face positive; blank
  face/object negatives; CC0 cat positive; background clearing; all four JPEGs
  byte-identical; sanitized diagnostic completion events.
- The earlier diagnostic debug run also passed, but is not reused as optimized
  acceptance. Earlier linkage/protobuf/setup failures remain separately recorded.
- Native camera screens retain screenshot protection. This receipt proves native
  result text and lifecycle behavior, not visual overlay alignment; the latter
  remains a focused physical-device check.

### Camera/gallery and host follow-through

All entries below use the same optimized APK hash above:

- `20260913T221534Z-558d5cc7`: all 12 camera/gallery checks passed. Full scoped
  receipt, non-root ADB restored, emulator stopped.
- `20260913T222948Z-0c0cf4bf`: all five checklist checks, probes
  **5 BLOCKED / 6 CONTAINED / 0 FAIL**, and renderer recovery passed. The parent
  run later failed when navigating from Tones back to Diagnostics; it is not
  reported as a complete suite pass.
- `20260913T224113Z-eea8de4f`: clean continuation passed seven tone and five
  consent checks, including the installed APK diagnostic hash. Complete scoped
  receipt and stopped emulator. Physical audibility was not retested here.
- Two earlier checklist runs and one tone continuation hit the existing missing
  WebView accessibility descendants issue. Screenshots showed rendered content;
  those failures were not converted to passes. Experimental observer restarts
  were never invoked in the passing runs and were removed from the driver.

Local verification: 96 JVM tests pass, lint has no errors (17 warnings), and
39 runner tests pass. The app signer and module publisher remain unchanged for
the operator pilot, with no added Android permission. The universal APK is about
56 MB because it bundles both models and native runtimes for four ABIs. Model
hashes, APK signature and 16 KB ZIP alignment were checked. Pixel detection quality
and overlay placement remain pending; report behavior, not personal photos.
