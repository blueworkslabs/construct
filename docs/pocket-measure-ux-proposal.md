# Pocket Measure — UX proposal (Fable, 2026-09-14)

Response to `pocket-measure-ux-brief.md` after the alpha 16 Pixel pass. Scope is
the native `MeasureActivity` workspace. Every item below keeps the proven
marker → confirm size → two endpoints geometry; nothing here changes
`MeasurePlane`, `MeasureDetector` or the module/JS boundary. Wireframe:
`docs/images/pocket-measure-wireframe.png` (three screens: measure, setup, shape).

Tiers are delivery order, not importance. Tier 0 and 1 are the usability fixes
the brief asked to separate from features; 2 and 3 are the human's feature list.

## Tier 0 — Layout: photo first

Today the photo sits under a title, two buttons, a three-line status box, the
size field, a headline result and a "Clear endpoints" button. On a Pixel at the
default font the photo gets roughly half the screen; at large fonts, less.

- **Full-bleed photo** fills the workspace under the safe insets. The Construct
  corner menu keeps its reserved top-right square; nothing of ours goes there.
- **Bottom sheet** holds everything else. Collapsed height is one row (current
  result or the next instruction). Expanded shows the measurement list and
  actions. Photo size never depends on sheet content, which is the brief's
  "image must not move" rule, now structural rather than reserved-height.
- **Status becomes a top-left chip**, one line, truncating with a tap-to-expand
  toast for long errors. Instruction text lives in the sheet header, not above
  the photo.
- **Setup state collapses.** After "Confirm", the size field disappears into a
  `◼ Marker 95 mm ✓` chip. Tapping the chip reopens setup. A second chip shows
  calibration quality (below).
- **Large fonts:** only the sheet scrolls. The photo, chips and handles are
  density-based, not text-based. This replaces the current `statusHeight`
  reservation and the `horizontalScroll` on the result.
- **Rotation:** retain the activity across configuration changes the way
  `ModuleActivity` does, keeping the decoded bitmap in memory. Process death
  still finishes without restoring (FLAG_SECURE rule unchanged). Re-picking the
  photo after an accidental tilt is the single most annoying thing in the
  current flow.

## Tier 1 — Endpoint placement and correction

Gesture vocabulary, chosen so nothing is ambiguous:

| Gesture | Effect |
|---|---|
| Tap on photo | Place the next point (A, then B; then a new pair) |
| Drag from a handle | Move that point, loupe shown while dragging |
| One-finger drag on empty photo | Pan (only when zoomed in) |
| Pinch | Zoom 1×–6× around the pinch centre |
| Double tap | Toggle 1× / 3× zoom at that spot |
| Undo | Remove the last placed or moved point |

- **Loupe.** While a handle is being dragged, draw a 96dp circle offset 72dp
  above the finger (flipped below near the top edge) showing a 2.5× crop of the
  source bitmap centred on the point, with a crosshair and 1-cm grid derived from
  the marker plane. The loupe reads pixels from the decoded bitmap already in
  memory; no new decode. Hidden on release.
- **Handles.** 24dp touch radius, 6dp drawn radius, labelled A/B with the label
  offset away from the line so the finger never covers it. Selected pair is
  yellow, other pairs are muted (see Tier 2). Every line and handle is drawn
  twice: a dark 7dp stroke under a 3dp coloured stroke, so it reads on light and
  dark photos.
- **Length label** sits at the line midpoint in a pill with a dark background,
  rotated to follow the line only when the angle is under 45°. It shows the
  current unit and one decimal. Rounding rule: cm to one decimal under 100 cm,
  whole cm above, never more digits than the ±0.5 cm evidence supports.
- **Rejection feedback.** When `project()` rejects a point (horizon, far from
  marker), the handle snaps back and the chip says why in the existing message.
  Additionally, shade the photo region where projection is unreliable with a
  faint vignette computed from the same bounds, so people see the safe area.
- **Undo** replaces "Clear endpoints". Keep a small stack of the last ten
  actions. "Clear all" lives in the sheet's overflow.
- **Haptics:** a light tick on point placement and on handle release. Needs the
  VIBRATE permission, which is normal-tier and prompt-free.

## Tier 2 — Multiple measurements and saving

- **Pairs.** A completed A–B becomes measurement 1 and the next tap starts C–D.
  Colours cycle through four contrasting hues. Cap at twelve per photo.
- **List** in the sheet: colour dot, label (editable, default "A–B"), value,
  delete. Tapping a row selects it, brings it to the front and makes its handles
  draggable. Swipe left to delete, with undo.
- **Units** toggle cm / mm / in, remembered as a preference in the host's
  existing shared preferences. Never round-trips through module JS.
- **Save copy** writes a new JPEG with the overlay burned in to the module's
  private album, reusing the camera album and gallery-export path that already
  exist, plus a small JSON sidecar (marker size, units, points in normalised
  photo coordinates, values). The original file is never touched. This needs
  its own capability line in the manifest, `photo.measure.save`, off by default,
  because the brief scopes saving separately and the current grant promises
  "no photo or result saved". The workspace shows the button greyed with
  "Enable saving in Module access" until granted.
- **Reopen a saved copy**: the sidecar lets us restore editable measurements on
  the saved JPEG. This is what makes "save" worth more than a screenshot.

## Tier 3 — Shapes and area

- **Polygon mode** from the sheet's "Shape" button. Taps add vertices, tapping
  the first vertex or "Done" closes it. Vertices drag with the loupe. Long-press
  on an edge inserts a vertex; drag a vertex onto the trash chip to delete it.
- **Area and perimeter** computed in the marker plane: project every vertex,
  shoelace on the projected polygon, times side². Perimeter is the sum of
  projected edge lengths. Rejects self-intersecting polygons with a message.
  Shown as `≈ 148 cm² · edge 46 cm`. Same rounding discipline as lengths.
- **Rectangle shortcut**: tap three corners, the fourth is inferred in the plane.
  Covers boxes, cards, tiles with three taps.
- **Auto outline (bonus, clearly labelled).** Tap inside the item, run a bounded
  GrabCut with the tap as the foreground seed and the marker excluded, take the
  largest contour, simplify with Douglas-Peucker to at most 24 vertices, and hand
  the result to the manual editor. It is a starting point, never a result: the
  user always sees editable vertices and the sheet says "Auto outline, adjust as
  needed". OpenCV is already bundled, so no size cost. Time-box to two seconds
  on the worker; on timeout, offer manual outline.
- Area carries the same plane assumption as lengths, stated once in the sheet
  footer, not on every result.

## Tier X — Additions worth considering

- **Take photo here.** A camera button in setup that opens the existing
  `CameraActivity` capture and returns to the workspace, so the picker round
  trip disappears for the common case. Reuses the camera grant.
- **Calibration quality chip.** From the detector we already know marker pixel
  size and corner geometry. Map to Good / Fair / Poor with a hint ("move
  closer", "less tilt") and an honest error band. Cheap and it teaches people
  how to take better photos without a manual.
- **Remembered size** prefilled from last time but still requiring Confirm, per
  the brief. Show "Last used 95 mm" under the field.
- **Recovery screens.** No marker: show the photo anyway with a card showing
  what the detector needs, and one-tap "Choose other photo" or "Take photo".
  Two markers: outline both in red, "Use only one card". Cancelled picker:
  stay where you were, no status change.
- **Back behaviour.** With a bottom sheet expanded, Back collapses it; with
  handles being dragged, Back cancels the drag; otherwise Back closes the
  workspace as now.

## Acceptance additions

- Synthetic fixture with a known square: area within 2% and perimeter within 1%.
- Handle hit-testing: a tap inside 24dp of an existing point moves it, outside
  places a new one, on both densities used by the runner.
- Loupe renders the correct source crop for a known point (pixel checks).
- Large-font stress: photo bounds identical before and after every status,
  result and list change, extending the existing `c7bdd34` test.
- Rotation retains points and measurements; process death still finishes.
- No new strings or values in diagnostics.

## Suggested split

Fable: Compose overlay and sheet (Tier 0, 1, list and units from Tier 2, polygon
editor UI in Tier 3) on this branch, geometry untouched. Astra: save/sidecar and
grant, rectangle inference, auto outline, camera hand-off, runner checks.
