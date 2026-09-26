# Aimé — landmark identification from a photo (module brief)

Status: planning brief, slice 0, **revision 2** after Astra's Codex review of
the first draft. Nothing here is a shipped contract. Plan owner: Fable.
Implementation: Clawd. Review and staging acceptance: Astra. Hardware test:
the pilot tester. Name chosen by the project owner: **Aimé**
(`dev.construct.aime`), after Aimé Laussedat, who surveyed from photographs
in the 1850s ([background](https://en.wikipedia.org/wiki/Aim%C3%A9_Laussedat)).

Revision 2 resolves the three review decisions: a full camera pose model with
optional horizon levelling, uncertainty propagated from the fit, and a stable
photo id as a small versioned host addition. Details in
[Review decisions](#review-decisions-resolved-in-revision-2).

## Purpose

Take a photo from a viewpoint, tap a thing in it, and see on a map what it
probably is. No cloud vision, no photo leaves the phone. The module turns the
tap into a **compass bearing from where you stood** and ranks named map
features along that bearing. Marking one landmark you already recognise in
the photo (a church tower, a summit) calibrates the direction far better than
the phone compass could; marking two also constrains the lens; tapping the
horizon levels the picture. This is bearing calibration from an already-known
viewer position, not recovery of that position.

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
   `approximate` flag. The user may have waited or walked in the viewfinder,
   so the fix is labelled **estimated viewpoint** with its age and can be
   corrected by dragging the dot on the map. A photo with no usable fix stays
   unlocated: no query, no ranking, a clear "set your viewpoint" prompt.
   The sidecar is written only once the new photo's stable id appears in
   `list`; a fix without a photo is discarded.
3. **Photo view** → the photo, fit to the viewport, pinch-zoomable (reuse the
   Sky Watch map gesture code). A thin **bearing ruler** along the top shows
   compass degrees once calibrated; before that it reads "Mark a landmark you
   know to calibrate".
4. **Mark a landmark** → tap the tower/summit → a name search over the features
   already fetched for this viewpoint and radius (typed filter, nearest first)
   → pick → the ruler snaps to the calibrated bearings. A second mark is
   offered ("Mark another to fit the lens"), never required. Marks store the
   tapped `x, y`.
5. **Level the horizon** (optional, recommended for tilted photos) → "Tap two
   points on the horizon" → the module draws the fitted level line across the
   photo and states "levelled" with the pitch. Skipping it keeps a wider σ for
   rows far from the marks; the wedge on the map shows that honestly.
6. **What's that?** → tap anywhere else → a **candidates sheet**: up to five
   features ranked by score, each with name, kind, distance, signed offset from
   the tap and the tap's ±σ. When nothing lies within 2σ the sheet says "no
   close match" and shows the nearest two greyed. Tapping a candidate opens the
   **map view**: viewer dot, tap ray as a wedge of width 2σ, marks as solid
   pins, candidates as numbered pins.
7. **Delete photo** → native confirmation (existing `photos.library` op); only
   `{completed:true}` removes the sidecar. Native deletion and `storage.kv`
   cleanup are separate operations; on every `list` the module drops sidecars
   whose id no longer exists, so an interrupted delete is reconciled on the
   next open.

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
| Mark k at `(xₖ, yₖ)` with known position | bearing of the pixel − true bearing | `√(tap² + atan((viewer accuracy ⊕ 8 m OSM) / distance)²)` |
| Horizon tap at `(x, y)` | elevation of the pixel − 0 | 0.7° |
| Compass heading (optional) | `H − Hc` | 12° |
| Lens prior | `f − 70°` (or the portrait default) | 8° (1° when the FOV is known) |
| Pitch prior | `p − 0` | 15° |
| Roll prior | `r − 0` | 5° |

Tap σ is 0.7° (≈1 % of frame width). Viewer accuracy comes from the fix; a
2 km coarse fix or a mark 60 m away makes σ tens of degrees, as it should.

**Fit.** Levenberg–Marquardt over `(H, f, p, r)` with a numeric Jacobian,
initialised from a level camera; four parameters, a few dozen iterations,
under a millisecond. Marks that disagree beyond their stated precision inflate
the covariance by χ²/dof (when dof > 0). The result carries the pose, the 4×4
covariance and two flags: `lens: fitted|assumed` and `level: fitted|assumed`,
meaning the data narrowed that parameter well below its prior or did not.
Clustered, duplicate or near-collinear marks therefore never manufacture a
lens: the prior holds `f` and the flag says "assumed".

**Uncertainty per tap.** `σ² = tap² + gᵀ Σ g`, where `g` is the gradient of
the tap's bearing with respect to the pose and `Σ` the covariance. It is
smallest at the marks, grows towards the edges when the lens is assumed, and
grows for rows far from the marks when the picture is not levelled. This σ
sizes the wedge and the score.

**Ranking.** `logScore = −½(Δ/σ)² + ln(far) + ln(weight)`; Δ is the signed
bearing difference, `far` halves candidates beyond 40 km (peaks may set a
larger `maxKm`), `weight` is a visibility prior from tags (peak with `ele`
1.5, tower/mast/cathedral 1.3, castle/monument 1.1, viewpoint 0.8, other 1.0).
Sort by log-score so underflow never reorders. Up to five shown; "no close
match" when none is within 2σ.

**Out of scope for v1:** recovering the viewer position from three marks
(same maths, different unknowns, needs good geometry); elevation angles from
`ele` tags; lens distortion.

**Synthetic results** (`scripts/test_aime_resection.cjs`, seeded; scenes have
lens 62–78° with 70° guessed, pitch −5…25° down, roll ±5°, tap noise 0.5 % of
frame, GPS 15 m, OSM 5 m, landmarks 2–25 km; taps at random pixels; the test
prints the measured numbers):

| Calibration | Bearing error | σ reported | 2σ coverage |
| --- | --- | --- | --- |
| One mark, random taps | median 1.6°, p90 5.0° | median 3.8° | 99 % |
| One mark, same row, 15 % of frame away | median 0.8°, p90 1.8° | | |
| Two marks, lens fitted (60 % of pairs) | median 0.9°, p90 2.9° | median 2.2° | 99 % |
| Two marks, lens assumed (close pairs) | median 1.2°, p90 3.7° | median 3.0° | 99 % |
| Two marks + horizon (the viewpoint case) | median 0.4°, p90 1.9°; pitch/roll p90 1.2° | median 1.3° | 100 % |
| Three or more marks, no horizon | median 0.5°, p90 2.1° | median 1.5° | 100 % |

Review reproductions: 25° pitch with two centre-row marks, tap at (0.8, 0.9):
error 5.1° with σ 3.4° (inside 2σ, previously reported as 1°); with two horizon
taps: error 0.04°, pitch recovered to 0.04°. Roll 10°: error 3.7°, σ 3.0°;
levelled: roll within 1.5°, error under 0.7°. One mark at the right edge with a
78° lens guessed at 70°: centre error 4.0°, σ 4.1°, σ at the mark 1.0°. Two
marks at x = 0.10/0.18 with a 0.7° perturbation: lens stays 72° "assumed",
far-edge error 2.2° with σ 6.8°. Ranking against eight decoys in one frame:
tapped landmark first 73 %, top three 98 % after one mark (plus horizon when
in frame); compass-only top three 75 %. Coverage above 95 % means σ is slightly
conservative, which is the right side to err on for a wedge on a map.

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
  radiusKm, marks: [{x, y, osmType, osmId, name, lat, lon}], horizon: [{x, y}],
  pose?: {heading, fov, pitch, roll, sigma} }`. Position and radius saved
  automatically after capture; marks and horizon as the user adds them; the
  pose is derived and re-fitted on load, stored only as a display cache. Names
  are bounded (80 chars) and marks to 6 per photo so eight sidecars fit 64 KiB.
- **Consent text** (manifest reasons): `location.read` "Record where you stood
  when you take a photo, so taps can be turned into compass bearings."
  `storage.kv` "Save, per photo, where you stood, the landmarks and horizon you
  marked and the fitted direction. Cleaned up after the photo is deleted."
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
   writes the contract lines in `docs/module-photos.md`; Clawd implements it in
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
  **unchanged**; candidates sheet with σ; map view built from the Sky Watch
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

- Ranked results say "could be", show the signed offset, the tap's ±σ and the
  distance, and keep the runner-up visible. No single-answer wording.
- The capture screen says main rear camera only and distinguishes the
  estimated viewpoint saved with the photo from the direction derived by
  marking.
- "Levelled" appears only when `level` is fitted; "lens fitted" only when
  `lens` is fitted. Otherwise the wedge is simply wider.
- Errors name the gate: location denied, internet denied, Overpass busy,
  library unavailable.
- Same header, buttons, chips, help block and status line as Sky Watch 0.3.

## Product choices confirmed 2026-09-26

- Name **Aimé** (project owner's choice from Astra's Laussedat suggestion).
- Automatically save available viewpoint and calibration metadata per photo;
  no repeated per-photo save prompt; no fabricated direction.
- 10/30/60 km radius picker, default 30 km.

## Review decisions (resolved in revision 2)

1. **Geometry:** the elevated-viewpoint goal is kept. The solver models the
   full pose; horizon taps level the picture; without them the pitch/roll
   priors widen σ for rows away from the marks instead of hiding the error.
2. **Uncertainty and conditioning:** σ is propagated from the fit covariance
   with position accuracy and distance in the mark weights, χ² inflation for
   inconsistent marks, and priors that stop clustered or near-collinear marks
   from manufacturing a lens. The suite measures 2σ coverage on random 2D
   scenes and reproduces the four review cases.
3. **Identity:** stable photo id as an API 0.12 host addition, required by the
   module; no digest or capture-order prototype. Reconciliation on every list.

Astra re-reviews this revision. On acceptance, slice 1a starts.
