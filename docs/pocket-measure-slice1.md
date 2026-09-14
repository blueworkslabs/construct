# Pocket Measure: placement UX integration

This is the first slice of the [UX proposal](pocket-measure-ux-proposal.md), built on
its isolated overlay, viewport and controls components. It intentionally retains
one A–B measurement, no persistence and no gallery export. The existing
`photo.measure` grant and JavaScript `open`-only boundary are unchanged.

## Behaviour

- The photo fits above a stable collapsed-controls reserve. Expanding the internally
  scrolling sheet may temporarily cover more of the image, but changing instructions,
  results or control expansion never refits it or changes photo coordinates.
- Confirming the measured marker size collapses setup. The chip preserves decimal
  sizes; reopening setup invalidates the previous calibration and measurements.
- Tap places A, then B. Further taps do not silently replace the completed pair.
  Drag either handle to correct it, with a 2.5× crosshair loupe. Only accepted
  owner coordinates are drawn. Rejected positions retain the last accepted point.
- Taps place immediately on release; double-tap zoom is intentionally absent. Pinch supports 1×–6× and
  one-finger pan works while zoomed. A zoom indicator offers an explicit fit reset.
- Endpoint A/B buttons expose one decoded-photo-pixel nudges without requiring a
  precise drag. Each nudge is one Undo action.
- Drag previews are transactional. Release commits one Undo entry regardless of
  move count. A second pointer, pointer cancellation, rotation during a drag or
  Back cancels the drag and restores its pre-drag state. Clear is undoable; the
  in-memory history is capped at ten committed edits.
- Rotation retains the decoded photo, confirmed calibration and measurement in
  the same activity. The viewport resets to fit for its new dimensions; source
  coordinates do not change. Actual backgrounding, process recreation and
  revocation still discard the transient workspace. The explicit photo-picker
  handoff is the existing lifecycle exception, and clears the old selection.

## Ownership and integration fixes

`MeasureEditor` owns validation, projective lengths, labels, photo/calibration
revision and Undo. `MeasureActivity` owns grants, generation/lifecycle guards and
bitmap lifetime. `MeasureOverlay` owns only display transforms and gestures.
`MeasureSheet` is owner-driven; it does not independently retain measurement state.

Integration additionally refreshes callback/state reads inside the long-lived
pointer coroutine and preserves a centred square loupe crop
at photo edges. Pinch uses the previous focal point before translating to the new
centroid. Owner revisions reject stale events without propagating exceptions to
Compose. An independent gesture revision lets non-gesture actions cancel input
without changing photo coordinates or unnecessarily resetting zoom.

No detector, model, native library, Android permission, photo-storage or module
bridge feature is added. Process-death persistence, multiple lines, editable saved
projects, flattened exports, polygons, camera handoff and assisted outlines remain
later slices. The same-plane/approximate-measurement limits still apply; no accuracy
badge or inferred safe-area vignette is shown.

## Verification and acceptance record

The current exact-artifact delivery status, optimized Android receipts, artifact
hashes and hosted CI are recorded in [integration PR #7](https://github.com/blueworkslabs/construct/pull/7).
That checkpoint distinguishes diagnostic runs from optimized pilot acceptance;
passing a debug run alone does not authorize a pilot handoff.

- 121 JVM tests cover the existing host contracts plus viewport mapping, moving
  pinch centroids, symmetric loupe crops and transactional owner edits. The runner
  has 43 unit tests under optimized Python; 24 build/publisher script tests pass.
- Diagnostic receipt `20260914T155152Z-3a035c70` passed all 22 measurement checks on
  application source `20f4873`, APK SHA-256
  `9c562a2fc5022966c1e863ba09bc4495b49b217f87199186ac2610a25eba4332`.
  Flat, perspective and EXIF fixtures measured 240 mm; confirming a 95 mm marker
  scaled the flat fixture to 228 mm. Both font layouts (720/1.3 and 480/1.8), drag
  Undo, Back and pointer cancellation, nudges, double-tap/pinch/pan, rotation,
  background/process cleanup, revocation and original-byte checks passed. The
  emulator stopped cleanly. This is explicitly a **non-optimized diagnostic** run.
- Earlier receipts are retained as failures: `20260914T152435Z-0053950d` exposed
  Confirm being covered by the IME; `20260914T154302Z-7f4b893c` used the Canvas's
  occlusion-clipped accessibility bounds as if they were its full layout;
  `20260914T154830Z-629c145b` reached gesture passes but stopped on a mismatched
  test-driver double-tap keyword. None counts as a full pass.

The keyboard correction uses resize insets and pads only the sheet for the IME.
The runner uses the labelled photo viewport with the controls collapsed. The
viewport reserves the collapsed sheet height (including scaled text), independently
of current result/error text or expanded controls. It still requires correct independent fixture
lengths and fixed full workspace bounds across endpoint/result changes. Control
taps wait for stable rectangles. No observer restart or screenshot-only pass is used.

Screenshots of this secure workspace may be blank; no visual acceptance is
inferred from those captures. Physical finger/loupe feel remains a focused device
check, separate from the synthetic geometry and lifecycle receipts.

## Pre-merge UX review follow-up

The alpha 17 Pixel placement/rotation check was reported successful. Fable and
Codex reviewed `860a2b0`; the remaining three UI findings are addressed in the
follow-up candidate (verification status lives on PR #7):

- Immediate placement on release; pinch and Reset own zoom, with no timer or
  delayed tap jobs.
- Fit reserves a fixed, font-aware collapsed-controls height. Expanded controls
  may temporarily cover the photo but do not refit it. Collapsed error feedback
  uses the existing two-line text area, not an additional layout row.
- Rejected PREVIEW updates feedback quietly; accepted previews clear it. Only
  tap, BEGIN or COMMIT rejection expands controls. CANCEL preserves feedback.

The Android checks now cover bottom-edge placement at fit, consecutive taps,
quiet invalid drag previews, plus pinch/pan/Reset and the existing coordinate,
large-font and lifecycle cases. Slice-2 suggestions remain deferred.

### Connector review: endpoint selection after Undo

The connector identified stale endpoint selection when Undo removed B. The owner
now normalizes selection on every editor refresh (including cleanup/reset), keeping
only an endpoint present in the current measurement. The Android regression selects
B then undoes its placement, repeats for A, and verifies Clear/Undo cannot revive
stale nudge controls. Geometry and Undo history semantics are unchanged.
