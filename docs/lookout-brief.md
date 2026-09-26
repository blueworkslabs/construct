# Lookout — landmark identification by resection (module brief)

Status: planning brief, slice 0. Nothing here is a shipped contract. Owner of
the plan: Fable. Implementation: Clawd. Review and staging acceptance: Astra.
Hardware test: the pilot tester. The working name **Lookout** (`dev.construct.lookout`)
is a placeholder pending a surveyor-inspired name. **Review hold:** the reference
solver is an experiment, not yet an approved implementation dependency; see
[review decisions](#review-decisions-before-slice-1).

## Purpose

Take a photo from a viewpoint, tap a thing in it, and see on a map what it
probably is. No cloud vision, no photo leaves the phone. The module turns the
tap into a **compass bearing from where you stood** and ranks named map
features along that bearing. Marking one landmark you already recognise in
the photo (a church tower, a summit) calibrates the bearing far better than
the phone compass could under the model's assumptions; two sufficiently
well-separated marks can also constrain the lens. This is bearing calibration
with an already-known viewer position, not recovery of that position by resection.

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

Conclusion: API 0.11 supports a constrained prototype, but does not provide
shutter-synchronised position/direction or durable photo identity. The proposed
full flow must resolve those limitations and the geometry review below before
implementation. The compass is an optional later aid, not an existing input.

## User flow (v1)

1. **Open** → library grid of the module's photos (up to 8) plus **Take photo**.
   Copy states plainly: "Use the main rear camera, not ultrawide or zoom.
   Lookout saves an estimated viewpoint with each photo, then saves the
   direction you calibrate by marking a known landmark."
2. **Take photo** → native viewfinder. The module can take a pre-viewfinder
   `location.read` fix, but must not label it the shutter position: the user
   may wait or move indefinitely in the native viewfinder. After `{saved:true}`,
   obtain a post-return fix (respecting the 15-second request floor), retain its
   timestamp/accuracy/approximate flag, and compare it with the earlier fix if
   available. The API may return a cached fix up to 120 seconds old; fetching
   again does not guarantee a new measurement. Show the estimated viewpoint and
   fix age for confirmation/correction; keep the photo unlocated if the fix is
   missing, stale or inconsistent. Do not query/rank against a guessed position.
   List/open and sidecar association must follow the identity rules below.
3. **Photo view** → the photo, fit to the viewport, pinch-zoomable (reuse the
   Sky Watch map gesture code). A thin **bearing ruler** along the top shows
   compass degrees once calibrated; before calibration it shows "Mark a
   landmark you know to calibrate".
4. **Mark a landmark** → tap the tower/summit in the photo → a name search over
   the features already fetched for this position (typed filter, nearest first)
   → pick → the ruler snaps to the calibrated bearings. A second mark is
   offered ("Mark another for a sharper lens fit"), never required.
5. **What's that?** → tap anywhere else → a **candidates sheet**: up to five
   features ranked by score, each with name, kind, distance, and signed angular offset from the
   tap. Tapping a candidate opens the **map view**: the viewer dot, the tap ray
   as a wedge of width 2σ, marks as solid pins, candidates as numbered pins.
6. **Delete photo** → native confirmation (existing `photos.library` op); only
   `{completed:true}` permits removing its sidecar. Native photo deletion and
   `storage.kv` cleanup are separate operations, not an atomic transaction.
   Retain pending cleanup and reconcile orphaned metadata when library/storage
   access is next available. Cancel preserves both. Host-managed photo deletion
   can also leave metadata until reconciliation; never claim immediate erasure
   of both stores on the current API.

Compass-only mode (when the optional orientation API exists): steps 4 and 5
work without a mark, with a wide wedge (σ ≈ 12°) and "could be" wording.

## Math (reference implementation: `docs/lookout/resection.js`)

- Pinhole model, roll ≈ 0 **and pitch ≈ 0**. This is not a general model of an
  elevated viewpoint looking down: pitch/roll make bearing depend on image row
  too. Current synthetic scenes do not exercise either. A column `x ∈ [0,1]` across the photo sits at
  horizontal angle `θ(x) = atan((x − ½)·2·tan(f/2))` from the optical axis,
  where `f` is the horizontal field of view. Bearing of the column:
  `heading + θ(x)`. The tan makes wide lenses non-linear; do not use a linear
  ruler.
- **Default FOV:** 70° across the long edge (typical main lens). A portrait
  photo gets `2·atan(tan 35° · short/long)` across its width. Ultrawide is out
  of scope and the capture copy says so.
- **One mark** at column `x₁` with true bearing `β₁ = bearing(viewer, mark)`:
  `heading = β₁ − θ(x₁)`. Compass error is gone; residual is tap precision
  (~0.7°), viewer/OSM position error and the FOV guess (grows away from the
  reference mark, including at the centre when the reference is near an edge).
- **Two marks:** minimise the bearing residual over `f ∈ [20°,120°]` by golden
  section; for each `f` the best heading is the circular mean of `βₖ − θ(xₖ)`.
  Mark sets with less than 5° bearing or projected-column spread fall back
  to one-mark behaviour and say so. This basic degeneracy guard does not yet
  establish sufficient conditioning for the remaining fits.
- **Three or more:** same least-squares fit, residual reported as RMS.
- **Experimental uncertainty** per tap: `σ² = tap² + compass² (compass-only) + FOV-guess
  term (no second mark) + residual²`. This σ sizes the wedge on the map and
  the score. Review found this estimate incomplete; do not display it as a
  calibrated confidence interval until the blockers below are fixed.
- **Ranking:** `score = exp(−½ (Δ/σ)²) · far · weight`, where Δ is the signed
  bearing difference, `far` halves candidates beyond 40 km (peaks may set a
  larger `maxKm`), and `weight` is a visibility prior from tags (peak with
  `ele` 1.5, tower/mast/cathedral 1.3, castle/monument 1.1, viewpoint 0.8,
  generic attraction 1.0). Sort by log-score to preserve ordering when scores
  underflow. Show up to five with Δ and a "no close matches" state when all are
  far off the ray; do not present arbitrary distant matches as likely answers.
- **Position from three marks (no GPS)** requires a separate resection solver
  and suitable geometry; it is **out of scope** for v1 and not implemented here.

Synthetic results (`scripts/test_lookout_resection.cjs`, 1000 one/two-mark scenes,
500 three-plus-mark scenes and 500 ranking scenes, tap noise 0.5 % of width,
GPS 15 m, OSM 5 m, landmarks 2–25 km away, main lens 62–78° with 70°
guessed, deterministic seed; the test prints the measured numbers):

| Calibration | Bearing error | Notes |
| --- | --- | --- |
| One mark, tap within a fifth of the frame of it | median 1.1°, p90 2.0° | compass error gone |
| One mark, tap at the far edge | p90 5.8° | limited by the FOV guess |
| Two marks (≥5° apart) | p90 1.7° over sampled columns; FOV recovered to median 0.9° | 17 % of random pairs were too close and fell back honestly |
| Three or more marks | p90 0.7°, RMS residual median 0.2° | least squares |
| Compass only (σ 12°) | wedge, no point answer | |

Ranking against eight decoys in one frame (dense: one per ~9°): after one
mark the tapped landmark ranks first in 77 % of scenes and in the top three in
99 %; compass-only keeps it in the top three in 72 %. That is why the sheet
always shows several candidates with their angular offsets and never a single
answer. These are zero-pitch/zero-roll synthetic results, not field accuracy,
coverage of close or coarse-location cases, or validation of the reported σ.

## Data: features, queries, storage, consent

**Overpass query, once per confirmed photo position and selected radius**
(10/30/60 km picker, default 30 km; example below is 30 km),
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
- The 400-element cap is a partial dataset, not the nearest or most visible
  400 landmarks; OSM output order must not be mistaken for relevance. At the
  cap, label results incomplete and offer a smaller radius. Preserve OSM
  element **type plus id**, since node/way/relation numeric ids can overlap.
- Overpass is expected to return `application/json` for `[out:json]`; the host's
  2 MiB cap still applies and a count limit does not guarantee byte size. The
  host's 15-second total/8-second read deadlines can expire before the query's
  20-second server limit. Handle size/MIME/transport failures explicitly, not as
  empty results. If the public instance answers 429
  or 504, show the reason and offer a retry; do not loop. Verify the deployed host's fixed
  User-Agent against the selected public instance's policy before release. Name search is a
  local filter over this set, so no per-keystroke requests.
- What leaves the phone: **a confirmed position and the selected radius** to Overpass, and
  tile coordinates to OpenStreetMap. Never the photo, never the marks.
- **Sidecar per photo** (`storage.kv`, key `photos`): provisional shape
  `{ identity, viewer: {lat, lon, accuracyM, timestamp, approximate}, radiusKm,
  fov, marks: [{x, y, osmType, osmId, name, lat, lon}], heading? }`.
  Automatically save available metadata after capture; save derived heading
  only after calibration. No per-photo storage opt-in beyond the declared grant.
  Identity is a design decision below, not a capture-order index: an 8×8 average
  hash can collide for different dark/foggy/similar photos. If a module-only
  prototype uses SHA-256 of the normalized raster, match by unique digest, not
  index; identical rasters, decode changes and uncertain associations must fail
  closed, never inherit a possibly unrelated viewpoint/marks. A digest is not a
  unique capture ID. Bound names and mark counts so all eight sidecars fit 64 KiB.
- **Consent text** (manifest reasons): `location.read` "Record where you stood
  when you take a photo, so taps can be turned into compass bearings."
  `storage.kv` "Save, per photo, where you stood, the landmarks you marked and
  the lens estimate. After photo deletion, metadata is cleaned up when this
  module can next access its library and storage." `net.http` "Fetch named
  map features around your photo position and map tiles."
- Module storage never holds the photo pixels; originals stay in the host's
  private photo store as today.

## Host additions (optional, ordered by value)

1. **Stable per-photo id in `photos.library list`** (small): removes the
   unsafe index+perceptual-hash workaround. Review recommendation: an opaque,
   module-scoped persistent ID alongside the existing short-lived `ref` is a
   compatible response extension, but alpha31 does not return it. Keep `ref` as
   the only live authority for open/delete/export; never accept stable IDs as
   paths or authorization. IDs must survive reopen/update and distinguish
   identical captures, without exposing filenames or EXIF. A module that
   **requires** this guarantee needs a versioned host/API addition (proposed
   API 0.12), not an unchanged 0.11 minimum pretending all alpha31 hosts have it.
   This PR does not implement or approve that host change.
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
  fetch, 10/30/60 km radius picker and local name search; one/two-mark calibration
  using the reference solver **after review fixes**; candidates sheet; map view built from the Sky Watch map
  class (tiles, pan/zoom, ray wedge, pins). Shared `construct-ui.css`. Unit
  tests for sidecar identity/reconciliation, Overpass parsing and radius changes. Deterministic fixture
  module (like Synthetic Sky) that injects a known photo, position and feature
  set so the emulator can prove the flow without a real horizon.
- **Slice 1 acceptance (Astra):** codex review; runner script covering grants
  denied/granted, capture → sidecar, mark → calibrated ruler, tap → candidates
  → map, delete → sidecar gone, offline/429 paths, rotation, 2× text; fixture
  proves the ranking on known inputs. Small fixes applied directly, larger ones
  surfaced in the channel.
- **Hardware (pilot tester):** one photo from a public elevated viewpoint with a known
  tower; mark it; tap two other things; report whether the right answers land
  in the top three and how the wedge looks. That is the real accuracy test.
- **Slice 2 (later):** compass-only and live mode once the orientation API
  exists; elevation angle from pitch plus `ele` tags to separate near/far;
  on-device edge snapping for taps; second-mark UX polish.

## Copy and UX rules

- Ranked results say "could be", show signed angular offset and distance, and keep the
  runner-up visible. No single-answer wording until the user confirms a mark.
- The capture screen says main rear camera only, and distinguishes the estimated
  viewpoint saved with the photo from direction derived after marking. A signed
  candidate offset is not a ± uncertainty or a probability of identification.
- Errors name the gate: location denied, internet denied, Overpass busy.
- Same header, buttons, chips, help block and status line as Sky Watch 0.3.

## Product choices confirmed 2026-09-26

- Automatically save available position/calibration metadata per photo; no
  repeated per-photo save prompt. This does not fabricate unavailable direction.
- Provide a 10/30/60 km radius picker, default 30 km.
- Seek a surveyor-inspired name. **Laussedat** is a suggestion after Aimé
  Laussedat, a pioneer of surveying from photographs; the final name is open.
  [Historical background](https://en.wikipedia.org/wiki/Aim%C3%A9_Laussedat).

## Review decisions before slice 1

Do not hand the current solver to implementation unchanged or claim emulator
acceptance for this planning-only PR.

1. **Geometry scope:** choose an explicitly constrained near-level-photo pilot
   with unsupported pitch/roll limitations, or a 2D calibration/levelling design
   covering the elevated, downward-looking use case. Two horizontal marks do not
   solve arbitrary pose. This is a product/model decision, not a cosmetic fix.
2. **Uncertainty and conditioning:** include FOV error relative to the calibration
   marks, positional accuracy/distance, and lens-fit conditioning; reject or
   downgrade inconsistent, clustered and underdetermined fits. Add adversarial
   tests, not just averages over distant level scenes. A zero residual with two
   marks is not evidence of an accurate fit.
3. **Durable identity:** choose the new stable-photo-ID host contract or a clearly
   limited fail-closed digest prototype. Specify capture interruption and orphan
   reconciliation; native photo storage and module metadata are not atomic.

Fable owns revising this plan; Clawd implements the agreed design. Astra repeats
Codex review, then stages the signed fixture/module. Hardware feedback precedes
the implementation merge. This hold is not a request for a new approval ritual:
the current numerical and API guarantees are not yet established.
