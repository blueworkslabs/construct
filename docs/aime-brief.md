# Aimé — landmark identification from a photo (module brief)

Status: planning brief, slice 0, **revision 3** after Astra's Codex review of
the first draft. Nothing here is a shipped contract. Plan owner: Fable.
Implementation: Clawd. Review and staging acceptance: Astra. Hardware test:
the pilot tester. Name chosen by the project owner: **Aimé**
(`dev.construct.aime`), after Aimé Laussedat, who surveyed from photographs
in the 1850s ([background](https://en.wikipedia.org/wiki/Aim%C3%A9_Laussedat)).

Revision 2 resolved the first review's three decisions: a full camera pose
model with optional horizon levelling, uncertainty propagated from the fit, and
a stable photo id as a small versioned host addition. **Revision 3** answers
the re-review: the viewer position error is now one shared, fitted offset
rather than independent per-mark noise, and each candidate gets its own
comparison σ. Details in [Review decisions](#review-decisions-revisions-2-and-3).
The proposed photo-ID contract is documented separately; no API 0.12 host has
been implemented by this PR.

## Purpose

Take a photo from a viewpoint, tap a thing in it, and see on a map what it
probably is. No cloud vision, no photo leaves the phone. The module turns the
tap into a **compass bearing from where you stood** and ranks named map
features along that bearing. Marking one landmark you already recognise in
the photo (a church tower, a summit) calibrates the direction far better than
the phone compass could; marking two also constrains the lens; tapping the
horizon levels the picture. This is bearing calibration from a reported
viewer position; the fit may estimate an offset when the geometry allows, with
the reported accuracy as a prior rather than a hard maximum error. The fitted
viewpoint is an estimate, not a replacement location measurement.

This is a spotting aid with an honest shortlist, not an oracle. Every answer
shows the candidate's bearing, its signed offset from the tap, its comparison
±σ, and the distance. The map ray has a separate direction uncertainty.

## What exists today (API 0.11 candidate, alpha31)

| Need | Available | Notes |
| --- | --- | --- |
| Take a photo into module-private storage | `camera.photo {op:"capture"}` | Native shutter; returns only `{saved:true}`. 8 photos per module. |
| Show the photo, take taps | `photos.library {op:"list"|"open"}` + `image.read` | Opened image ≤1024 px per edge, EXIF-orientation corrected. Refs are per run: **no stable id**, no EXIF, no date. |
| Where you stood | `location.read {op:"get"}` | One fix, accuracy in m; no altitude. Cached fix may be up to 120 s old. |
| Which way the phone pointed | none | No orientation API. Direction is **derived** by marking, not captured. |
| Lens field of view | none | Assumed from aspect ratio; fitted from marks. |
| Map features | `net.http` with declared origins | Pre-built landmark cells from the `aime-data` repository on Cloudflare Pages (Overture Maps / OSM, ODbL); OSM tiles for the map. |
| Remember per-photo data | `storage.kv` | 100 keys, 64 KiB per module. |

Conclusion: API 0.11 supports the whole flow except **durable photo identity**.
That is a small additive host change (API 0.12, below) and is a prerequisite
for slice 1. Orientation capture stays a later, optional aid.

## User flow (v1)

1. **Open** → library grid of the module's photos (up to 8) plus **Take photo**.
   Copy: "Use the main rear camera, not ultrawide or zoom. Aimé saves an
   estimated viewpoint with each photo; direction comes from the landmarks you
   mark afterwards."
2. **Take photo** → native viewfinder. Before opening it the module takes a
   `location.read` fix; after `{saved:true}` it takes another (respecting the
   15 s floor) and keeps the later one with its timestamp, accuracy and
   `approximate` flag (compare fix timestamps, not request order). The user may have waited or walked in the viewfinder,
   so the fix is labelled **estimated viewpoint** with its age and can be
   corrected by dragging the dot on the map. Compare available before/after
   fixes: disagreement beyond their combined accuracy, an old fix or a long
   viewfinder wait requires viewpoint confirmation/correction before querying.
   A photo with no usable fix stays
   unlocated: no query, no ranking, a clear "set your viewpoint" prompt.
   Implemented thresholds (`aime-core.js`): a kept fix older than 120 s at the
   shutter (the host's cached-fix limit) or a viewfinder wait over 60 s sets
   `viewer.review`; only an explicit confirm or a map correction clears it.
   Associate the sidecar only when a successful before/after `list` comparison
   yields exactly one new stable id. Ambiguous or interrupted captures remain
   unlocated, never assigned by list position; a fix without a photo is discarded.
3. **Photo view** → the photo, fit to the viewport, pinch-zoomable (reuse the
   Sky Watch map gesture code). A thin **bearing ruler** along the top shows
   compass degrees for the active tap's row once calibrated (label that row;
   with tilt, a column does not have a single bearing); before that it reads "Mark a landmark you
   know to calibrate".
4. **Mark a landmark** → tap the tower/summit → a name search over the features
   already fetched for this viewpoint and radius (typed filter, nearest first)
   → pick → the ruler snaps to the calibrated bearings. A second mark is
   offered ("Mark another to fit the lens"), never required. Marks store the
   tapped `x, y`.
5. **Level the horizon** (optional, recommended for tilted photos) → "Tap two
   separated points on a known level horizon—not a mountain ridge, roofline or
   treetops" → the module draws the fitted level line across the photo. This
   solver assumes zero elevation, not an arbitrary skyline. Even a sea horizon
   dips below true level at an elevated viewpoint; without height/dip correction
   that input is approximate. Explain this before accepting taps and let users
   skip/remove them when no suitable level reference is visible. Show "level
   estimated" only when the fit supports it, not a guarantee that the chosen
   skyline was physically horizontal. Skipping retains pose-prior uncertainty.
6. **What's that?** → tap anywhere else → a **candidates sheet**: up to five
   features ranked by score, each with name, kind, distance, signed offset from
   the tap and that candidate's comparison ±σ. When no result has `close:true`
   (within its own 2σ), the sheet says "no
   close match" and shows the nearest two greyed. Tapping a candidate opens the
   **map view**: fitted viewer dot, tap ray as a wedge drawn from the fitted
   viewpoint with an inner band at ±1 direction σ and a fainter outer band out
   to ±2 direction σ (not a guaranteed 95% region), marks as
   solid pins, candidates as numbered pins.
   Candidate comparisons use their own σ, which can be wider; a nearby candidate
   offered by the sheet can therefore still lie outside the direction bands.
   Keep the reported/confirmed viewpoint and its accuracy visible separately
   when the fit moves it. Preserve that input in storage; do not overwrite it
   with the fit or quietly centre later feature queries on a derived position.
7. **Delete photo** → native confirmation (existing `photos.library` op); only
   `{completed:true}` removes the sidecar. Native deletion and `storage.kv`
   cleanup are separate operations; after every **successful complete** `list`
   the module drops sidecars
   whose id no longer exists, so an interrupted delete is reconciled on the
   next open when library and storage access succeed. A denied/failed list is
   not an empty library and must never erase sidecars.

Compass-only mode (when an orientation API exists): steps 4–6 work without a
mark, with a wide wedge (σ ≈ 12°) and "could be" wording.

## Maths (reference implementation: `docs/aime/resection.js`)

**Camera model.** Pinhole with full pose. Normalised pixel `(x, y)`, x across
from the left, y down from the top. With horizontal field of view `f` and
aspect `a = height/width`:

```
u = (x − ½)·2·tan(f/2)      v = (y − ½)·2·tan(f/2)·a      d = (u right, v down, 1 forward)
```

The pose is heading `H` (azimuth of the optical axis), pitch `p` (positive =
looking down) and roll `r`. The world ray is `F + u·R + v·D` with `F, R, D`
the forward/right/down axes after pitch about `R` and roll about `F`. Bearing
is `atan2(east, north)` of that ray; elevation is its angle above the
horizontal. A level camera reduces to `H + atan(u)`; looking down puts the
horizon above the centre at `v = −tan p`; roll tilts it.

**Observations and priors.** Every input becomes a weighted residual:

| Input | Residual | σ |
| --- | --- | --- |
| Mark k at `(xₖ, yₖ)` with known position | bearing of the pixel − bearing from the **fitted** viewpoint to the mark | `√(tap² + atan(feature placement / distance)²)`, placement 8 m for nodes, 30 m for way/relation centres |
| Horizon tap at `(x, y)` | elevation of the pixel − 0 | 0.7° |
| Compass heading (optional) | `H − Hc` | 12° |
| Lens prior | `f − 70°` (or the portrait default) | 8° (1° when the FOV is known) |
| Pitch prior | `p − 0` | 15° |
| Roll prior | `r − 0` | 5° |
| Viewpoint offset priors | `east − 0`, `north − 0` (metres from the reported fix) | the fix accuracy, each axis |

Tap σ is 0.7° (≈1 % of frame width). The viewer's position error is **one
shared unknown**: the fitted state includes an (east, north) offset from the
reported fix whose prior is the fix accuracy, and every mark residual and every
candidate bearing is evaluated from that shifted viewpoint. Adding marks can
therefore never average a single GPS error away; the covariance keeps the
ambiguity where the geometry cannot resolve it, and marks at different
distances can constrain the viewpoint estimate (ordinary resection). This is a
local Gaussian approximation with stated priors, not a guaranteed error bound.

**Fit.** Levenberg–Marquardt over `(H, f, p, r, east, north)` with a numeric
Jacobian, initialised from a level camera at the reported fix; six parameters,
a few dozen iterations; phone performance is not measured here. Observations that disagree beyond their stated precision inflate
the covariance by χ²/dof (when dof > 0). The result carries the state, the
fitted viewpoint, the 6×6 covariance and three flags: `lens: fitted|assumed`,
`level: fitted|assumed` and `viewpoint: refined|reported`, meaning the data
narrowed that parameter well below its prior or did not. Clustered, duplicate
or near-collinear marks therefore never manufacture a lens, and marks fanned at
one distance never manufacture a viewpoint: the priors hold and the flags say
"assumed"/"reported".

**Two uncertainties per tap.** Both are `√(tap² + gᵀ Σ g)` with `g` the
gradient of an angle with respect to the fitted state and `Σ` the covariance:

- **Direction σ** (the wedge on the map): the angle is the tap's bearing. It is
  smallest at the marks, grows towards the edges when the lens is assumed, and
  grows for rows far from the marks when the picture is not levelled.
- **Comparison σ** (per candidate): the angle is tap bearing − candidate bearing
  from the fitted viewpoint, plus the candidate's own placement over its
  distance. Because the candidate bearing shares the viewpoint offset with the
  marks, a candidate beside a mark inherits almost none of the position error
  (it cancels), while a candidate much nearer than the marks gets a wide σ.
  The sheet shows this σ; the map shows the direction σ.

**Ranking.** `logScore = −½(Δ/σ_c)² + ln(far) + ln(weight)`; Δ is the signed
bearing difference, `σ_c` the candidate's comparison σ, `far` halves candidates
beyond 40 km (peaks may set a larger `maxKm`), `weight` is a visibility prior
from tags (peak with `ele` 1.5, tower/mast/cathedral 1.3, castle/monument 1.1,
viewpoint 0.8, other 1.0). Sort by log-score so underflow never reorders. Each
result carries `close = |Δ| ≤ 2σ_c`. Up to five shown; "no close match" when
none is close.

The implementation's numerical search box is ±6 times the reported accuracy
**per offset axis**, not a one-accuracy-radius guarantee. Position accuracy is a
prior scale; a fitted shift is not proof that the reported fix was wrong.

**Out of scope for v1:** recovering a position without any reported/confirmed
viewpoint prior; elevation angles from `ele` tags; lens distortion.

**Synthetic results** (`scripts/test_aime_resection.cjs`, seeded; scenes have
lens 62–78° with 70° guessed, pitch −5…25° down, roll Gaussian σ=3° (not
clamped at ±5°), calibration-mark/horizon tap noise 0.5 % of
frame, GPS 15 m, OSM 5 m, landmarks 2–25 km; taps at random pixels; the test
prints the measured numbers; the bearing-coverage cases use exact query pixels,
while ranking also perturbs the target tap):

| Calibration | Bearing error | σ reported | 2σ coverage |
| --- | --- | --- | --- |
| One mark, random taps | median 1.6°, p90 5.0° | median 3.8° | 99 % |
| One mark, same row, 15 % of frame away | median 0.8°, p90 1.8° | | |
| Two marks, lens fitted (60 % of pairs) | median 0.9°, p90 2.9° | median 2.2° | 99 % |
| Two marks, lens assumed (close pairs) | median 1.2°, p90 3.7° | median 3.0° | 99 % |
| Two marks + horizon (the viewpoint case) | median 0.4°, p90 1.9°; pitch/roll p90 1.2° | median 1.3° | 100 % |
| Three or more marks, no horizon | median 0.5°, p90 2.1° | median 1.5° | 100 % |
| **Shared viewpoint error**, marks 0.1–2 km, fix 15 m, 1–6 marks: directions | median 0.9°, p90 3.0° | median 2.3° | 99.7 % |
| same scenes, candidate comparison 0.1–2 km | median 0.9°, p90 3.3° | median 2.4° | 99.7 % |
| Coarse fix 300–2000 m, marks 1–10 km: directions | median 2.8°, p90 11.4° | median 7.9° | 97.9 % |
| same scenes, candidate comparison 0.5–10 km | median 2.2°, p90 11.3° | median 6.4° | 98.3 % |

Review reproductions, revision 2: 25° pitch with two centre-row marks, tap at
(0.8, 0.9): error 5.1° with σ 3.4° (inside 2σ, previously reported as 1°); with
two horizon taps: error 0.04°, pitch recovered to 0.04°. Roll 10°: error 3.7°,
σ 3.0°; levelled: roll within 1.5°, error under 0.7°. One mark at the right
edge with a 78° lens guessed at 70°: centre error 4.0°, σ 4.1°, σ at the mark
1.0°. Two marks at x = 0.10/0.18 with a 0.7° perturbation: lens stays 72°
"assumed", far-edge error 2.2° with σ 6.8°.

Review reproductions, revision 3: six marks 100 m away with a 15 m eastward fix
error (reported accuracy 15 m): centre error 8.0° with σ **8.4°** (was 4.0°),
χ² 0.03, viewpoint flagged "reported" because marks fanned at one distance
cannot separate a sideways shift from a heading rotation. One mark at 10 km,
same fix error, genuine target 100 m away: Δ −7.9° against its own σ 11.0°
(was 1.0°), so it is `close`; the direction wedge stays at 3.8°; a target 8 km
away on the same ray gets σ under 4°. Coarse 300 m fix, one mark at 5 km: a
candidate beside the mark has σ 1.0° (shared error cancels), a candidate at
600 m has σ 36°.

Ranking against eight decoys in one frame: tapped landmark first 74 %, top
three 99 % after one mark (plus horizon when in frame); compass-only top three
75 %. Coverage above 95 % is conservative for these seeded scene distributions,
not a universal confidence guarantee. Synthetic forward truth reuses the camera
model; the figures do not establish real-photo accuracy or validate arbitrary
skylines. Different error distributions and difficult geometries can differ.

## Data: features, queries, storage, consent

**Landmark cells (decided 2026-09-27, replaces live Overpass queries).** The
public Overpass instance failed every spike request within the host's 15 s
limit, once silently as an empty result
(`experiments/aime-overture-spike/README.md`). Landmarks now come from
pre-built static files, built monthly from Overture Maps in the separate
`blueworkslabs/aime-data` repository and served from Cloudflare Pages. The
**data contract (schema 1) lives in that repository's README**; the module
depends on it, not on Overture directly. Summary:

- `v1/index.json`: Overture `release`, data `revision` and `dataset`
  (`<release>-r<N>`), coverage (`DE`, `AT` for the pilot), the list of
  non-empty 1° cells, the allowed kinds, licence and attribution. Fetched once
  per session.
- `v1/<dataset>/cells/<lat>_<lon>.json`: features `[name, kind, lat, lon, e,
  w, p]` with `e` = elevation (terrain) or height (structures), `w` =
  visibility weight 0.5–2.0, `p` = per-feature position uncertainty in metres.
  Each cell under 1 MiB (host cap 2 MiB); the spike's largest was 113 KiB.
  A published dataset path is never rewritten; corrections within one
  Overture release get a new revision.
- For a confirmed viewpoint and radius (10/30/60 km picker, default 30 km)
  the module fetches only the cells listed in the index that intersect the
  radius's bounding box: at most 9 at 60 km, within the host's four concurrent
  requests. Cells are cached in memory for the session and reused for marks
  and candidates; name search is a local filter.
- Each landmark's position uncertainty in the solver is its own `p`, used
  directly as `positionM` for marks and candidates. The pipeline derives it
  from provenance and footprint: `max(source floor, 0.5 × bbox
  half-diagonal)`, floors 8 m for OSM-derived base features, 10 m for
  building footprints, 60 m for places-derived POIs, 250 m for places-only
  mountains; merges never lower it. There is no kind-level default.
- Outside coverage (viewpoint radius touching no listed cell) the module says
  "No landmark data here yet. Germany and Austria for now." A failed download
  is shown as a failure with retry, never as an empty result. A cell whose
  `schema`, `release` or `revision` does not match the index, or any feature
  without a valid `p`, is rejected as unavailable.
- What leaves the phone: **the ids of the 1° cells** the radius touches (about
  110 × 70 km each) to the data host, and tile coordinates to OpenStreetMap.
  Never the viewpoint, the radius, the photo, the marks or the taps.
- Attribution "© OpenStreetMap contributors, Overture Maps Foundation" and the
  ODbL licence from `index.json` appear in the module's help and on the map.
- **Sidecar per photo** (`storage.kv`, key `photos`, a map from stable photo
  id): `{ viewer: {lat, lon, accuracyM, timestamp, approximate, corrected},
  radiusKm, marks: [{x, y, kind, name, lat, lon, positionM, dataset}], horizon: [{x, y}],
  pose?: {heading, fov, pitch, roll, sigma} }`. Position and radius saved
  automatically after capture; marks and horizon as the user adds them; the
  pose is derived and re-fitted on load, stored only as a display cache. Names
  are bounded (80 chars), marks to 6 and horizon taps to 2 per photo so eight
  sidecars fit 64 KiB. Retain each mark's positional estimate on reopen, rather
  than accidentally replacing a way/relation's estimate with the node default.
- **Consent text** (manifest reasons): `location.read` "Read an estimated viewpoint for your photo, shown with fix age
  and accuracy for you to confirm or correct before looking up landmarks."
  `storage.kv` "Save each photo's estimated viewpoint, the landmarks and horizon
  you marked, and the fitted direction. After photo deletion, metadata is cleaned
  up when this module can next access its library and storage."
  `net.http` "Download landmark data for the map area around your photo (whole
  cells of about 110 × 70 km, never your exact position) and map tiles."
  Origins: the `aime-data` Pages origin (default `https://aime-data.pages.dev`,
  final name set when Pages is configured) and `https://tile.openstreetmap.org`.
  `photos.library` / `camera.photo` / `image.read` as the Camera module.
- Module storage never holds the photo pixels; originals stay in the host's
  private photo store as today.

## Host additions

1. **Stable per-photo id (required, API 0.12).** `photos.library {op:"list"}`
   returns `photos: [{ref, id}]` where `id` is an opaque, module-scoped,
   persistent identifier: survives reopen, update and rollback; distinct for
   identical captures; not accepted by open/delete/export (the short-lived
   `ref` stays the only authority); exposes no filename, path or EXIF. Astra
   specifies the [proposed contract](module-photos.md#proposed-stable-photo-identity--api-012-not-implemented-in-alpha31); Clawd implements it in
   the host and the runner check; the Aimé manifest declares
   `constructApi.min 0.12`. No digest or capture-order workaround is built.
2. **One-shot orientation read** `orientation.read {op:"get"}` →
   `{azimuthDeg, pitchDeg, rollDeg, accuracy}`, same consent shape as
   `location.read`: enables compass-only mode and a later live mode. Optional;
   its value goes into the solver as one more weighted observation.

## Slices and acceptance

- **Slice 0 (this PR):** brief, reference solver with full pose and
  covariance, synthetic and adversarial tests in CI.
- **Slice 1a (Clawd, host):** stable photo id per the contract above, docs,
  unit test, runner check. Astra accepts on staging before 1b relies on it.
- **Slice 1b (Clawd, module):** `examples/aime-module` on API 0.12: library +
  capture + sidecar keyed by id with orphan reconciliation; photo view with
  taps, bearing ruler and level line; Overpass fetch (replaced by landmark
  cells in slice 1c), 10/30/60 km picker and
  local name search; marks and horizon taps feeding the reference solver
  **unchanged**; candidates sheet with per-candidate σ and the "no close
  match" state; map view built from the Sky Watch
  map class (tiles, pan/zoom, wedge, pins, draggable viewer dot). Shared
  `construct-ui.css`. Unit tests for sidecar bookkeeping, Overpass parsing,
  radius changes and the "no close match" state. A deterministic fixture
  module (like Synthetic Sky) that injects a known photo, viewpoint, horizon
  and feature set so the emulator proves the flow and the ranking without a
  real horizon.
- **Slice 1c (Clawd, data):** in `blueworkslabs/aime-data`: the monthly build
  pipeline per its README (STAC file selection, DuckDB extraction, selection
  rules including the spike's fixes, DE+AT coverage, contract validation,
  publish to the `pages` branch), with unit tests for the rules and the
  validator. In `construct`, one module PR stacked on slice 1b: replace the
  Overpass fetch/parse with index + cell fetch/parse, swap the manifest origin
  and consent text, update the fixture to serve synthetic cells, and add the
  "outside coverage" and "data unavailable" states. Nothing else changes.
- **Slice 1 acceptance (Astra):** Codex review; runner covering grants
  denied/granted, capture → sidecar, mark → calibrated ruler, horizon → level
  line, tap → candidates → map, delete → sidecar reconciled, offline/429,
  rotation, 2× text; fixture proves ranking and σ on known inputs. Small fixes
  directly, larger ones surfaced in the channel.
- **Hardware (pilot tester):** one photo from a public elevated viewpoint with
  a known tower; mark it; tap the horizon; tap two other things; report whether
  the right answers land in the top three and whether the wedge width looks
  honest. That is the real accuracy test and it precedes the merge.
- **Slice 2 (later):** orientation API and live mode; elevation from `ele`
  tags to separate near/far along a ray; on-device edge snapping for taps and
  an automatic horizon proposal; lens distortion if hardware tests show edge
  bias.

## Copy and UX rules

- Ranked results say "could be", show the signed offset, that candidate's own
  ±σ and the distance, and keep the runner-up visible. No single-answer
  wording. The map wedge uses the direction σ, which can be narrower than a
  nearby candidate's comparison σ; the sheet explains "close by, so your
  position matters more" when they differ a lot.
- The capture screen says main rear camera only and distinguishes the
  estimated viewpoint saved with the photo from the direction derived by
  marking.
- "Level estimated" appears only when `level` is fitted; "lens fitted" only when
  `lens` is fitted. Otherwise the wedge is simply wider.
- Errors name the gate: location denied, internet denied, landmark data
  unavailable, outside coverage ("Germany and Austria for now"), library
  unavailable.
- Same header, buttons, chips, help block and status line as Sky Watch 0.3.

## Product choices confirmed 2026-09-26

- Name **Aimé** (project owner's choice from Astra's Laussedat suggestion).
- Automatically save available viewpoint and calibration metadata per photo;
  no repeated per-photo save prompt; no fabricated direction.
- 10/30/60 km radius picker, default 30 km.

## Product choices confirmed 2026-09-27

- Landmark data from pre-built Overture cells instead of the public Overpass
  instance, after the spike (draft PR #36).
- New repository `blueworkslabs/aime-data` for the pipeline and data contract;
  Cloudflare Pages hosting set up by the project owner.
- Pilot coverage: Germany and Austria. Hannover is the hardware-test region.

## Review decisions (revisions 2 and 3)

1. **Geometry (rev 2):** the elevated-viewpoint goal is kept. The solver models
   the full pose; horizon taps level the picture; without them the pitch/roll
   priors widen σ for rows away from the marks instead of hiding the error.
2. **Uncertainty and conditioning (rev 2):** σ is propagated from the fit
   covariance, with χ² inflation for inconsistent marks and priors that stop
   clustered or near-collinear marks from manufacturing a lens. The suite
   measures 2σ coverage on random 2D scenes and reproduces the four review cases.
3. **Identity (rev 2):** stable photo id as an API 0.12 host addition, required
   by the module; no digest or capture-order prototype. Reconciliation after
   every successful complete list.
4. **Shared viewpoint error (rev 3):** the viewer offset is a fitted state with
   the fix accuracy as its prior, common to all marks and all candidate
   bearings. The six-marks-at-100 m case now reports σ 8.4° for its 8.0° error
   and flags the viewpoint "reported"; nearby (0.1–2 km) and coarse-fix
   (300–2000 m) families are covered at 98–100 %. No distance restriction was
   added; the 50 m minimum from revision 1 stands.
5. **Candidate comparison σ (rev 3):** ranking uses a per-candidate σ that
   includes the correlated viewpoint term and the candidate's placement over
   its distance; `close` is decided against it. The 10 km-mark / 100 m-target
   case is now `close` with σ 11°, and the wedge keeps its own direction σ.

Astra re-reviews revision 3. On acceptance, slice 1a starts. No module, host
release or emulator acceptance is implied by passing this planning slice's 19
checks (18 revision-3 checks plus a dateline/pole offset regression).
