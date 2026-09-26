# Aimé — landmark identification from a photo (module brief)

Status: planning brief, slice 0, **revision 2** after Astra's Codex review of
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
viewer position; the fit may refine that position within the fix accuracy when
the geometry allows, never beyond it.

This is a spotting aid with an honest shortlist, not an oracle. Every answer
shows the candidate's bearing, its signed offset from the tap, the tap's own
±σ, and the distance.

## What exists today (API 0.11 candidate, alpha31)

| Need | Available | Notes |
| --- | --- | --- |
| Take a photo into module-private storage | `camera.photo {op:"capture"}` | Native shutter; returns only `{saved:true}`. 8 photos per module. |
| Show the photo, take taps | `photos.library {op:"list"|"open"}` + `image.read` | Opened image ≤1024 px per edge, EXIF-orientation corrected. Refs are per run: **no stable id**, no EXIF, no date. |
| Where you stood | `location.read {op:"get"}` | One fix, accuracy in m; no altitude. Cached fix may be up to 120 s old. |
| Which way the phone pointed | none | No orientation API. Direction is **derived** by marking, not captured. |
| Lens field of view | none | Assumed from aspect ratio; fitted from marks. |
| Map features | `net.http` with declared origins | Overpass (`https://overpass-api.de`) JSON; OSM tiles for the map. |
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
   the tap and the tap's ±σ. When nothing lies within 2σ the sheet says "no
   close match" and shows the nearest two greyed. Tapping a candidate opens the
   **map view**: viewer dot, tap ray as a wedge of width 2σ, marks as solid
   pins, candidates as numbered pins.
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
distances can tighten the viewpoint within its accuracy (ordinary resection).

**Fit.** Levenberg–Marquardt over `(H, f, p, r, east, north)` with a numeric
Jacobian, initialised from a level camera at the reported fix; six parameters,
a few dozen iterations, under a millisecond in Node; phone performance is not
measured here. Observations that disagree beyond their stated precision inflate
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

**Out of scope for v1:** explicit position recovery beyond the fix accuracy
(the offset is bounded by the reported accuracy on purpose); elevation angles
from `ele` tags; lens distortion.

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
75 %. Coverage above 95 % means σ is slightly conservative, the right side for
a wedge on a map. Synthetic forward truth reuses the camera model; the figures
do not establish real-photo accuracy or validate arbitrary skylines.

## Data: features, queries, storage, consent

**Overpass query, once per confirmed viewpoint and selected radius** (10/30/60
km picker, default 30 km; example below is 30 km), cached in memory for the
session and reused for marks and candidates:

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
  `ele`, `height`, the matching kind tag and the OSM **type plus id** (numeric
  ids overlap across types). Drop everything else. Way/relation centres get a
  larger `positionM` (30 m) than nodes (8 m) in the solver.
- The 400-element cap is a partial dataset, not the nearest or most visible
  400; at the cap, label results incomplete and offer a smaller radius.
- Overpass returns `application/json` for `[out:json]`; the host's 2 MiB cap
  still applies and a count limit does not bound bytes. The host's 15 s total
  and 8 s read deadlines can expire before the server's 20 s limit. Size, MIME
  and transport failures are shown as such, never as empty results. 429/504:
  show the reason and offer a retry; no loop. Verify the deployed host's fixed
  User-Agent against the public instance's policy before release. Name search
  is a local filter over this set, so no per-keystroke requests.
- What leaves the phone: **a confirmed viewpoint and the selected radius** to
  Overpass, and tile coordinates to OpenStreetMap. Never the photo, never the
  marks, never the taps.
- **Sidecar per photo** (`storage.kv`, key `photos`, a map from stable photo
  id): `{ viewer: {lat, lon, accuracyM, timestamp, approximate, corrected},
  radiusKm, marks: [{x, y, osmType, osmId, name, lat, lon, positionM}], horizon: [{x, y}],
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
  `net.http` "Fetch named map features around your photo position and map
  tiles." `photos.library` / `camera.photo` / `image.read` as the Camera module.
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
  taps, bearing ruler and level line; Overpass fetch, 10/30/60 km picker and
  local name search; marks and horizon taps feeding the reference solver
  **unchanged**; candidates sheet with per-candidate σ and the "no close
  match" state; map view built from the Sky Watch
  map class (tiles, pan/zoom, wedge, pins, draggable viewer dot). Shared
  `construct-ui.css`. Unit tests for sidecar bookkeeping, Overpass parsing,
  radius changes and the "no close match" state. A deterministic fixture
  module (like Synthetic Sky) that injects a known photo, viewpoint, horizon
  and feature set so the emulator proves the flow and the ranking without a
  real horizon.
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
- Errors name the gate: location denied, internet denied, Overpass busy,
  library unavailable.
- Same header, buttons, chips, help block and status line as Sky Watch 0.3.

## Product choices confirmed 2026-09-26

- Name **Aimé** (project owner's choice from Astra's Laussedat suggestion).
- Automatically save available viewpoint and calibration metadata per photo;
  no repeated per-photo save prompt; no fabricated direction.
- 10/30/60 km radius picker, default 30 km.

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
release or emulator acceptance is implied by passing this planning slice's 18
checks.
