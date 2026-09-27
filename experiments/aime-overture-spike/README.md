# Aimé landmark data: Overture spike (2026-09-27)

Question: can pre-built landmark cells from Overture Maps replace live queries
to the public Overpass instance for Aimé? Scope: two test regions agreed in
the channel (Rhine-Main, Innsbruck area), plus Hannover for the planned
hardware test. Throwaway scripts; the production pipeline is a separate task.

**Verdict: go.** Overture has the landmarks Aimé needs, the cells are tiny,
and the public Overpass instance failed every request under the host's
15-second limit during this spike.

## Method

- Overture release `2026-09-23.1`, read remotely from the public S3 bucket
  with DuckDB 1.5.5 (`httpfs`, `spatial`). The STAC catalogue
  (`stac.overturemaps.org/<release>/<theme>/<type>/collection.json`) gives one
  extent per Parquet file, so each region reads 1–4 files per theme instead
  of scanning all 512 (a global scan of `buildings` did not finish in 10 min).
- Themes used: `base/land` (peaks, hills, volcanoes with elevation and
  Wikidata), `base/infrastructure` (towers, masts, bell towers, observation
  towers, water towers, dams, named bridges with Wikidata; raw OSM tags in
  `source_tags`), `buildings/building` (named churches, cathedrals, chapels,
  mosques, synagogues, temples, monasteries; any building ≥ 80 m), and
  `places/place` (castles, forts, monuments, lighthouses, memorials, and
  castle/tower-like historic sites, confidence ≥ 0.6).
- Selection and dedupe in `aime_select.py`: same normalised name within 400 m
  merges, provenance order land > infrastructure > buildings > places.
- Baseline: the brief's Overpass query for the same boxes, sent with an
  identifying User-Agent, two attempts per region.
- Regions: Rhine-Main 8.0–9.3 E, 49.7–50.45 N; Innsbruck 10.9–11.9 E,
  46.95–47.5 N; Hannover 9.4–10.1 E, 52.15–52.55 N.

Scripts: `stac_files.py` (file selection), `extract.py` and
`buildings_tiles.py` (regional extracts), `aime_select.py` (selection, dedupe,
cell sizing), `compare.py` (recall against an Overpass response).

## Results

| Region | Features after dedupe | Per deg² | Largest 1° cell | Largest 0.5° cell |
| --- | --- | --- | --- | --- |
| Rhine-Main | 3,555 | ~3,650 | 98 KiB (29 KiB gzip) | 50 KiB |
| Innsbruck | 2,585 | ~4,700 | 113 KiB (33 KiB gzip) | 69 KiB |
| Hannover | 757 | ~2,700 | 38 KiB (12 KiB gzip) | 35 KiB |

Compact records (`[name, kind, lat, lon, elevation_or_height, weight]`) average
54 bytes. The host's JSON cap is 2 MiB, so 1° cells have more than 15× headroom
in these areas. A 60 km radius touches 4–9 cells of 1°.

**Recall against Overpass (Innsbruck, the only region Overpass answered),
same name within 600 m, viewpoints/attractions excluded by design:**

| OSM kind | Found |
| --- | --- |
| natural=peak | 1,520 / 1,526 (99.6 %) |
| building=church | 257 / 257 (100 %) |
| building=chapel | 632 / 657 (96.2 %) |
| man_made=tower | 21 / 30 (70 %) |
| man_made=mast | 11 / 14 (79 %) |
| historic=ruins / castle / monument | 7/23, 3/7, 0/10 |
| **All visible-target kinds** | **2,459 / 2,588 (95.0 %)** |

Overture also adds what the Overpass query never returned: tall buildings with
heights (Commerzbank Tower, Messeturm, Neues Rathaus Hannover), unnamed
transmitter masts ≥ 50 m, and named bridges with Wikidata.

**Known landmarks** (hand list): Rhine-Main 20/20 present in Overture with a
usable class (Großer Feldberg peak, Europaturm communication tower, Frankfurt
and Mainz cathedrals, Hochzeitsturm observation tower, skyscrapers with
heights, …). Innsbruck 20/20 (Hafelekar, Patscherkofel, Serles, Frau Hitt,
Dom St. Jakob, Stadtturm, Bergisel, Europabrücke, …). Hannover: 11/18 selected
(Telemax, Neues Rathaus, Marktkirche, Annaturm, Nordmannsturm, Benther Berg,
Kalibergs, Burgbergturm, …); 5 more exist but the first-pass rules skip them
(below); 2 are absent from Overture (Hermesturm, Bismarckturm).

**Overpass during the spike:**

| Request | Result |
| --- | --- |
| Default client User-Agent, 4 attempts | HTTP 406 in 0.1 s |
| Rhine-Main, identifying UA, 2 attempts | HTTP 200 after ~29 s with **zero elements**: `runtime error: Query timed out … after 26 seconds` |
| Innsbruck, attempt 1 | HTTP 504 after 9.6 s |
| Innsbruck, attempt 2 | HTTP 200 after 17.0 s, 2,929 elements, 813 KB |

With the host's 15 s total and 8 s read limits, every attempt would have
failed on a phone, and the Rhine-Main case fails *silently* as an empty result.

## Rule fixes found (for the production selection)

1. Churches named only in `places` (`christian_place_of_worship`, e.g.
   Aegidienkirche): include when no `buildings` church lies within 250 m.
2. Castles and palaces as buildings without a castle class (Marienburg,
   Herrenhausen): include named buildings matching
   `schloss|burg|castle|palace|palais|festung|kloster|abtei`.
3. Peaks tagged as forest in `land` but present as `places/mountain`
   (Gehrdener Berg): include places mountains with confidence ≥ 0.8 when no
   land peak shares the name within 2 km; drop names containing " - ".
4. Drop `places/stadium_arena` (sports clubs, ticket hotlines) and generic
   `places/historic_site` without castle/tower keywords.
5. Towers appear under several infrastructure classes (`viewpoint`,
   `defensive`, `mobile_phone_tower`); select by `source_tags['man_made']`
   and `source_tags['historic']` as `aime_select.py` does.

## Proposed design

- **Cells:** 1° grid, `cells/<lat>_<lon>.json` =
  `{"v": release, "cell": [lat, lon], "f": [[name, kind, lat, lon, e, w], …]}`
  plus `index.json` listing non-empty cells, the release and attribution. The
  module fetches `index.json` once per session and then only the cells its
  radius touches. Placement precision comes from the kind (points 8 m,
  building centroids 25 m) in the module, not per record. No per-feature IDs:
  sidecar marks already store name, kind and position.
- **Hosting:** static files on Cloudflare Pages (20k files, 25 MiB per file on
  the free plan) or R2 for global scale. Plain GETs of `application/json`
  only: the host sends no Range headers, so PMTiles/FlatGeobuf range reads are
  out.
- **Privacy:** requests reveal only 1° cell ids (~110 × 70 km at 50° N), not
  the viewpoint and radius Overpass needed.
- **Licence:** `base` and `buildings` themes are ODbL (OSM-derived), `places`
  is CDLA-Permissive-2.0/Apache-2.0/CC0; the published cell set is ODbL with
  "© OpenStreetMap contributors, Overture Maps Foundation" attribution in
  `index.json`, the module's help and the data site.
- **Pipeline:** monthly, after each Overture release: STAC file selection per
  region, DuckDB extraction, selection rules, cell writer, deploy. Regional
  extracts took 1–6 min per theme here on a small host; a GitHub Actions
  runner can build Europe in a single job.
- **Size estimate (rough):** Europe ≈ 1,300 deg² of land at 1,500–2,500
  features/deg² → 2–3 M features, 110–170 MB raw (35–55 MB gzip), ~1,500 cells.

## Not measured

Global or all-Europe totals (extrapolated above), phone fetch latency, the
exact Wikidata/height weights, and whether Overpass performs better at other
times of day. The recall figure uses the brief's Overpass query as the
reference, not ground truth.
