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

- **Photo-first workspace** fits above a fixed collapsed-controls reserve (pre-merge review correction); expanded controls can temporarily overlap it. The Construct
  corner menu keeps its reserved top-right square; nothing of ours goes there.
- **Bottom sheet** holds everything else. Collapsed height is one row (current
  result or the next instruction). Expanded shows the measurement list and
  actions. Photo size never depends on sheet content, which is the brief's
  "image must not move" rule, now structural rather than reserved-height.
- **Status becomes a top-left chip**, one line. Long errors expand persistently
  in the sheet as selectable text, not in an expiring toast. Instruction text
  lives in the sheet header, not above the photo.
- **Setup state collapses.** After "Confirm", the size field disappears into a
  `◼ Marker 95 mm ✓` chip. Tapping the chip reopens setup. A quality chip is
  deferred until the detector exposes observable diagnostics (see Tier X).
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
| Tap on photo | Place the next point (A, then B; slice 1 edits one pair) |
| Drag from a handle | Move that point, loupe shown while dragging |
| One-finger drag on empty photo | Pan (only when zoomed in) |
| Pinch | Zoom 1×–6× around the pinch centre |
| Double tap | No separate gesture in slice 1; taps place immediately, pinch/Reset handle zoom |
| Undo | Remove the last placed or moved point |

- **Loupe.** While a handle is being dragged, draw a 96dp circle offset 72dp
  above the finger (flipped below near the top edge) showing a 2.5× crop of the
  source bitmap centred on the point, with a crosshair. No grid: a photo-space
  grid cannot show constant physical spacing under perspective without owner
  geometry. The loupe reads pixels from the decoded bitmap already in memory;
  no new decode. Hidden on release.
- **Handles.** 24dp touch radius, 6dp drawn radius, labelled A/B with the label
  offset away from the line so the finger never covers it. Selected pair is
  yellow, other pairs are muted (see Tier 2). Every line and handle is drawn
  twice: a dark 7dp stroke under a 3dp coloured stroke, so it reads on light and
  dark photos.
- **Length label** sits at the line midpoint in a pill with a dark background,
  rotated to follow the line only when the angle is under 45°. It shows the
  current unit and one decimal. Formatting and rounding come from the owner;
  the overlay draws the string it is given.
- **Rejection feedback.** When the owner rejects a point (horizon, far from
  marker), the handle stays at the last accepted position and the sheet shows
  the owner's reason. No inferred "safe area" shading: marker distance alone
  does not establish where projection is trustworthy.
- **Non-drag adjustment.** The sheet has selectable A/B endpoint controls with
  nudge arrows, so fine placement does not depend on dragging or on a steady
  hand. Each nudge is one owner move (begin, preview, commit).
- **Undo** replaces "Clear endpoints". History lives in the owner; one complete
  drag or one nudge is one entry. "Clear all" is an owner action in the sheet.
- **Haptics:** only through the view's performHapticFeedback path, which honours
  system settings and needs no permission. Deferred if it proves unreliable.

## Tier 2 — Multiple measurements and saving

- **Pairs.** A completed A–B becomes measurement 1 and the next tap starts C–D.
  Colours cycle through four contrasting hues. Cap at twelve per photo.
- **List** in the sheet: colour dot, label (editable, default "A–B"), value,
  delete. Tapping a row selects it, brings it to the front and makes its handles
  draggable. Swipe left to delete, with undo.
- **Units** toggle cm / mm / in, remembered as a preference in the host's
  existing shared preferences. Never round-trips through module JS.
- **Projects and exports are separate.** A saved project is the clean decoded
  image plus a versioned record of calibration and geometry (marker corners,
  side length, points in normalised photo coordinates, units) in private module
  storage, reopened as editable measurements. An export is a separate flattened
  copy with the overlay drawn in, written through the existing gallery-export
  path. Neither touches the original file. Each needs its own explicit consent
  and manifest capability, off by default, because the current grant promises
  "no photo or result saved". The workspace greys both buttons with "Enable in
  Module access" until granted. Private project storage does not exist yet and
  is owner work in slice 2.

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
  needed". Alpha 16 links only reachable OpenCV code, so GrabCut and contour
  operations can grow the native library and must be measured first. Native
  work is not reliably cancellable by a timer alone; treat this as a bounded
  experiment in slice 3, with manual outline as the fallback.
- Area carries the same plane assumption as lengths, stated once in the sheet
  footer, not on every result.

## Tier X — Additions worth considering

- **Take photo here.** A camera button in setup that opens the existing
  `CameraActivity` capture and returns to the workspace, so the picker round
  trip disappears for the common case. Reuses the camera grant.
- **Calibration quality chip.** Only from observable detector output: marker
  pixels per side and corner-shape diagnostics. Map to hints such as "move
  closer" or "reduce angle". No error band and no accuracy claim; the small
  initial experiment did not establish a tolerance. Deferred until the detector
  exposes those values.
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

## Adjustments accepted from Astra's review (2026-09-14)

- Delivery in three slices: placement (Tier 0–1), multiple measurements and
  saving (Tier 2), shapes (Tier 3). This PR scopes the first slice only.
- Zoom, pan and rotation never alter underlying photo coordinates; the overlay
  only ever emits normalised photo points.
- Rotation retains work in memory; backgrounding and grant revocation keep the
  existing explicit cleanup. No restore after process death.
- Editable projects and gallery exports are separate things: a clean image plus
  versioned calibration/geometry for reopening, and a flattened annotated copy
  for export, each behind explicit consent.
- The quality chip reports observable marker quality (pixels per side, tilt),
  not an accuracy promise. The "safe area" vignette is dropped; rejection
  messages remain the feedback for out-of-plane points.
- Auto outline is a bounded experiment, always editable, never a one-tap result.

## Interface between overlay and activity (agreed, slice 1)

Fable owns `MeasureOverlay.kt`, `MeasureSheet.kt` and `MeasureViewport.kt`
(pure, testable fit/zoom/pan/hit-test helpers). Astra owns authoritative
state, geometry validation, Undo history, `MeasureActivity` integration,
rotation retention and the Android acceptance runner. The wireframe's list,
save and shape screens are future states, not slice-1 acceptance.

```kotlin
enum class MeasureEndpoint { A, B }
enum class DragPhase { BEGIN, PREVIEW, COMMIT, CANCEL }
sealed class EditResult { object Accepted; data class Rejected(val reason: String) }
data class MoveRequest(val photoRevision: Long, val id: Int, val endpoint: MeasureEndpoint,
                       val phase: DragPhase, val point: MeasurePoint?)   // point required for PREVIEW/COMMIT
data class Measurement(val id: Int, val a: MeasurePoint, val b: MeasurePoint?, val label: String?)

@Composable fun MeasureOverlay(
    photo: ImageBitmap, photoRevision: Long, enabled: Boolean,
    corners: List<MeasurePoint>, measurements: List<Measurement>, selectedId: Int?,
    onPlace: (photoRevision: Long, MeasurePoint) -> EditResult,
    onMove: (MoveRequest) -> EditResult,
    onSelect: (photoRevision: Long, id: Int?) -> Unit,
    modifier: Modifier = Modifier)
```

Rules: points are normalised coordinates of the orientation-correct decoded
photo. Viewport and gesture state are keyed by `photoRevision`; every event
carries the revision captured when its gesture began, and the owner ignores
stale ones. The overlay never computes lengths or units; `label` is the owner's
formatted string. Results are values, never exceptions across the pointer
coroutine. The overlay displays only owner-accepted positions: a rejected
preview leaves the handle where it was, CANCEL restores the drag-start point,
one complete drag is one Undo entry on the owner side. Taps in padding, over
the sheet or in reserved controls are ignored; crossing the photo edge never
clamps to a new point; a second finger or pointer cancellation never commits
a placement. Hit-testing, pinch/drag arbitration and the loupe are UI-only.
The loupe samples `photo` directly. No bitmap, URI or value leaves the overlay.
