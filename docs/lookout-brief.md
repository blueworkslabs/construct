# Lookout — landmark identification by resection (module brief)

Status: planning brief, slice 0. Nothing here is a shipped contract. Owner of
the plan: Fable. Implementation: Clawd. Review and staging acceptance: Astra.
Hardware test: Dario. The working name **Lookout** (`dev.construct.lookout`)
is a placeholder until Dario picks one.

## Purpose

Take a photo from a viewpoint, tap a thing in it, and see on a map what it
probably is. No cloud vision, no photo leaves the phone. The module turns the
tap into a **compass bearing from where you stood** and ranks named map
features along that bearing. Marking one landmark you already recognise in
the photo (a church tower, a summit) calibrates the bearing far better than
the phone compass could; marking two also calibrates the lens.

This is a spotting aid with an honest shortlist, not an oracle. Every answer
shows the bearing, the angular distance and the distance to the candidate.

## What exists today (API 0.11 candidate, alpha31)

| Need | Available | Notes |
| --- | --- | --- |
| Take a photo into module-private storage | `camera.photo {op:"capture"}` | Native shutter; returns only `{saved:true}`. 8 photos per module. |
| Show the photo, take taps | `photos.library {op:"list"|"open"}` + `image.read` | Opened image ≤1024 px per edge, EXIF-orientation corrected. Refs are per run; no stable id, no EXIF, no date. |
| Where you stood | `location.read {op:"get"}` | One fix, accuracy in m; no altitude. |
| Which way the phone pointed | none | Compass/orientation is **not** in the API. Optional host addition, see below. |
| Lens field of view | none | Assumed from aspect ratio; refined by a second mark. |
| Map features | `net.http` with declared origins | Overpass (`https://overpass-api.de`) JSON; OSM tiles for the map. |
| Remember per-photo data | `storage.kv` | 100 keys, 64 KiB per module. |

Conclusion: the full photo flow is buildable on the current API. The compass
is a nice-to-have that improves the "no mark yet" state and enables a live
mode later.

## User flow (v1)

1. **Open** → library grid of the module's photos (up to 8) plus **Take photo**.
   Copy states plainly: "Use the main camera, not ultrawide. Lookout saves
   where you stood and which way you looked with each photo."
2. **Take photo** → native viewfinder. Immediately before capture the module
   takes one `location.read` fix (the user tapped a button, so this is the
   same consent shape as Sky Watch). After `{saved:true}` the module lists the
   library, opens the newest photo and stores its sidecar (below).
3. **Photo view** → the photo, fit to the viewport, pinch-zoomable (reuse the
   Sky Watch map gesture code). A thin **bearing ruler** along the top shows
   compass degrees once calibrated; before calibration it shows "Mark a
   landmark you know to calibrate".
4. **Mark a landmark** → tap the tower/summit in the photo → a name search over
   the features already fetched for this position (typed filter, nearest first)
   → pick → the ruler snaps to the calibrated bearings. A second mark is
   offered ("Mark another for a sharper lens fit"), never required.
5. **What's that?** → tap anywhere else → a **candidates sheet**: up to five
   features ranked by score, each with name, kind, distance, and "±N°" from the
   tap. Tapping a candidate opens the **map view**: the viewer dot, the tap ray
   as a wedge of width 2σ, marks as solid pins, candidates as numbered pins.
6. **Delete photo** → native confirmation (existing `photos.library` op); the
   module removes the sidecar in the same step.

Compass-only mode (when the optional orientation API exists): steps 4 and 5
work without a mark, with a wide wedge (σ ≈ 12°) and "could be" wording.

## Math (reference implementation: `docs/lookout/resection.js`)

- Pinhole model, roll ≈ 0. A column `x ∈ [0,1]` across the photo sits at
  horizontal angle `θ(x) = atan((x − ½)·2·tan(f/2))` from the optical axis,
  where `f` is the horizontal field of view. Bearing of the column:
  `heading + θ(x)`. The tan makes wide lenses non-linear; do not use a linear
  ruler.
- **Default FOV:** 70° across the long edge (typical main lens). A portrait
  photo gets `2·atan(tan 35° · short/long)` across its width. Ultrawide is out
  of scope and the capture copy says so.
- **One mark** at column `x₁` with true bearing `β₁ = bearing(viewer, mark)`:
  `heading = β₁ − θ(x₁)`. Compass error is gone; residual is tap precision
  (~0.7°), OSM placement and the FOV guess (matters only towards the edges).
- **Two marks:** minimise the bearing residual over `f ∈ [20°,120°]` by golden
  section; for each `f` the best heading is the circular mean of `βₖ − θ(xₖ)`.
  Marks closer than 5° in bearing cannot separate `f` from heading; fall back
  to one-mark behaviour and say so.
- **Three or more:** same least-squares fit, residual reported as RMS.
- **Uncertainty** per tap: `σ² = tap² + compass² (compass-only) + FOV-guess
  term (no second mark) + residual²`. This σ sizes the wedge on the map and
  the score.
- **Ranking:** `score = exp(−½ (Δ/σ)²) · far · weight`, where Δ is the signed
  bearing difference, `far` halves candidates beyond 40 km (peaks may set a
  larger `maxKm`), and `weight` is a visibility prior from tags (peak with
  `ele` 1.5, tower/mast/cathedral 1.3, castle/monument 1.1, viewpoint 0.8,
  generic attraction 1.0). Show the top five with Δ; never hide the runner-up.
- **Position from three marks (no GPS)** is the same maths and is explicitly
  **out of scope** for v1.

Synthetic results (`scripts/test_lookout_resection.cjs`, 1000 scenes per
case, tap noise 0.5 % of width, GPS 15 m, OSM 5 m, main lens 62–78° with 70°
guessed, deterministic seed; the test prints the measured numbers):

| Calibration | Bearing error | Notes |
| --- | --- | --- |
| One mark, tap within a fifth of the frame of it | median 1.1°, p90 2.0° | compass error gone |
| One mark, tap at the far edge | p90 5.8° | limited by the FOV guess |
| Two marks (≥5° apart) | p90 1.8° anywhere; FOV recovered to median 0.9° | 16 % of random pairs were too close and fell back honestly |
| Three or more marks | p90 0.7°, RMS residual median 0.2° | least squares |
| Compass only (σ 12°) | wedge, no point answer | |

Ranking against eight decoys in one frame (dense: one per ~9°): after one
mark the tapped landmark ranks first in 77 % of scenes and in the top three in
99 %; compass-only keeps it in the top three in 72 %. That is why the sheet
always shows several candidates with their ±° and never a single answer.

## Data: features, queries, storage, consent

**Overpass query, once per photo position** (radius 30 km, bounded output),
cached in memory for the session and reused for marks and candidates:

```
[out:json][timeout:20];
(
  nwr(around:30000,LAT,LON)["name"]["natural"="peak"];
  nwr(around:30000,LAT,LON)["name"]["man_made"~"^(tower|mast|lighthouse|windmill|chimney|water_tower|communications_tower)$"];
  nwr(around:30000,LAT,LON)["name"]["building"~"^(cathedral|church|chapel|castle|tower|mosque|synagogue|temple)$"];
  nwr(around:30000,LAT,LON)["name"]["historic"~"^(castle|monument|tower|fort|ruins)$"];
  nwr(around:30000,LAT,LON)["name"]["tourism"~"^(attraction|viewpoint)$"];
  nwr(around:30000,LAT,LON)["name"]["aeroway"="aerodrome"];
);
out tags center 400;
```

- Ways/relations come with `center`; nodes with `lat/lon`. Keep `name`,
  `ele`, `height`, the matching kind tag and the OSM id. Drop everything else.
- Overpass returns `application/json` for `[out:json]`, within the host's
  2 MiB JSON cap at this radius and count. If the public instance answers 429
  or 504, show the reason and offer a retry; do not loop. The host's fixed
  User-Agent satisfies the instance's identification policy. Name search is a
  local filter over this set, so no per-keystroke requests.
- What leaves the phone: **one position and a 30 km radius** to Overpass, and
  tile coordinates to OpenStreetMap. Never the photo, never the marks.
- **Sidecar per photo** (`storage.kv`, key `photos`): `{ index, hash, viewer:
  {lat, lon, accuracyM}, fov, marks: [{x, y, osm, name, lat, lon}], heading? }`.
  `index` is the capture-order position; `hash` is an 8×8 average hash of the
  opened image so a mismatch after an unexpected library change is detected
  rather than silently attaching data to the wrong photo. Deleting a photo
  through the module removes its sidecar and re-indexes.
- **Consent text** (manifest reasons): `location.read` "Record where you stood
  when you take a photo, so taps can be turned into compass bearings."
  `storage.kv` "Save, per photo, where you stood, the landmarks you marked and
  the lens estimate. Deleting the photo deletes this." `net.http` "Fetch named
  map features around your photo position and map tiles."
- Module storage never holds the photo pixels; originals stay in the host's
  private photo store as today.

## Host additions (optional, ordered by value)

1. **Stable per-photo id in `photos.library list`** (small): removes the
   index+hash workaround. Ask Astra whether this fits the 0.11 contract.
2. **One-shot orientation read** `orientation.read {op:"get"}` →
   `{azimuthDeg, pitchDeg, rollDeg, accuracy}` sampled once, same consent
   shape as `location.read`: enables compass-only mode and a later live
   "What's that?" mode. Not needed for v1.
3. **Lens FOV / capture returns the new ref**: nice, superseded by the second
   mark; lowest priority.

## Slices and acceptance

- **Slice 0 (this PR):** brief, reference solver, synthetic test in CI.
- **Slice 1 (Clawd):** module `examples/lookout-module` on API 0.11: library +
  capture + sidecar; photo view with taps and bearing ruler; Overpass feature
  fetch and local name search; one/two-mark calibration using the reference
  solver unchanged; candidates sheet; map view built from the Sky Watch map
  class (tiles, pan/zoom, ray wedge, pins). Shared `construct-ui.css`. Unit
  tests for sidecar handling, Overpass parsing and hash. Deterministic fixture
  module (like Synthetic Sky) that injects a known photo, position and feature
  set so the emulator can prove the flow without a real horizon.
- **Slice 1 acceptance (Astra):** codex review; runner script covering grants
  denied/granted, capture → sidecar, mark → calibrated ruler, tap → candidates
  → map, delete → sidecar gone, offline/429 paths, rotation, 2× text; fixture
  proves the ranking on known inputs. Small fixes applied directly, larger ones
  surfaced in the channel.
- **Hardware (Dario):** one photo from a public elevated viewpoint with a known
  tower; mark it; tap two other things; report whether the right answers land
  in the top three and how the wedge looks. That is the real accuracy test.
- **Slice 2 (later):** compass-only and live mode once the orientation API
  exists; elevation angle from pitch plus `ele` tags to separate near/far;
  on-device edge snapping for taps; second-mark UX polish.

## Copy and UX rules

- Ranked results say "could be", show "±N°" and distance, and keep the
  runner-up visible. No single-answer wording until the user confirms a mark.
- The capture screen says main camera only, and that position and direction
  are saved with the photo.
- Errors name the gate: location denied, internet denied, Overpass busy.
- Same header, buttons, chips, help block and status line as Sky Watch 0.3.

## Open questions for Dario

1. Name: Lookout, or something else?
2. Save the sidecar automatically on every capture (proposed), or ask per photo?
3. Is a 30 km feature radius the right default, or should the viewpoint choose
   10/30/60 km like Sky Watch's radius picker?
