# Pocket Measure: placement UX integration

This is the first slice of the [UX proposal](pocket-measure-ux-proposal.md), built on
its isolated overlay, viewport and controls components. It intentionally retains
one A–B measurement, no persistence and no gallery export. The existing
`photo.measure` grant and JavaScript `open`-only boundary are unchanged.

## Behaviour

- The photo occupies a stable full-size surface behind a collapsible, internally
  scrolling controls sheet. Changing instructions, results or control expansion
  never changes the photo's coordinate system.
- Confirming the measured marker size collapses setup. The chip preserves decimal
  sizes; reopening setup invalidates the previous calibration and measurements.
- Tap places A, then B. Further taps do not silently replace the completed pair.
  Drag either handle to correct it, with a 2.5× crosshair loupe. Only accepted
  owner coordinates are drawn. Rejected positions retain the last accepted point.
- Double tap toggles fit/3× without placing either tap; pinch supports 1×–6× and
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
pointer coroutine, waits out double-tap detection before single placement, cancels
pending taps on viewport/session changes, and preserves a centred square loupe crop
at photo edges. Pinch uses the previous focal point before translating to the new
centroid. Owner revisions reject stale events without propagating exceptions to
Compose. An independent gesture revision lets non-gesture actions cancel input
without changing photo coordinates or unnecessarily resetting zoom.

No detector, model, native library, Android permission, photo-storage or module
bridge feature is added. Process-death persistence, multiple lines, editable saved
projects, flattened exports, polygons, camera handoff and assisted outlines remain
later slices. The same-plane/approximate-measurement limits still apply; no accuracy
badge or inferred safe-area vignette is shown.

## Verification checkpoint

Implementation verification is in progress. Do not treat the UI component compile
or pure unit tests alone as Android gesture/lifecycle acceptance. Exact artifact
hashes, scoped device receipts, packaging/size checks and hosted CI will be recorded
here before a pilot handoff. Screenshots of this secure workspace may be blank;
no visual acceptance is inferred from such captures.
