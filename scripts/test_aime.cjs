// Aimé module logic: sidecars, capture association, reconciliation, viewpoint
// choice, landmark cells (cell math, index/cell validation, fetch and cache),
// radius changes, search, shortlist, point editing (hit test, drag, undo,
// writes on release), the magnifier geometry, distance/bearing labels, cell
// declination, the map pin in the photo and the Synthetic Aimé scene. The solver itself is covered by test_aime_resection.cjs.
const fs = require("node:fs");
const assert = require("node:assert/strict");
const C = require("../examples/aime-module/ui/aime-core.js");
const R = require("../examples/aime-module/ui/resection.js");
const F = require("./aime-fixture/synthetic-aime.js");
let checks = 0;
const check = (name, fn) => {
  fn();
  checks++;
  console.log("ok -", name);
};

check("module solver is byte-identical to docs/aime/resection.js", () => {
  assert.ok(fs.readFileSync("examples/aime-module/ui/resection.js").equals(fs.readFileSync("docs/aime/resection.js")));
  assert.ok(fs.readFileSync("examples/aime-module/ui/construct-ui.css").equals(fs.readFileSync("examples/sky-watch-module/ui/construct-ui.css")));
});

const mark = (i, extra = {}) => ({ x: 0.1 * (i % 9), y: 0.5, kind: "tower", name: "Mark " + i, lat: 46.9, lon: 9.1, positionM: 8, dataset: "2026-09-23.1-r1", ...extra });
// Saved by Aimé ≤ 0.1.2 (Overpass): OSM type and id instead of kind and dataset.
const legacyMark = (i, extra = {}) => ({ x: 0.1 * (i % 9), y: 0.5, osmType: "node", osmId: 100 + i, name: "Mark " + i, lat: 46.9, lon: 9.1, positionM: 8, ...extra });
check("sidecars are bounded and invalid parts dropped, not guessed", () => {
  const s = C.cleanSidecar({
    viewer: { lat: 46.8, lon: 9.2, accuracyM: 12, timestamp: 1, approximate: true, corrected: false },
    radiusKm: 45,
    marks: [...Array(9).keys()].map((i) => mark(i, { name: "x".repeat(200) })).concat([{ x: 2, y: 0 }]),
    horizon: [{ x: 0.1, y: 0.4 }, { x: 0.9, y: 0.41 }, { x: 0.5, y: 0.4 }],
  });
  assert.equal(s.radiusKm, 30, "unknown radius falls back to the 30 km default");
  assert.equal(s.marks.length, C.MAX_MARKS);
  assert.equal(s.marks[0].name.length, C.NAME_MAX);
  assert.equal(s.horizon.length, C.MAX_HORIZON);
  assert.equal(s.viewer.approximate, true);
  assert.deepEqual(Object.keys(s.marks[0]), ["x", "y", "kind", "name", "lat", "lon", "positionM", "dataset"], "brief's mark shape");
  assert.equal(C.cleanSidecar({ marks: [mark(1, { positionM: undefined })] }).marks[0].positionM, 30, "conservative estimate when missing");
  assert.equal(C.cleanSidecar({ marks: [mark(1, { positionM: 45 })] }).marks[0].positionM, 45, "stored estimate kept on reopen");
  assert.equal(C.cleanSidecar({ marks: [mark(1, { dataset: "../x" })] }).marks[0].dataset, "");
  // The unpublished interim shape carried `release`: accepted, dataset unknown.
  const interim = C.cleanSidecar({ marks: [mark(1, { dataset: undefined, release: "2026-09-23.1" })] }).marks[0];
  assert.equal(interim.dataset, "");
  assert.equal("release" in interim, false);
  assert.equal(C.cleanSidecar({ marks: [mark(1, { kind: undefined })] }).marks.length, 0, "neither kind nor legacy OSM id");
  assert.equal(C.cleanSidecar({ marks: [mark(1, { kind: "Tower!" })] }).marks.length, 0);
  assert.equal(C.cleanSidecar({ viewer: { lat: 91, lon: 0 } }).viewer, null);
  for (const r of C.RADII) assert.equal(C.cleanSidecar({ radiusKm: r }).radiusKm, r);
});

check("list ids require the API 0.12 shape and never become an empty library", () => {
  assert.deepEqual(C.listIds({ photos: [{ ref: "r1", id: "pA" }, { ref: "r2", id: "pB" }], limit: 8 }), ["pA", "pB"]);
  assert.deepEqual(C.listIds({ photos: [], limit: 8 }), []);
  assert.throws(() => C.listIds({ photos: [{ ref: "r1" }] }), { code: "PHOTO_IDS" });
  assert.throws(() => C.listIds({ photos: [{ ref: "r1", id: "pA" }, { ref: "r2", id: "pA" }] }), { code: "PHOTO_IDS" });
  assert.throws(() => C.listIds(null), { code: "PHOTO_LIST" });
});

check("API 0.13 capture names the new photo by its stable id; no id is never guessed", () => {
  assert.equal(C.captureId({ saved: true, id: "p123", capture: { zoomRatio: 1 } }), "p123");
  assert.equal(C.captureId({ saved: true }), null, "a saved result without id stays unassociated");
  assert.equal(C.captureId({ saved: true, id: "bad id" }), null);
  assert.equal(C.captureId({ saved: true, id: 7 }), null);
  assert.equal(C.captureId({ saved: false, id: "p1" }), null);
  assert.equal(C.captureId(null), null);
});

const fix = (t, lat = 46.8, lon = 9.2, accuracyM = 10) => C.fixFrom({ latitude: lat, longitude: lon, accuracyM, timestamp: t, approximate: false });
check("viewpoint keeps the later fix by timestamp and flags doubtful ones for review", () => {
  const t = 1_800_000_000_000;
  let v = C.chooseViewpoint(fix(t + 5000, 46.80001), fix(t, 46.8), t, t + 10000);
  assert.equal(v.viewer.lat, 46.80001, "later timestamp wins, not request order");
  assert.equal(v.viewer.review, false);
  assert.equal(v.viewer.corrected, false);
  v = C.chooseViewpoint(fix(t), fix(t + 20000, 46.81), t, t + 10000);
  assert.deepEqual(v.reasons, ["fixes disagree"]);
  assert.equal(v.viewer.review, true);
  v = C.chooseViewpoint(fix(t - 200000), null, t, t + 5000);
  assert.deepEqual(v.reasons, ["old fix"]);
  v = C.chooseViewpoint(fix(t), fix(t + 90000), t, t + 90000);
  assert.deepEqual(v.reasons, ["long viewfinder wait"]);
  assert.equal(C.chooseViewpoint(null, null, t, t), null, "no fix: photo stays unlocated");
  assert.equal(C.fixFrom({ latitude: 200, longitude: 0, timestamp: t }), null);
  assert.equal(C.queryable(v.viewer), false);
  assert.equal(C.queryable({ ...v.viewer, review: false }), true);
  assert.equal(C.queryable(null), false);
});

const INDEX = {
  schema: 1,
  release: "2026-09-23.1",
  revision: 1,
  dataset: "2026-09-23.1-r1",
  built: "2026-09-27T12:00:00Z",
  cellDeg: 1,
  coverage: ["DE", "AT"],
  path: "2026-09-23.1-r1/cells/",
  cells: ["46_9", "47_9", "47_-1", "52_9"],
  license: "ODbL-1.0",
  attribution: "© OpenStreetMap contributors, Overture Maps Foundation",
  kinds: ["peak", "tower", "church", "monument", "dam"],
};
const cellText = (name, f, extra = {}) => JSON.stringify({ schema: 1, release: INDEX.release, revision: INDEX.revision, cell: name.split("_").map(Number), f, ...extra });
const CONTRACT_KINDS = "peak hill volcano tower observation communication_tower mast bell_tower water_tower watchtower minaret lighthouse windmill chimney radar church cathedral chapel mosque synagogue temple monastery castle ruins fort tall_building gasometer cooling monument memorial bridge dam".split(" ");

check("cell math: integer south-west corners, negative coordinates, the dateline and ≤ 9 cells at 60 km in the coverage latitudes", () => {
  assert.deepEqual(C.cellsAround(47.5, 8.5, 10), ["47_8"]);
  assert.deepEqual(C.cellsAround(47.95, 8.95, 10).sort(), ["47_8", "47_9", "48_8", "48_9"]);
  assert.ok(C.cellsAround(47.5, -0.2, 30).includes("47_-1") && C.cellsAround(47.5, -0.2, 30).includes("47_0"));
  assert.deepEqual(C.cellsAround(-33.9, 18.4, 10), ["-34_18"]);
  assert.deepEqual(C.cellsAround(-0.05, -0.05, 10).sort(), ["-1_-1", "-1_0", "0_-1", "0_0"]);
  assert.deepEqual(C.cellsAround(10.5, 179.95, 10).sort(), ["10_-180", "10_179"], "wraps across the dateline");
  assert.equal(C.cellsAround(89.99, 0, 10).length, 360, "a cap over the pole spans every longitude");
  // Longitude half-width grows with 1/cos(lat): 30 km at 52°N reaches ≈ 0.44°.
  assert.deepEqual(C.cellsAround(52.5, 9.5, 30), ["52_9"]);
  assert.deepEqual(C.cellsAround(52.5, 9.57, 30).sort(), ["52_10", "52_9"]);
  for (const [lat, lon] of [[47, 9], [52, 10], [47.37, 8.54], [52.37, 9.74]])
    for (const r of C.RADII) {
      const cells = C.cellsAround(lat, lon, r);
      assert.ok(cells.length >= 1 && cells.length <= 9, `${lat},${lon} ${r} km: ${cells.length}`);
    }
  for (let lat = 40; lat <= 57; lat += 0.07) for (let lon = 5; lon < 18; lon += 0.13) assert.ok(C.cellsAround(lat, lon, 60).length <= 9, `${lat},${lon}`);
  // Every point within the radius lies in a returned cell.
  for (const [lat, lon] of [[47.02, 9.98], [52.99, 10.01], [-12.5, -77.03]])
    for (let b = 0; b < 360; b += 5) {
      const p = R.destination({ lat, lon }, b, 59.99);
      assert.ok(C.cellsAround(lat, lon, 60).includes(Math.floor(p.lat) + "_" + Math.floor(p.lon)), `${lat},${lon} bearing ${b}`);
    }
  assert.throws(() => C.cellsAround(46.8, 9.2, 20), /10\/30\/60/);
});

check("index validation: schema 1 only, dataset = release-rN with its path, listed cells and a plain kind list", () => {
  const ix = C.parseIndex(JSON.stringify(INDEX));
  assert.equal(ix.release, "2026-09-23.1");
  assert.equal(ix.revision, 1);
  assert.equal(ix.dataset, "2026-09-23.1-r1");
  assert.deepEqual([...ix.cells], INDEX.cells);
  assert.deepEqual([...ix.kinds], INDEX.kinds);
  assert.deepEqual(ix.coverage, ["DE", "AT"]);
  assert.equal(ix.attribution, "© OpenStreetMap contributors, Overture Maps Foundation");
  assert.equal(ix.license, "ODbL-1.0");
  assert.equal(C.cellUrl(ix, "47_-1"), "https://aime-data.pages.dev/v1/2026-09-23.1-r1/cells/47_-1.json");
  // Cells are cached per dataset: revision 2 of the same release is new data.
  const r2 = C.parseIndex(JSON.stringify({ ...INDEX, revision: 2, dataset: "2026-09-23.1-r2", path: "2026-09-23.1-r2/cells/" }));
  assert.notEqual(C.cellKey(r2, "46_9"), C.cellKey(ix, "46_9"));
  assert.equal(C.cellKey(ix, "46_9"), "2026-09-23.1-r1/46_9");
  assert.equal(C.cellUrl(r2, "46_9"), "https://aime-data.pages.dev/v1/2026-09-23.1-r2/cells/46_9.json");
  assert.equal(C.INDEX_URL, "https://aime-data.pages.dev/v1/index.json");
  const bad = (patch) => assert.throws(() => C.parseIndex(JSON.stringify({ ...INDEX, ...patch })), (e) => e.code === "DATA_INVALID" && e.retry === true && /^Landmark data unavailable/.test(e.message));
  bad({ schema: 2 });
  bad({ cellDeg: 2 });
  bad({ cellDeg: undefined });
  bad({ schema: "1" });
  bad({ path: "../elsewhere/" });
  bad({ path: "https://evil.example/" });
  bad({ path: "2026-09-23.1/cells/" });
  bad({ release: "" });
  bad({ revision: 0 });
  bad({ revision: "1" });
  bad({ revision: 1.5 });
  bad({ revision: undefined });
  bad({ dataset: "2026-09-23.1-r2" });
  bad({ dataset: undefined });
  bad({ cells: "46_9" });
  bad({ kinds: { peak: { placementM: 8 } } });
  bad({ kinds: [] });
  bad({ kinds: ["peak", 7] });
  bad({ kinds: ["peak", "Tower"] });
  bad({ kinds: ["peak", null] });
  assert.throws(() => C.parseIndex("<html>404</html>"), { code: "DATA_INVALID" });
  // #40: licence and attribution are required as published, never defaulted.
  const noLegal = (patch) => assert.throws(() => C.parseIndex(JSON.stringify({ ...INDEX, ...patch })), (e) => e.code === "DATA_INVALID" && e.retry === true && /^Landmark data unavailable: the landmark index has no valid licence or attribution/.test(e.message));
  for (const field of ["license", "attribution"])
    for (const value of [undefined, null, "", " ", 7, ["ODbL-1.0"], { name: "ODbL-1.0" }, " padded", "padded ", "Line\nbreak", "Hidden\u202emark", "Lone\ud800surrogate"])
      noLegal({ [field]: value });
  noLegal({ license: "x".repeat(41) });
  noLegal({ attribution: "x".repeat(121) });
  const longest = C.parseIndex(JSON.stringify({ ...INDEX, license: "L".repeat(39) + "🄯", attribution: "© " + "a".repeat(117) + "🗺" }));
  assert.equal([...longest.license].length, 40, "limits count code points");
  assert.ok(longest.attribution.endsWith("🗺"), "an astral character at the limit is kept whole");
  for (const invalid of ["x", 7, "1000_1", "90_1", "46_180", "046_9", "-0_9"]) bad({ cells: ["46_9", invalid] });
  assert.deepEqual(C.cellPlan(ix, { lat: 46.8, lon: 9.2 }, 30).sort(), ["46_9", "47_9"], "only listed cells");
  assert.deepEqual(C.cellPlan(ix, { lat: 40.4, lon: -3.7 }, 60), [], "outside coverage");
  assert.equal(C.outsideMessage(ix.coverage), "No landmark data here yet. Germany and Austria for now.");
  assert.equal(C.outsideMessage(["DE"]), "No landmark data here yet. Germany for now.");
  assert.equal(C.outsideMessage([]), "No landmark data here yet.");
});

check("cell parsing: p is the feature's positionM; e and w kept; invalid p rejects the cell; all malformed records reject the cell; mismatched cells rejected", () => {
  const ix = C.parseIndex(JSON.stringify(INDEX));
  const f = C.parseCell(ix, "46_9", cellText("46_9", [
    ["Piz Test", "peak", 46.9, 9.3, 3012, 1.8, 8],
    ["St. Test", "church", 46.85, 9.25, 0, 1.1, 16],
    ["Places Church", "church", 46.84, 9.24, 0, 1.1, 60],
    ["Test Memorial", "monument", 46.7, 9.1, 0, 1, 60],
    ["Test Dam", "dam", 46.71, 9.11, 120, 2, 130],
    ["Places Peak", "peak", 46.73, 9.13, 2100, 1.5, 250],
    ["Small bound", "tower", 46.72, 9.12, 0, 0.5, 5],
    ["Big bound", "tower", 46.74, 9.14, 0, 1, 1000],
  ]));
  assert.deepEqual(f.map((x) => x.name), ["Piz Test", "St. Test", "Places Church", "Test Memorial", "Test Dam", "Places Peak", "Small bound", "Big bound"]);
  const [peak, church, placesChurch, memorial, dam, placesPeak, odd, big] = f;
  // Mixed p for the same kind: each feature carries its own, no kind default.
  assert.deepEqual(f.map((x) => x.positionM), [8, 16, 60, 60, 130, 250, 5, 1000], "p used directly as positionM");
  assert.deepEqual(f.map((x) => x.p), [8, 16, 60, 60, 130, 250, 5, 1000]);
  assert.notEqual(church.positionM, placesChurch.positionM);
  assert.notEqual(peak.positionM, placesPeak.positionM);
  assert.equal(peak.e, 3012);
  assert.equal(peak.w, 1.8);
  assert.equal(peak.maxKm, 100, "peaks may count beyond 40 km");
  assert.equal(church.maxKm, undefined);
  assert.equal(peak.dataset, INDEX.dataset);
  assert.equal(dam.w, 2, "valid maximum weight preserved");
  assert.deepEqual([odd.e, odd.w], [0, 0.5], "valid minimum weight preserved");
  const cands = C.candidatesOf([peak, placesChurch, big]);
  assert.deepEqual(cands.map((c) => [c.weight, c.positionM]), [[1.8, 8], [1.1, 60], [1, 1000]], "the solver's prior is w and its position σ is p");
  assert.equal(C.markFrom(placesChurch, 0.4, 0.5).positionM, 60, "a mark keeps the feature's own p");
  assert.equal(memorial.positionM, 60);
  const rejected = (body, re = /./) => assert.throws(() => C.parseCell(ix, "46_9", body), (e) => e.code === "DATA_INVALID" && e.retry && re.test(e.message));
  rejected(cellText("46_9", [], { schema: 2 }), /dataset/);
  rejected(cellText("46_9", [], { release: "2026-08-20.0" }), /dataset/);
  rejected(cellText("46_9", [], { revision: 2 }), /dataset/);
  rejected(cellText("46_9", [], { revision: "1" }), /dataset/);
  rejected(cellText("46_9", [], { revision: undefined }), /dataset/);
  rejected(cellText("46_9", [], { cell: [47, 9] }), /malformed/);
  for (const cell of [undefined, null, "46_9", [46], [46, 9, 0]])
    rejected(cellText("46_9", [], { cell }), /malformed/);
  rejected(cellText("46_9", {}), /malformed/);
  rejected(JSON.stringify({ schema: 1, release: INDEX.release, revision: INDEX.revision, cell: [46, 9] }), /malformed/);
  rejected("{", /unreadable/);
  assert.deepEqual(C.parseCell(ix, "46_9", cellText("46_9", [])), [], "an empty feature list is a valid cell");
  assert.equal(C.parseCell(ix, "47_-1", cellText("47_-1", [["Phare", "tower", 47.5, -0.5, 0, 1, 8]])).length, 1);
});

check("invalid uncertainty rejects both wholly invalid and mixed valid/invalid cells", () => {
  const ix = C.parseIndex(JSON.stringify(INDEX));
  const valid = ["Valid", "peak", 46.9, 9.3, 3012, 1.8, 8];
  for (const p of [undefined, null, "8", 8.5, 4, 0, 1001]) {
    const bad = p === undefined ? valid.slice(0, 6) : [...valid.slice(0, 6), p];
    for (const rows of [[bad], [valid, bad]])
      assert.throws(() => C.parseCell(ix, "46_9", cellText("46_9", rows)), { code: "DATA_INVALID" });
  }
});

check("malformed feature fields reject mixed cells instead of silently repairing ranking or dropping rows", () => {
  const ix = C.parseIndex(JSON.stringify(INDEX)), valid = ["Valid", "tower", 46.9, 9.3, 80, 1.3, 8];
  const changes = [[0, ""], [0, " "], [0, 42], [0, "a".repeat(81)], [0, "\u202e"], [0, "e\u0301"], [1, "bakery"],
    [2, 47], [2, null], [2, 46.900001], [3, 10], [4, null], [4, "80"], [4, 80.1],
    ...[null, "1", -1, 0.4, 2.1, 1.23].map((v) => [5, v])];
  const invalid = changes.map(([at, value]) => valid.map((v, i) => i === at ? value : v));
  invalid.push([...valid, "extra"]);
  for (const row of invalid) for (const rows of [[row], [valid, row]])
    assert.throws(() => C.parseCell(ix, "46_9", cellText("46_9", rows)), { code: "DATA_INVALID" });
});

check("feature labels are sanitized before search, identity and saved marks, including published Overture direction marks", () => {
  const ix = C.parseIndex(JSON.stringify(INDEX));
  for (const raw of ["Tower\nOther", "Tower\u202eOther", "Tower\ud800Other", "TowerOther\u200e"]) {
    const f = C.parseCell(ix, "46_9", cellText("46_9", [[raw, "tower", 46.9, 9.3, 80, 1.3, 8]]))[0];
    assert.equal(f.name, "TowerOther");
    assert.equal(C.markFrom(f, 0.4, 0.5).name, f.name);
    assert.equal(C.featureKey(f), "TowerOther|tower|46.90000|9.30000");
  }
});

check("#40: names are bounded in code points, so an astral character at the limit is never split", () => {
  const wellFormed = (s) => (encodeURIComponent(s), true);
  const ix = C.parseIndex(JSON.stringify(INDEX)),
    edge = "a".repeat(79) + "𝔸"; // 80 code points, 81 UTF-16 units
  const f = C.parseCell(ix, "46_9", cellText("46_9", [[edge, "tower", 46.9, 9.3, 80, 1.3, 8]]))[0];
  assert.equal(f.name, edge, "a valid 80-code-point feature label is kept whole");
  assert.equal(C.markFrom(f, 0.4, 0.5).name, edge, "and stored whole in its mark");
  assert.equal(C.featureKey(f), edge + "|tower|46.90000|9.30000");
  assert.throws(() => C.parseCell(ix, "46_9", cellText("46_9", [[edge + "b", "tower", 46.9, 9.3, 80, 1.3, 8]])), { code: "DATA_INVALID" }, "81 code points reject the cell");
  const stored = (name) => C.cleanSidecar({ marks: [mark(1, { name })] }).marks[0].name;
  assert.equal(stored(edge), edge);
  assert.equal(stored("a".repeat(80) + "𝔸"), "a".repeat(80), "the 81st code point goes as a whole");
  const astral = stored("𝔸".repeat(100));
  assert.ok(wellFormed(astral) && [...astral].length === C.NAME_MAX && astral.length === 2 * C.NAME_MAX);
  assert.equal(stored("x".repeat(79) + " 𝔸"), "x".repeat(79), "no trailing space left by the cut");
});

check("declination: an optional additive cell field, kept when valid, otherwise absent and never a cell error", () => {
  const ix = C.parseIndex(JSON.stringify(INDEX)),
    rows = [["Tower", "tower", 46.9, 9.3, 80, 1.3, 8]];
  const read = (extra) => C.readCell(ix, "46_9", cellText("46_9", rows, extra));
  assert.equal(read({ declination: 2.4 }).declination, 2.4);
  assert.equal(read({}).declination, null, "older cells have none");
  for (const d of [180, -180, 0, -3.1]) assert.equal(read({ declination: d }).declination, d);
  for (const d of [null, "2.4", 180.1, -181, 1e9, [], {}, true]) assert.equal(read({ declination: d }).declination, null, JSON.stringify(d));
  assert.deepEqual(read({ declination: "x" }).features, read({ declination: 2.4 }).features, "features are unaffected either way");
  assert.deepEqual(C.parseCell(ix, "46_9", cellText("46_9", rows, { declination: 2.4 })), read({}).features, "parseCell still returns the feature list");
  const fx = C.parseIndex(F.index());
  assert.deepEqual(F.cells.map((c) => C.readCell(fx, c, F.cell(c)).declination), [2.7, 3, 3.2], "every fixture cell carries one");
});

// ---- API 0.13 capture metadata → measured solver inputs ---------------------
const FULL = F.capture("full");
check("capture metadata: validated per field group, rounded, optional; sidecars without it load as before", () => {
  const host = { zoomRatio: 2.0, fovDeg: { h: 33.6, v: 43.9 }, fovSigmaDeg: 1.0, tilt: { pitchDeg: 4.2, rollDeg: -0.8, sigmaDeg: 1.0, ageMs: 31 }, headingDeg: 212.5, headingRef: "magnetic", headingAccuracyDeg: 11.5, headingAgeMs: 44 };
  assert.deepEqual(C.cleanCapture(host), host, "the contract's example is kept as is");
  assert.deepEqual(C.cleanCapture({ ...host, tilt: { ...host.tilt, pitchDeg: 4.123456789 } }).tilt.pitchDeg, 4.12);
  const only = (patch) => C.cleanCapture({ ...host, ...patch });
  assert.equal(only({ fovSigmaDeg: undefined }).fovDeg, undefined, "a lens angle without its σ is dropped");
  assert.equal(only({ fovDeg: { h: "33" , v: 43.9 } }).fovDeg, undefined);
  assert.equal(only({ tilt: { ...host.tilt, ageMs: undefined } }).tilt, undefined);
  assert.equal(only({ tilt: { ...host.tilt, sigmaDeg: 0 } }).tilt, undefined);
  assert.equal(only({ headingRef: "true" }).headingDeg, undefined, "only the contract's magnetic reference");
  assert.equal(only({ headingAccuracyDeg: undefined }).headingDeg, undefined, "no invented heading σ");
  assert.equal(only({ zoomRatio: 0 }).zoomRatio, undefined);
  assert.deepEqual(Object.keys(only({ headingDeg: NaN })), ["zoomRatio", "fovDeg", "fovSigmaDeg", "tilt"]);
  assert.equal(C.cleanCapture({ junk: 1 }), null);
  assert.equal(C.cleanCapture("x"), null);
  const s = C.newSidecar({ lat: 46.8, lon: 9.2, accuracyM: 10 }, 30, host);
  assert.deepEqual(s.capture, host);
  assert.deepEqual(C.cleanSidecar(structuredClone(s)), s, "round-trips unchanged");
  // A 0.1.x record (and a library photo) has no capture key and none is added.
  const old = C.cleanSidecar({ viewer: { lat: 46.8, lon: 9.2 }, marks: [mark(1)] });
  assert.equal("capture" in old, false);
  assert.equal("capture" in C.newSidecar(null), false);
  assert.deepEqual(C.measuredInputs(old.capture, 1024, 768), { input: {}, used: { level: false, lens: false, compass: false }, skipped: {}, prior: null });
  assert.deepEqual(C.calibrationInput(old, 1024, 768, 3), C.calibrationInput(old, 1024, 768), "nothing measured is passed");
});

check("measured inputs map to the solver: fov = h across the opened image, tilt in the solver's signs, heading only with a declination", () => {
  const m = C.measuredInputs(FULL, F.width, F.height, 3);
  assert.deepEqual(m.input, { tilt: { pitch: 4, roll: 1.5, sigma: 1 }, fov: 66, fovSigma: 1, heading: 27, headingRef: "magnetic", declination: 3, headingSigma: 12 });
  assert.deepEqual(m.used, { level: true, lens: true, compass: true });
  // Sign: true = magnetic + declination east. The solver's compass-only fit
  // lands on the scene's true heading (30°), not 24° (magnetic − declination).
  const compassOnly = R.calibrate({ viewer: F.viewer, marks: [], width: F.width, height: F.height, ...m.input });
  assert.ok(Math.abs(R.diff(compassOnly.heading, F.pose.heading)) < 0.5, "true heading " + compassOnly.heading);
  assert.deepEqual(C.compassHeading(FULL, 3), { bearing: 30, sigmaDeg: 12 }, "the solver's 12° floor");
  assert.deepEqual(C.compassHeading(FULL, -2.5), { bearing: 24.5, sigmaDeg: 12 }, "west declination subtracts");
  // No declination (cell not downloaded, or older data): the heading is skipped.
  for (const d of [null, undefined, NaN, 200]) {
    const none = C.measuredInputs(FULL, F.width, F.height, d);
    assert.equal(none.input.heading, undefined);
    assert.equal(none.used.compass, false);
    assert.equal(none.skipped.compass, "declination");
    assert.equal(C.compassHeading(FULL, d), null);
    assert.doesNotThrow(() => R.calibrate(C.calibrationInput(C.cleanSidecar({ viewer: F.viewer, marks: [mark(1, { lat: 46.9, lon: 9.3 })], capture: FULL }), F.width, F.height, d)), "never a magnetic heading without declination");
  }
  // Stale, sideways or unreliable groups are simply not used.
  const skip = (patch, key, why) => {
    const r = C.measuredInputs(C.cleanCapture({ ...FULL, ...patch }), F.width, F.height, 3);
    assert.equal(r.used[key], false, why);
    assert.equal(r.skipped[key], why);
  };
  skip({ tilt: { ...FULL.tilt, ageMs: 251 } }, "level", "old");
  skip({ tilt: { ...FULL.tilt, rollDeg: 90 } }, "level", "sideways");
  skip({ tilt: { ...FULL.tilt, pitchDeg: -89.5 } }, "level", "sideways");
  skip({ headingAgeMs: 1001 }, "compass", "unreliable");
  skip({ headingAccuracyDeg: 50 }, "compass", "unreliable");
  skip({ fovDeg: { h: 15, v: 11.3 } }, "lens", "range");
  // Axis check: h must run across the image as opened. Swapped h/v (a
  // portrait reading for this landscape image) is not used.
  skip({ fovDeg: { h: 51.9, v: 66 } }, "lens", "orientation");
  const portrait = C.measuredInputs({ fovDeg: { h: 51.9, v: 66 }, fovSigmaDeg: 1 }, 768, 1024);
  assert.equal(portrait.input.fov, 51.9, "a portrait photo has h < v");
  // The contract's 2× example (portrait 3:4): h 33.6°, v 43.9° agree with 3000 × 4000.
  assert.equal(C.measuredInputs({ fovDeg: { h: 33.6, v: 43.9 }, fovSigmaDeg: 1 }, 3000, 4000).input.fov, 33.6);
  assert.equal(C.measuredInputs({ tilt: { pitchDeg: 1, rollDeg: 1, sigmaDeg: 0.5, ageMs: 1 } }, 4, 3).input.tilt.sigma, 1, "σ never below 1°");
});

check("host boundary metadata survives storage without precision loss or false omission", () => {
  const raw = { ...FULL, zoomRatio: 1.0010000467300415, headingAccuracyDeg: 0 };
  const stored = C.cleanSidecar(C.newSidecar(F.viewer, 30, raw)).capture;
  assert.equal(stored.zoomRatio, raw.zoomRatio);
  assert.equal(stored.headingAccuracyDeg, 0);
  const inputs = C.measuredInputs(stored, F.width, F.height, 3);
  assert.equal(inputs.used.compass, true);
  assert.ok(inputs.input.headingSigma >= 12, "solver keeps the conservative compass floor");
  assert.doesNotThrow(() => R.calibrate({ viewer: F.viewer, marks: [], width: F.width, height: F.height, ...inputs.input }));
  assert.deepEqual(C.compassHeading(stored, 3), { bearing: 30, sigmaDeg: 12 });
});

check("measured tilt and lens keep the synthetic ranking and tighten the fit without horizon taps", () => {
  const ix = C.parseIndex(F.index());
  const features = C.within(F.cells.flatMap((c) => C.parseCell(ix, c, F.cell(c))), F.viewer, 30);
  const tower = features.find((f) => f.name === "Synthetic Tower A");
  const base = { viewer: { lat: F.viewer.lat, lon: F.viewer.lon, accuracyM: 10 }, marks: [C.markFrom(tower, F.taps.markA.x, F.taps.markA.y)] };
  const fit = (capture, declination = null) => R.calibrate(C.calibrationInput(C.cleanSidecar({ ...base, capture }), F.width, F.height, declination));
  const guessed = fit(null),
    measured = fit(F.capture("no heading")),
    all = fit(FULL, 3);
  assert.equal(measured.tilt, "measured");
  assert.equal(guessed.tilt, "none");
  assert.ok(Math.abs(measured.fov - 66) < 1 && Math.abs(measured.pitch - 4) < 1 && Math.abs(measured.roll - 1.5) < 1);
  const error = (cal, tap, name) => Math.abs(R.diff(R.bearingAt(cal, F.taps[tap].x, F.taps[tap].y), R.bearing(cal.viewer, features.find((f) => f.name === name))));
  for (const [tap, name] of [["whatB", "Synthetic Peak B"], ["whatD", "Synthetic Castle D"]]) {
    for (const cal of [measured, all]) {
      const list = C.shortlist(R.rank(cal, F.taps[tap].x, F.taps[tap].y, C.candidatesOf(features)));
      assert.equal(list.rows[0].candidate.feature.name, name, tap);
      assert.ok(error(cal, tap, name) < 0.3 && error(cal, tap, name) < error(guessed, tap, name), `${tap}: ${error(cal, tap, name)} vs ${error(guessed, tap, name)}`);
      assert.ok(R.uncertainty(cal, F.taps[tap].x, F.taps[tap].y) < R.uncertainty(guessed, F.taps[tap].x, F.taps[tap].y));
    }
  }
  // Measured tilt and horizon taps together: both are observations; the fit still agrees.
  const both = R.calibrate(C.calibrationInput(C.cleanSidecar({ ...base, horizon: F.taps.horizon, capture: FULL }), F.width, F.height, 3));
  assert.ok(Math.abs(both.pitch - 4) < 0.5 && Math.abs(both.roll - 1.5) < 0.5 && both.horizonPoints === 2);
});

check("zoom-aware lens prior: 2·atan(tan 35°·(width/long)/z) with the 1× prior's 8° carried through the crop; nothing at 1×", () => {
  assert.equal(C.LENS_PRIOR_SIGMA, R.FOV_PRIOR_SIGMA, "the solver's default σ");
  const p2 = C.lensPrior({ zoomRatio: 2 }, 4000, 3000);
  assert.ok(Math.abs(p2.fov - 38.59) < 0.01 && Math.abs(p2.fovSigma - 5.31) < 0.01 && p2.zoom === 2, JSON.stringify(p2));
  const portrait = C.lensPrior({ zoomRatio: 2 }, 3000, 4000);
  assert.ok(Math.abs(portrait.fov - (2 * Math.atan((Math.tan((35 * Math.PI) / 180) * 0.75) / 2) * 180) / Math.PI) < 1e-9, "portrait is narrower across its width");
  // Continuity with the solver's own default at 1×.
  const near1 = C.lensPrior({ zoomRatio: 1.06 }, 3000, 4000);
  assert.ok(Math.abs(near1.fov - R.defaultFov(3000, 4000) / 1.06) < 2 && near1.fovSigma < 8);
  for (const c of [null, {}, { zoomRatio: 1 }, { zoomRatio: 1.02 }, { zoomRatio: "2" }]) assert.equal(C.lensPrior(c, 4000, 3000), null, JSON.stringify(c));
  // A measured lens wins; the prior is only for a lens the camera did not report.
  assert.equal(C.measuredInputs({ ...FULL, zoomRatio: 2 }, F.width, F.height).prior, null);
  assert.equal(C.measuredInputs({ zoomRatio: 2 }, F.width, F.height).prior.zoom, 2);
  const input = C.calibrationInput(C.cleanSidecar({ viewer: F.viewer, marks: [mark(1)], capture: { zoomRatio: 2 } }), 4000, 3000);
  assert.deepEqual([input.fov.toFixed(2), input.fovSigma.toFixed(2)], ["38.59", "5.31"]);
  assert.equal(C.calibrationInput(C.cleanSidecar({ viewer: F.viewer, marks: [mark(1)], capture: { zoomRatio: 1 } }), 4000, 3000).fov, undefined, "1×: the solver's default");
});

check("Fable's 2× case: two marks on one side, a target outside them; the zoom-aware prior removes the outward bias", () => {
  // A 2× photo whose lens was not reported (Pixel 8a, alpha33): the 70° default
  // is pulled to ~40–42° by the marks and pushes targets beyond them outward.
  // Marks carry a 2 px inward tap error; the true 1× lens is 68°, 70° or 72°.
  const W = 1024, H = 768, viewer = { lat: 52.37, lon: 9.73, accuracyM: 10 };
  const rows = [];
  for (const half1 of [34, 35, 36]) {
    const P = { heading: 120, fov: (2 * Math.atan(Math.tan((half1 * Math.PI) / 180) / 2) * 180) / Math.PI, pitch: 2, roll: 0.5, aspect: H / W },
      row = (x) => R.horizonRow(P, x),
      at = (x, km) => R.destination(viewer, R.azimuthOf(P, P.aspect, x, row(x)), km);
    const marks = [[0.1, 6, 0.002, "Tower", 8], [0.6, 9, -0.002, "Church", 16]].map(([x, d, e, name, p]) => ({ x: x + e, y: row(x), kind: "tower", name, ...at(x, d), positionM: p, dataset: "" })),
      target = at(0.95, 9.3),
      sidecar = (capture) => C.cleanSidecar({ viewer, marks, capture });
    const bias = (capture) => {
      const cal = R.calibrate(C.calibrationInput(sidecar(capture), W, H));
      return { cal, bias: R.diff(R.bearingAt(cal, 0.95, row(0.95)), R.bearing(cal.viewer, target)) };
    };
    const tilt = { pitchDeg: 2, rollDeg: 0.5, sigmaDeg: 1, ageMs: 20 },
      guess = bias({ zoomRatio: 1, tilt }), // 0.2.0 behaviour: the 1× default
      zoomed = bias({ zoomRatio: 2, tilt });
    rows.push(`true ${P.fov.toFixed(2)}°: 70° default fits ${guess.cal.fov.toFixed(2)}° → ${guess.bias.toFixed(3)}° (${Math.round((guess.bias * Math.PI * 9300) / 180)} m at 9.3 km); 2× prior fits ${zoomed.cal.fov.toFixed(2)}° → ${zoomed.bias.toFixed(3)}°`);
    assert.ok(guess.bias > 0.9, "outward, as on hardware: " + guess.bias);
    assert.ok(Math.abs(zoomed.bias) < 0.3 && Math.abs(zoomed.bias) < guess.bias / 4, "zoom-aware: " + zoomed.bias);
    // Two marks this far apart do fit the lens; the panel names the prior it started from.
    const m = C.measuredInputs({ zoomRatio: 2, tilt }, W, H),
      panel = C.calibrationDetails({ capture: { zoomRatio: 2, tilt }, width: W, height: H, measured: m, cal: zoomed.cal, viewer, marks: [] });
    assert.equal(C.lensFit(zoomed.cal, m).source, "fitted");
    assert.match(panel[1].rows[0][1], /^\d+\.\d° ±\d\.\d° · fitted from your marks \(prior: default for 2×, 38\.6° ±5\.3°\)$/);
  }
  console.log("  " + rows.join("\n  "));
});

check("lens source and the calibration details panel (raw capture, used or why not, the fit, marks, viewpoint)", () => {
  const ix = C.parseIndex(F.index());
  const features = F.cells.flatMap((c) => C.parseCell(ix, c, F.cell(c)));
  const tower = features.find((f) => f.name === "Synthetic Tower A");
  const make = (capture, declination = 3) => {
    const sc = C.cleanSidecar({ viewer: { lat: F.viewer.lat, lon: F.viewer.lon, accuracyM: 10 }, marks: [C.markFrom(tower, F.taps.markA.x, F.taps.markA.y)], capture });
    const measured = C.measuredInputs(sc.capture, F.width, F.height, declination),
      cal = R.calibrate(C.calibrationInput(sc, F.width, F.height, declination));
    const residualDeg = R.diff(R.bearingAt(cal, F.taps.markA.x, F.taps.markA.y), R.bearing(cal.viewer, tower));
    return { cal, measured, text: C.calibrationDetails({ capture: sc.capture, width: F.width, height: F.height, declination, measured, cal, viewer: sc.viewer,
      viewpoint: { offsetM: 3.4, sigmaM: 9.6 }, marks: [{ name: tower.name, kind: "tower", positionM: 8, residualDeg, distanceKm: R.distance(cal.viewer, tower) }] }) };
  };
  const flat = (sections) => sections.map((s) => s.title + "\n" + s.rows.map(([k, v]) => k + ": " + v).join("\n")).join("\n");
  const full = flat(make(FULL).text);
  assert.match(full, /Zoom: 1×/);
  assert.match(full, /Lens: h 66\.0° v 51\.9° ±1\.0° — used/);
  assert.match(full, /Tilt: pitch \+4\.0° roll \+1\.5° ±1\.0° · 18 ms — used/);
  assert.match(full, /Compass: 27\.0° magnetic ±10\.0° · 40 ms — used/);
  assert.match(full, /Declination: \+3\.0° E \(viewpoint cell\) → true 30\.0°/);
  assert.match(full, /Lens used: 66\.0° ±1\.0° · from the camera/);
  assert.match(full, /Level: pitch \+4\.0° roll \+1\.\d° ±1\.0° · measured/);
  assert.match(full, /1 Synthetic Tower A: tower · ±8 m · residual [+−]0\.\d\d° ≈ \d+ m at 6\.0 km/);
  assert.match(full, /Viewpoint: phone location · ±10 m/);
  assert.match(full, /Fitted: 3 m from the saved one · ±10 m/);
  // Missing and skipped groups say why, in words.
  const noLens = flat(make({ ...F.capture("no lens"), zoomRatio: 2 }).text);
  assert.match(noLens, /Lens: not reported by the camera/);
  assert.match(noLens, /Lens used: \d+\.\d° ±\d+\.\d° · default for 2× \(prior 38\.6° ±5\.3°\)/);
  assert.match(flat(make(F.capture("no lens")).text), /Lens used: .* · default guess \(70° across the long edge\)/);
  // The 66° scene labelled 2× (no lens reported): two marks pull the lens far
  // from the 2× default, so it is reported as fitted, with a warning.
  const sc = C.cleanSidecar({ viewer: { lat: F.viewer.lat, lon: F.viewer.lon, accuracyM: 10 }, capture: { zoomRatio: 2, tilt: FULL.tilt },
    marks: [C.markFrom(tower, F.at.A.x, F.at.A.y), C.markFrom(features.find((f) => f.name === "Synthetic Castle D"), F.at.D.x, F.at.D.y)] });
  const pulled = C.lensFit(R.calibrate(C.calibrationInput(sc, F.width, F.height)), C.measuredInputs(sc.capture, F.width, F.height));
  assert.equal(pulled.source, "fitted");
  assert.match(pulled.label, /far from the default: check the marks and zoom/);
  const swapped = flat(make({ ...FULL, fovDeg: { h: 51.9, v: 66 } }).text);
  assert.match(swapped, /Lens: h 51\.9° v 66\.0° ±1\.0° — doesn't match the photo's shape \(h\/v 51\.9°\/66\.0°, image 1024×768\)/);
  assert.match(flat(make({ ...FULL, tilt: { ...FULL.tilt, ageMs: 400 } }).text), /Tilt: pitch \+4\.0° roll \+1\.5° ±1\.0° · 400 ms — too old \(400 ms\)/);
  assert.match(flat(make({ ...FULL, tilt: { ...FULL.tilt, rollDeg: 91 } }).text), /photo held sideways \(pitch \+4\.0°, roll \+91\.0°\)/);
  assert.match(flat(make({ ...FULL, headingAgeMs: 1500 }).text), /Compass: .* — too old \(1500 ms\)/);
  assert.match(flat(make({ ...FULL, headingAccuracyDeg: 60 }).text), /Compass: .* — too inaccurate \(±60\.0°\)/);
  const noDecl = flat(make(FULL, null).text);
  assert.match(noDecl, /Compass: 27\.0° magnetic .* — no declination for this area yet/);
  assert.match(noDecl, /Declination: none for this area yet/);
  const library = flat(make(null).text);
  assert.match(library, /Camera: no measurements \(library photo, or taken before Aimé 0\.2\)/);
  assert.match(library, /Zoom: 1× \(assumed\)/);
  assert.match(library, /Level: .* · assumed/);
  assert.match(flat(C.calibrationDetails({ capture: null, width: 4, height: 3, cal: null, calError: "", viewer: null, marks: [] })), /Fit: not calibrated \(mark a landmark you know\)\nMarks\n: none yet\nViewpoint\nViewpoint: none/);
  // Search-result precision hint.
  assert.equal(C.precision({ positionM: 8 }), "±8 m, precise");
  assert.equal(C.precision({ positionM: 16 }), "±16 m, precise");
  assert.equal(C.precision({ positionM: 60 }), "±60 m");
  assert.equal(C.precision({}), "");
});

check("outside-your-marks hint: beyond the leftmost/rightmost mark, or far from a single mark; out-of-frame pins by side", () => {
  const two = [0.3, 0.6];
  assert.equal(C.marksHint([], 0.9), null, "no marks: nothing to say");
  assert.equal(C.marksHint(two, 0.45), null, "between the marks");
  assert.equal(C.marksHint(two, 0.605), null, "within 1 % of the rightmost");
  assert.deepEqual(C.marksHint(two, 0.95), { side: "right", text: "Outside your marks: add one on the right for better precision." });
  assert.deepEqual(C.marksHint([0.6, 0.3, 0.5], 0.1), { side: "left", text: "Outside your marks: add one on the left for better precision." });
  for (const side of ["left", "behind-left"]) assert.equal(C.marksHint(two, 0, side).side, "left");
  for (const side of ["right", "behind-right"]) assert.equal(C.marksHint(two, 1, side).side, "right");
  assert.equal(C.marksHint(two, 0.45, "above"), null, "above/below use the anchor column");
  const one = C.marksHint([0.4], 0.46);
  assert.deepEqual(one, { side: "second", text: "Add a second mark on the other side of your target for better precision." });
  assert.equal(C.marksHint([0.4], 0.44), null, "within 5 % of a single mark");
  assert.equal(C.marksHint([0.4], 0.4, "behind-left").side, "second");
  // Fable's 2× case: both marks left of the target.
  assert.equal(C.marksHint([0.1, 0.6], 0.95).side, "right");
});

check("newer data for a saved mark: same name and kind within 200 m, different position or p; update keeps the tap and is undoable", () => {
  const r1 = { x: 0.31, y: 0.52, kind: "tower", name: "Telemoritz", lat: 52.36544, lon: 9.74212, positionM: 60, dataset: "2026-09-23.1-r1" };
  const feature = (extra = {}) => ({ name: "Telemoritz", kind: "tower", lat: 52.36571, lon: 9.74190, positionM: 8, p: 8, e: 282, w: 1.8, dataset: "2026-09-23.1-r2", ...extra });
  const n = C.newerMark(r1, "2026-09-23.1-r2", [feature({ name: "Other" }), feature()]);
  assert.ok(n && n.fromM === 60 && n.toM === 8 && Math.abs(n.moveM - C.metres(r1, feature())) < 1e-9 && n.moveM > 30 && n.moveM < 40, JSON.stringify(n));
  assert.equal(C.newerText(n), `newer data: ±60 m → ±8 m, moved ${Math.round(n.moveM)} m`);
  assert.equal(C.newerText({ fromM: 60, toM: 16, moveM: 0 }), "newer data: ±60 m → ±16 m");
  assert.equal(C.newerMark(r1, "2026-09-23.1-r1", [feature()]), null, "same dataset: nothing newer");
  assert.equal(C.newerMark(r1, "2026-09-23.1-r2", [feature({ kind: "mast" })]), null, "kind must match");
  assert.equal(C.newerMark(r1, "2026-09-23.1-r2", [feature({ lat: 52.3674 })]), null, "beyond 200 m is another landmark");
  assert.equal(C.newerMark(r1, "2026-09-23.1-r2", [feature({ lat: r1.lat, lon: r1.lon, positionM: 60 })]), null, "unchanged position and p");
  assert.ok(C.newerMark(r1, "2026-09-23.1-r2", [feature({ lat: r1.lat, lon: r1.lon, positionM: 16 })]), "p alone changed");
  assert.ok(C.newerMark({ ...r1, dataset: "" }, "2026-09-23.1-r2", [feature()]), "unknown dataset (0.1.3–0.1.x marks) counts as older");
  assert.equal(C.newerMark(legacyMark(1), "2026-09-23.1-r2", [feature({ name: "Mark 1" })]), null, "legacy OSM marks have no kind to match");
  assert.equal(C.newerMark(r1, null, [feature()]), null, "no index yet");
  // The two nearest candidates: the closer one wins.
  assert.equal(C.newerMark(r1, "2026-09-23.1-r2", [feature({ lat: 52.3665 }), feature()]).feature.lat, 52.36571);
  const updated = C.refreshMark(r1, n.feature);
  assert.deepEqual(updated, { x: 0.31, y: 0.52, kind: "tower", name: "Telemoritz", lat: 52.36571, lon: 9.7419, positionM: 8, dataset: "2026-09-23.1-r2" });
  assert.equal(C.newerMark(updated, "2026-09-23.1-r2", [feature()]), null, "nothing newer after the update");
  const sidecar = C.cleanSidecar({ viewer: { lat: 52.37648, lon: 9.73848, accuracyM: 10 }, marks: [r1, mark(2)] });
  const step = C.undoStep("pA", sidecar, "updating Telemoritz"),
    after = C.cleanSidecar({ ...sidecar, marks: sidecar.marks.map((k, i) => (i === 0 ? C.refreshMark(k, n.feature) : k)) });
  assert.deepEqual(C.undone(after, step).marks, sidecar.marks, "undo restores the old position and p");
  // The panel shows it under the mark, with the update action.
  const panel = C.calibrationDetails({ capture: null, width: 4000, height: 3000, cal: null, viewer: sidecar.viewer, marks: [{ name: "Telemoritz", kind: "tower", positionM: 60, residualDeg: null, distanceKm: 1, newer: n }] });
  assert.deepEqual(panel[2].rows[1], ["", C.newerText(n), { action: "update", index: 0 }]);
});

check("landmark search orders by direction from the tap (in 2σ steps), then nearest; plain nearest first otherwise", () => {
  const ix = C.parseIndex(F.index());
  const features = F.cells.flatMap((c) => C.parseCell(ix, c, F.cell(c)));
  const names = (rows) => rows.map((r) => r.feature.name.replace("Synthetic ", ""));
  assert.equal(C.bearing(F.viewer, features[0]).toFixed(9), R.bearing(F.viewer, features[0]).toFixed(9));
  const nearest = C.search(features, "", F.viewer);
  assert.deepEqual(names(nearest).slice(0, 3), ["Chapel G", "Church C", "Monument F"]);
  assert.ok(nearest.every((r) => !("offDeg" in r)));
  // Toward Peak B (42°) in 4° steps: B and Mast E (45°) share the first step, B is nearer.
  const toward = C.search(features, "", F.viewer, 30, { bearing: 42, stepDeg: 4 });
  assert.deepEqual(names(toward).slice(0, 3), ["Peak B", "Mast E", "Transmitter H"]);
  assert.ok(toward[0].offDeg < 0.1 && toward[1].offDeg > 2.9);
  // Coarse steps (a compass hint's ±24°) fall back to nearest within the step.
  assert.deepEqual(names(C.search(features, "", F.viewer, 30, { bearing: 42, stepDeg: 24 })).slice(0, 6), ["Church C", "Castle D", "Peak B", "Mast E", "Transmitter H", "Chapel G"]);
  assert.deepEqual(names(C.search(features, "peak", F.viewer, 30, { bearing: 235, stepDeg: 4 })), ["Far Peak Z", "Peak B"], "the text filter still applies");
});

check("kind labels cover every contract kind with a fallback", () => {
  for (const kind of CONTRACT_KINDS) {
    const label = C.kindLabel({ kind });
    assert.ok(label && !label.includes("_"), kind + " → " + label);
  }
  assert.equal(C.kindLabel({ kind: "communication_tower" }), "communication tower");
  assert.equal(C.kindLabel({ kind: "observation" }), "observation tower");
  assert.equal(C.kindLabel({ kind: "future_kind" }), "future kind");
  assert.equal(C.kindLabel({ osmType: "node", osmId: 1 }), "landmark", "legacy mark");
  assert.equal(C.kindLabel({ kind: 7 }), "landmark");
  assert.equal(C.sizeLabel({ kind: "peak", e: 2400 }), "2400 m");
  assert.equal(C.sizeLabel({ kind: "tower", e: 80 }), "80 m tall");
  assert.equal(C.sizeLabel({ kind: "church", e: 0 }), "");
});

check("feature identity is name + kind + position to 5 decimals; legacy OSM marks still load and calibrate", () => {
  const a = { name: "Tower", kind: "tower", lat: 46.123451, lon: 9.1 };
  assert.equal(C.featureKey(a), "Tower|tower|46.12345|9.10000");
  assert.ok(C.sameFeature(a, { ...a, lat: 46.123449, e: 5 }));
  assert.ok(!C.sameFeature(a, { ...a, kind: "mast" }));
  assert.ok(!C.sameFeature(a, { ...a, name: "Tower 2" }));
  assert.ok(!C.sameFeature(a, { ...a, lon: 9.10002 }));
  assert.equal(C.within([a, { ...a }, { ...a, lat: 50 }], { lat: 46.12, lon: 9.1 }, 10).length, 1, "deduplicated and within the radius");
  // A stored 0.1.2 sidecar: marks with osmType/osmId load, keep their shape and round-trip.
  const legacy = C.cleanSidecar({ viewer: { lat: 46.8, lon: 9.2, accuracyM: 10 }, marks: [legacyMark(1), legacyMark(2, { osmType: "way", positionM: undefined, name: "" })] });
  assert.deepEqual(legacy.marks[0], legacyMark(1));
  assert.equal(legacy.marks[1].positionM, 30, "way centre estimate");
  assert.equal(legacy.marks[1].name, "way/102");
  assert.deepEqual(C.cleanSidecar(structuredClone(legacy)), legacy, "unchanged on every re-save");
  assert.equal(C.cleanSidecar({ marks: [legacyMark(1, { osmType: "area" })] }).marks.length, 0);
  assert.deepEqual(C.calibrationInput(legacy, 1000, 750).marks[0], { x: 0.1, y: 0.5, point: { lat: 46.9, lon: 9.1 }, positionM: 8 });
  // Reselecting a legacy landmark replaces its tap without duplicate solver evidence.
  const next = C.markFrom({ name: "Mark 1", kind: "tower", lat: 46.9, lon: 9.1, p: 12, positionM: 12, dataset: "2026-09-23.1-r1", w: 1.3, e: 80 }, 0.3, 0.5);
  assert.deepEqual(next, { x: 0.3, y: 0.5, kind: "tower", name: "Mark 1", lat: 46.9, lon: 9.1, positionM: 12, dataset: "2026-09-23.1-r1" }, "marks store the dataset");
  assert.ok(C.sameFeature(next, legacy.marks[0]));
  assert.ok(C.sameFeature(legacy.marks[0], next));
  assert.ok(!C.sameFeature({...next, name:"Different tower"}, legacy.marks[0]));
  assert.ok(!C.sameFeature({...next, lon:next.lon + .001}, legacy.marks[0]));
  const replaced=[...legacy.marks.filter(m=>!C.sameFeature(m,next)),next];
  assert.equal(replaced.length,legacy.marks.length);
  assert.equal(replaced.at(-1).x,.3);
  // A synthetic legacy photo still calibrates on its stored mark and ranks as before.
  const ix = C.parseIndex(F.index());
  const features = F.cells.flatMap((c) => C.parseCell(ix, c, F.cell(c)));
  const tower = features.find((f) => f.name === "Synthetic Tower A");
  const old = C.cleanSidecar({ viewer: { lat: F.viewer.lat, lon: F.viewer.lon, accuracyM: 10 }, marks: [{ x: F.taps.markA.x, y: F.taps.markA.y, osmType: "node", osmId: 9000000001, name: tower.name, lat: tower.lat, lon: tower.lon, positionM: 8 }], horizon: F.taps.horizon });
  const cal = R.calibrate(C.calibrationInput(old, F.width, F.height));
  assert.equal(C.shortlist(R.rank(cal, F.taps.whatB.x, F.taps.whatB.y, C.candidatesOf(features))).rows[0].candidate.feature.name, "Synthetic Peak B");
});

check("radius changes use a different feature cache entry; marks are unaffected", () => {
  const viewer = { lat: 46.8, lon: 9.2 },
    keys = C.RADII.map((r) => C.cacheKey(viewer, r));
  assert.equal(new Set(keys).size, 3);
  assert.equal(C.cacheKey(viewer, 30), C.cacheKey({ lat: 46.800001, lon: 9.2 }, 30), "same viewpoint to 5 decimals");
  const s = C.cleanSidecar({ viewer, radiusKm: 30, marks: [mark(1)] });
  const changed = C.cleanSidecar({ ...s, radiusKm: 10 });
  assert.deepEqual(changed.marks, s.marks);
  assert.notEqual(C.cacheKey(changed.viewer, changed.radiusKm), C.cacheKey(s.viewer, s.radiusKm));
});

check("transport failures are 'landmark data unavailable' with a retry; only a denied grant has none", () => {
  for (const status of [404, 429, 500, 503]) {
    const e = C.httpProblem(null, status);
    assert.equal(e.code, "DATA_STATUS");
    assert.equal(e.retry, true);
    assert.match(e.message, new RegExp(`^Landmark data unavailable: the data host answered HTTP ${status}`));
  }
  assert.equal(C.httpProblem({ code: "CAPABILITY_DENIED" }).retry, false);
  assert.match(C.httpProblem({ code: "CAPABILITY_DENIED" }).message, /Internet access is off/);
  for (const code of ["HTTP_UNAVAILABLE", "HTTP_SIZE", "HTTP_DATA", "HTTP_BUSY", "HTTP_RATE", "TIMEOUT", "SOMETHING_NEW"])
    assert.match(C.httpProblem({ code, message: "x" }).message, /^Landmark data unavailable: /, code);
  assert.match(C.httpProblem({ code: "HTTP_UNAVAILABLE" }).message, /could not be reached/);
  assert.equal(C.httpProblem(null).code, "HTTP_UNAVAILABLE");
});

check("local search: diacritics, nearest first, names only", () => {
  const ix = C.parseIndex(F.index());
  const features = F.cells.flatMap((c) => C.parseCell(ix, c, F.cell(c)));
  const all = features.concat([{ name: "Église Témoin", kind: "church", lat: 46.81, lon: 9.21, positionM: 25, w: 1.1 }]);
  assert.deepEqual(C.search(all, "eglise", F.viewer).map((r) => r.feature.name), ["Église Témoin"]);
  const every = C.search(all, "", F.viewer).map((r) => r.distanceM);
  assert.deepEqual(every, [...every].sort((a, b) => a - b));
  assert.deepEqual(C.search(all, "PEAK", F.viewer).map((r) => r.feature.name), ["Synthetic Peak B", "Synthetic Far Peak Z"]);
  assert.equal(C.search(all, "node/9000000001", F.viewer).length, 0, "no OSM ids any more");
});

check("shortlist: top five when something is close, else 'no close match' with the nearest two greyed", () => {
  const row = (name, deltaDeg, close) => ({ candidate: { feature: { name } }, deltaDeg, sigmaDeg: 2, wedgeSigmaDeg: 1, close });
  const some = C.shortlist([row("a", 1, true), row("b", 5, false), row("c", 2, true), row("d", 9, false), row("e", 3, true), row("f", 4, true)]);
  assert.equal(some.anyClose, true);
  assert.deepEqual(some.rows.map((r) => r.candidate.feature.name), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(some.rows.map((r) => r.greyed), [false, true, false, true, false]);
  const none = C.shortlist([row("far", 30, false), row("near", -6, false), row("mid", 12, false)]);
  assert.equal(none.anyClose, false);
  assert.deepEqual(none.rows.map((r) => r.candidate.feature.name), ["near", "mid"]);
  assert.ok(none.rows.every((r) => r.greyed));
  assert.equal(C.positionMatters({ sigmaDeg: 11, wedgeSigmaDeg: 3.8 }), true);
  assert.equal(C.positionMatters({ sigmaDeg: 4, wedgeSigmaDeg: 3.8 }), false);
});

// ---- Point editing, undo, magnifier and distance labels ---------------------
const edited = () => C.cleanSidecar({ viewer: { lat: 46.8, lon: 9.2, accuracyM: 10 }, radiusKm: 30, marks: [mark(1, { x: 0.2, y: 0.5 }), mark(2, { x: 0.6, y: 0.5, name: "Other" })], horizon: [{ x: 0.21, y: 0.52 }, { x: 0.9, y: 0.4 }] });
check("hit test finds the nearest mark or horizon point within 26 screen pixels, at the current zoom", () => {
  const s = edited();
  // A 1000 × 750 px photo: 0.01 across is 10 px.
  assert.deepEqual(C.hitPoint(s, 0.6, 0.5, 1000, 750), { list: "marks", index: 1 });
  assert.deepEqual(C.hitPoint(s, 0.9 + 0.02, 0.4 + 0.02, 1000, 750), { list: "horizon", index: 1 }, "≈ 25 px away");
  assert.equal(C.hitPoint(s, 0.9 + 0.03, 0.4, 1000, 750), null, "30 px away");
  assert.deepEqual(C.hitPoint(s, 0.212, 0.518, 1000, 750), { list: "horizon", index: 0 }, "nearest wins across lists");
  assert.deepEqual(C.hitPoint(s, 0.205, 0.51, 1000, 750), { list: "marks", index: 0 });
  assert.deepEqual(C.hitPoint({ ...s, horizon: [{ x: 0.2, y: 0.5 }] }, 0.2, 0.5, 1000, 750), { list: "marks", index: 0 }, "marks win ties");
  assert.equal(C.hitPoint(s, 0.9 + 0.02, 0.4 + 0.02, 4000, 3000), null, "zoomed in 4×, the same photo offset is 100 px");
  assert.equal(C.hitPoint(C.newSidecar(null), 0.5, 0.5, 1000, 750), null);
});

check("a drag previews in memory, clamps to the photo and leaves the stored sidecar untouched", () => {
  const s = edited(),
    frozen = JSON.stringify(s);
  const drag = C.pointDrag(s, { list: "marks", index: 0 });
  assert.equal(drag.moved, false);
  const p = drag.move(0.25, 0.45);
  assert.deepEqual([p.marks[0].x, p.marks[0].y], [0.25, 0.45]);
  assert.deepEqual(p.marks[1], s.marks[1], "other points unchanged");
  assert.deepEqual(p.horizon, s.horizon);
  assert.equal(JSON.stringify(s), frozen, "the stored sidecar is never mutated");
  const q = drag.move(-0.2, 1.3);
  assert.deepEqual([q.marks[0].x, q.marks[0].y], [0, 1], "clamped to the photo");
  assert.equal(C.cleanSidecar(q).marks.length, 2, "a clamped mark stays valid");
  const h = C.movePoint(s, { list: "horizon", index: 1 }, 0.8, 0.41);
  assert.deepEqual(h.horizon, [{ x: 0.21, y: 0.52 }, { x: 0.8, y: 0.41 }]);
  assert.deepEqual(h.marks, s.marks);
  assert.equal(C.pointName(s, { list: "marks", index: 1 }), "Other");
  assert.equal(C.pointName(s, { list: "horizon", index: 0 }), "horizon point 1");
});

check("undo restores the marks and horizon of the last add, move or removal, leaving viewpoint and radius", () => {
  const before = edited();
  // Add
  const add = C.undoStep("pA", before, "adding Third");
  const added = C.cleanSidecar({ ...before, marks: [...before.marks, mark(3, { name: "Third" })] });
  assert.deepEqual(C.undone(added, add), before);
  // Move, then the viewpoint and radius change: undo keeps those.
  const move = C.undoStep("pA", before, "moving Other");
  const moved = C.cleanSidecar(C.movePoint(before, { list: "marks", index: 1 }, 0.7, 0.4));
  const later = C.cleanSidecar({ ...moved, radiusKm: 60, viewer: { ...moved.viewer, lat: 46.81, corrected: true } });
  const back = C.undone(later, move);
  assert.deepEqual(back.marks, before.marks);
  assert.equal(back.radiusKm, 60);
  assert.equal(back.viewer.lat, 46.81);
  // Removal
  const remove = C.undoStep("pA", before, "removing horizon point 1");
  assert.deepEqual(C.undone({ ...before, horizon: before.horizon.slice(1) }, remove).horizon, before.horizon);
  // A step is a copy: later edits of the sidecar it came from do not change it.
  before.marks[0].x = 0.99;
  assert.equal(move.marks[0].x, 0.2);
  assert.equal(add.label, "adding Third");
  assert.equal(add.id, "pA");
});

check("moving a mark changes the fit: the fit follows the point", () => {
  const ix = C.parseIndex(F.index());
  const features = F.cells.flatMap((c) => C.parseCell(ix, c, F.cell(c)));
  const tower = features.find((f) => f.name === "Synthetic Tower A");
  const s = C.cleanSidecar({ viewer: { lat: F.viewer.lat, lon: F.viewer.lon, accuracyM: 10 }, marks: [C.markFrom(tower, F.taps.markA.x, F.taps.markA.y)], horizon: F.taps.horizon });
  const fit = (x) => R.calibrate(C.calibrationInput(x, F.width, F.height));
  const drag = C.pointDrag(s, C.hitPoint(s, F.taps.markA.x, F.taps.markA.y, 1000, 750));
  const moved = fit(drag.move(F.taps.markA.x + 0.05, F.taps.markA.y));
  // The tower's bearing is fixed, so moving its mark right turns the photo's centre left.
  assert.ok(R.diff(R.bearingAt(fit(s), 0.5, 0.5), R.bearingAt(moved, 0.5, 0.5)) > 2);
  assert.ok(Math.abs(R.diff(R.bearingAt(moved, F.taps.markA.x + 0.05, F.taps.markA.y), R.bearing(moved.viewer, tower))) < 0.5);
});

check("magnifier crop (Pocket Measure's loupe) centres on the point at the current zoom and shifts at photo edges", () => {
  const centre = C.loupe({ x: 0.5, y: 0.5 }, 1200, 900, 600, 120, 2.5);
  assert.deepEqual([centre.x, centre.y, centre.w, centre.h, centre.scale], [552, 402, 96, 96, 1.25]);
  const zoomed = C.loupe({ x: 0.5, y: 0.5 }, 1200, 900, 2400, 120);
  assert.ok(zoomed.w < centre.w, "zoomed in, fewer photo pixels are magnified");
  const corner = C.loupe({ x: 0, y: 0 }, 1200, 900, 600, 120);
  assert.deepEqual([corner.x, corner.y, corner.w], [0, 0, centre.w / 2]);
  assert.ok(Math.abs(corner.dx - 60) < 1e-9, "crop starts at the loupe centre so the crosshair still marks the point");
  const far = C.loupe({ x: 1, y: 1 }, 1200, 900, 600, 120);
  assert.deepEqual([far.x + far.w, far.y + far.h, far.dx], [1200, 900, 0]);
  assert.throws(() => C.loupe({ x: 1.2, y: 0.5 }, 1200, 900, 600, 120));
  assert.deepEqual(C.loupePlacement({ x: 300, y: 300 }, 600, 450, 120, 80), { x: 300, y: 220, r: 60 });
  assert.deepEqual(C.loupePlacement({ x: 300, y: 100 }, 600, 450, 120, 80), { x: 300, y: 180, r: 60 }, "flips below near the top");
  assert.deepEqual(C.loupePlacement({ x: 10, y: 440 }, 600, 450, 120, 80), { x: 60, y: 360, r: 60 });
  const tiny = C.loupePlacement({ x: 5, y: 5 }, 40, 40, 120, 80);
  assert.ok(tiny.x >= 0 && tiny.y >= 0);
});

check("distance and bearing labels: one format for marks, candidates, search and the map ruler", () => {
  assert.equal(C.range(12.34, 47.4), "12 km · 47° NE");
  assert.equal(C.range(3.21, 181), "3.2 km · 181° S");
  assert.equal(C.range(0.4, 359.6), "400 m · 0° N", "never 360°");
  assert.equal(C.degrees(-0.2), 0);
  assert.equal(C.degrees(-10), 350);
  // The candidate list and the map legend use the solver's bearing and distance from the fitted viewpoint.
  const v = { lat: 46.8, lon: 9.2 },
    p = R.destination(v, 42, 18);
  assert.equal(C.range(R.distance(v, p), R.bearing(v, p)), "18 km · 42° NE");
});

check("map pin in the photo: locate's line and ±2σ band, edge arrows off frame, behind-you wording", () => {
  const ix = C.parseIndex(F.index());
  const features = F.cells.flatMap((c) => C.parseCell(ix, c, F.cell(c)));
  const byName = (n) => features.find((f) => f.name === n);
  const tower = byName("Synthetic Tower A");
  const s = C.cleanSidecar({ viewer: { lat: F.viewer.lat, lon: F.viewer.lon, accuracyM: 10 }, marks: [C.markFrom(tower, F.taps.markA.x, F.taps.markA.y)], horizon: F.taps.horizon });
  const cal = R.calibrate(C.calibrationInput(s, F.width, F.height));
  const locate = (f) => R.locate(cal, { point: { lat: f.lat, lon: f.lon }, positionM: f.positionM });
  // In frame: the line and one closed band polygon.
  const b = locate(byName("Synthetic Peak B")),
    ov = C.pinOverlay(b);
  assert.equal(b.inFrame, true);
  // One mark, lens assumed: Peak B's true pixel lies inside the band, on the horizon row.
  assert.ok(Math.abs(R.diff(R.bearingAt(cal, F.taps.whatB.x, F.taps.whatB.y), b.bearing)) <= 2 * b.sigmaDeg && Math.abs(b.anchor.y - F.taps.whatB.y) < 0.02);
  assert.equal(ov.line, b.line);
  assert.equal(ov.arrow, null);
  assert.deepEqual(ov.bands, b.bandPolygons, "use solver-clipped polygons, including frame corners");
  assert.ok(ov.bands.length > 0);
  assert.match(C.pinText(b, "Synthetic Peak B"), /^Synthetic Peak B: in the photo · 18 km · 42° NE · band ±\d+\.\d° \(2σ\)$/);
  const left = R.locate(cal, { point: R.destination(F.viewer, F.pose.heading - 50, 5) });
  assert.equal(left.side, "left");
  assert.deepEqual(C.pinOverlay(left).arrow, { x: 0, y: Math.max(0.06, Math.min(0.94, left.anchor.y)), angle: 180 });
  assert.match(C.pinText(left), /^Pin: out of frame to the left · 5\.0 km · 340° NNW$/);
  // Behind the camera, on either side.
  const behind = locate(byName("Synthetic Monument F"));
  assert.equal(behind.side, "behind-right");
  assert.deepEqual(C.pinOverlay(behind).arrow, { x: 1, y: 0.5, angle: 0 });
  assert.match(C.pinText(behind, "Synthetic Monument F"), /^Synthetic Monument F: behind you, to the right · 4\.0 km · 200° SSW$/);
  assert.equal(locate(byName("Synthetic Far Peak Z")).side, "behind-left");
  assert.match(C.pinText(locate(byName("Synthetic Far Peak Z"))), /behind you, to the left/);
  // Above and below point up and down, kept off the corners.
  assert.deepEqual(C.pinOverlay({ inFrame: false, side: "above", anchor: { x: 0.99, y: 0 } }).arrow, { x: 0.94, y: 0, angle: -90 });
  assert.deepEqual(C.pinOverlay({ inFrame: false, side: "below", anchor: { x: 0.3, y: 1 } }).arrow, { x: 0.3, y: 1, angle: 90 });
  assert.match(C.pinText({ inFrame: false, side: "below", distanceKm: 2, bearing: 90 }), /below the photo · 2\.0 km · 90° E/);
});

check("Synthetic Aimé: one mark plus horizon ranks the tapped landmarks first", () => {
  const ix = C.parseIndex(F.index());
  const features = C.within(F.cells.flatMap((c) => C.parseCell(ix, c, F.cell(c))), F.viewer, 30);
  assert.equal(features.length, 8, "the far peak Z is outside every radius");
  const tower = features.find((f) => f.name === "Synthetic Tower A");
  const sidecar = C.cleanSidecar({ viewer: { lat: F.viewer.lat, lon: F.viewer.lon, accuracyM: 10 }, marks: [C.markFrom(tower, F.taps.markA.x, F.taps.markA.y)], horizon: F.taps.horizon });
  const cal = R.calibrate(C.calibrationInput(sidecar, F.width, F.height));
  assert.equal(cal.level, "fitted");
  assert.ok(Math.abs(cal.pitch - F.pose.pitch) < 1 && Math.abs(cal.roll - F.pose.roll) < 1);
  for (const [tap, name] of [["whatB", "Synthetic Peak B"], ["whatD", "Synthetic Castle D"]]) {
    const list = C.shortlist(R.rank(cal, F.taps[tap].x, F.taps[tap].y, C.candidatesOf(features)));
    assert.equal(list.anyClose, true);
    assert.equal(list.rows[0].candidate.feature.name, name);
  }
  // Only a feature behind the viewer: nothing is close.
  const behind = features.filter((f) => f.name === "Synthetic Monument F");
  const none = C.shortlist(R.rank(cal, 0.5, 0.45, C.candidatesOf(behind)));
  assert.equal(none.anyClose, false);
  assert.equal(none.rows.length, 1);
  assert.equal(F.at.F, null, "feature behind the camera is not drawn");
});

// ---- Persistence: bounded per-photo records in a fixed slot pool ----------
// A storage.kv double with the host's limits: 8,192-character bridge messages,
// 100 keys and 64 KiB per module (keys set to null stay keys), plus failures.
function host({ failGet = () => false, failSet = () => false } = {}) {
  const data = {},
    log = [];
  let seq = 0;
  const message = (params) => JSON.stringify({ id: String(++seq), method: "storage.kv", params });
  return {
    data,
    log,
    async get(key) {
      assert.ok(message({ op: "get", key }).length <= C.MESSAGE_LIMIT);
      if (failGet(key)) throw Object.assign(new Error("denied"), { code: "CAPABILITY_DENIED" });
      return structuredClone(data[key] ?? null);
    },
    async set(key, value) {
      const length = message({ op: "set", key, value }).length;
      log.push({ key, length });
      if (length > C.MESSAGE_LIMIT) throw Object.assign(new Error("Host did not respond"), { code: "TIMEOUT" });
      assert.match(key, /^[A-Za-z0-9_.-]{1,80}$/);
      if (failSet(key, value)) throw Object.assign(new Error("write failed"), { code: "STORAGE_QUOTA" });
      const next = { ...data, [key]: structuredClone(value) };
      if (Object.keys(next).length > 100 || Buffer.byteLength(JSON.stringify(next)) > 64 * 1024) throw Object.assign(new Error("quota"), { code: "STORAGE_QUOTA" });
      data[key] = next[key];
    },
  };
}
const nasty = (n) => ('"\\').repeat(n).slice(0, n);
const WORST_CAPTURE = { zoomRatio: 0.10000000000000002, fovDeg: { h: 178.12345, v: 178.12345 }, fovSigmaDeg: 29.99, tilt: { pitchDeg: -179.99, rollDeg: -179.99, sigmaDeg: 89.99, ageMs: 3599999 }, headingDeg: 359.99, headingRef: "magnetic", headingAccuracyDeg: 179.99, headingAgeMs: 3599999 };
const fullSidecar = (salt = 0) =>
  C.cleanSidecar({
    capture: WORST_CAPTURE,
    viewer: { lat: -45.123456789012345, lon: -170.12345678901234, accuracyM: 1234.567890123456, timestamp: 1790463000123 + salt, approximate: true, corrected: true, review: true },
    radiusKm: 60,
    // Current marks with the longest kind and dataset, plus legacy OSM marks.
    marks: Array.from({ length: 9 }, (_, j) => ({
      x: 0.12345678901234567,
      y: 0.98765432109876543,
      ...(j % 2 ? { osmType: "relation", osmId: Number.MAX_SAFE_INTEGER - j } : { kind: "communication_tower", dataset: "9".repeat(40) }),
      name: nasty(200),
      lat: -89.12345678901234,
      lon: -179.12345678901234,
      positionM: 30.123456789012345,
    })),
    horizon: [{ x: 0.12345678901234567, y: 0.98765432109876543 }, { x: 0.87654321098765432, y: 0.12345678901234567 }, { x: 0.5, y: 0.5 }],
  });
const longId = (i) => ("p" + '"\\'.repeat(40)).slice(0, 78) + String(i).padStart(2, "0");

check("control characters are dropped from names; worst-case record and index fit one bridge message", () => {
  assert.equal(C.cleanSidecar({ marks: [mark(1, { name: "Tower\u0000\u202e A\u0007" })] }).marks[0].name, "Tower A");
  const newest = C.cleanSidecar({ ...fullSidecar(), marks: fullSidecar().marks.map((m) => ({ ...m, kind: "communication_tower", dataset: "9".repeat(40) })) });
  assert.ok(C.envelopeLength(C.recordKey(15), C.recordValue(longId(1), newest)) <= C.MESSAGE_BUDGET, "six current-shape marks");
  // The worst record now includes the largest valid capture metadata (API 0.13).
  assert.equal(JSON.stringify(fullSidecar().capture).length < 280, true);
  const { capture, ...withoutCapture } = fullSidecar();
  assert.ok(C.envelopeLength(C.recordKey(15), C.recordValue(longId(1), fullSidecar())) - C.envelopeLength(C.recordKey(15), C.recordValue(longId(1), withoutCapture)) < 280, "capture costs under 280 characters per record");
  const record = C.envelopeLength(C.recordKey(15), C.recordValue(longId(1), fullSidecar()));
  const index = C.envelopeLength(C.INDEX_KEY, C.indexValue(Array.from({ length: C.MAX_SLOTS }, (_, i) => longId(i))));
  assert.ok(record <= C.MESSAGE_BUDGET && record < C.MESSAGE_LIMIT, "record " + record);
  assert.ok(index <= C.MESSAGE_BUDGET, "index " + index);
  assert.ok(C.MESSAGE_BUDGET < C.MESSAGE_LIMIT);
  assert.throws(() => C.checkEnvelope("photo.0", { blob: "x".repeat(C.MESSAGE_BUDGET) }), { code: "STORAGE_SIZE" });
});

check("#40: bridge and storage checks still bound six marks of 80 astral characters", () => {
  const sidecar = C.cleanSidecar({ ...fullSidecar(), marks: Array.from({ length: 6 }, (_, i) => mark(i, { name: "🗻".repeat(90), kind: "communication_tower", dataset: "9".repeat(40), lat: -89.12345678901234, lon: -179.12345678901234, positionM: 30.123456789012345 })) });
  assert.ok(sidecar.marks.every((m) => [...m.name].length === C.NAME_MAX && encodeURIComponent(m.name)));
  assert.ok(C.envelopeLength(C.recordKey(15), C.recordValue(longId(1), sidecar)) <= C.MESSAGE_BUDGET);
  assert.throws(() => C.checkEnvelope("photo.0", { blob: "🗻".repeat(C.MESSAGE_BUDGET / 2) }), { code: "STORAGE_SIZE" });
});

check("slot index parsing, record ownership and put/release planning", () => {
  assert.deepEqual(C.loadIndex(null), Array(C.MAX_SLOTS).fill(null));
  assert.deepEqual(C.loadIndex({ v: 2, slots: ["a"] }).filter(Boolean), []);
  const slots = C.loadIndex({ v: 1, slots: ["a", "a", "bad id", null, "b"] });
  assert.deepEqual(slots.slice(0, 5), ["a", null, null, null, "b"]);
  assert.equal(C.recordFor({ id: "b", sidecar: { radiusKm: 10 } }, "a"), null, "a record for another photo is ignored");
  assert.equal(C.recordFor({ id: "a", sidecar: { radiusKm: 10 } }, "a").radiusKm, 10);
  assert.deepEqual(C.planPut(slots, "b"), { slot: 4, claim: false, slots });
  const put = C.planPut(slots, "c");
  assert.equal(put.slot, 1);
  assert.equal(put.claim, true);
  assert.equal(slots[1], null, "planning never mutates");
  assert.throws(() => C.planPut(Array.from({ length: C.MAX_SLOTS }, (_, i) => "p" + i), "new"), { code: "STORAGE_FULL" });
  const rel = C.planRelease(slots, ["b", "z"]);
  assert.deepEqual(rel.freed, [{ slot: 0, id: "a" }]);
  assert.deepEqual(rel.slots.slice(0, 5), [null, null, null, null, "b"]);
});

const asyncChecks = [];
const checkAsync = (name, fn) => asyncChecks.push([name, fn]);

checkAsync("eight full photos persist with every request inside the bridge limit, survive reopen and reconcile", async () => {
  const kv = host(),
    db = C.persistence(kv);
  assert.equal(await db.load(), null);
  for (let i = 0; i < 8; i++) await db.put(longId(i), fullSidecar(i));
  assert.ok(kv.log.every((w) => w.length <= C.MESSAGE_BUDGET), JSON.stringify(kv.log.map((w) => w.length)));
  const reopened = C.persistence(kv);
  assert.equal(await reopened.load(), null);
  assert.equal(Object.keys(reopened.store).length, 8);
  assert.deepEqual(reopened.store[longId(3)], fullSidecar(3));
  // Two photos gone after a successful complete list: freed in one index write.
  const writes = kv.log.length;
  assert.deepEqual(await reopened.release([0, 1, 2, 4, 5, 7].map(longId)), [longId(3), longId(6)]);
  assert.equal(kv.log[writes].key, C.INDEX_KEY);
  const again = C.persistence(kv);
  await again.load();
  assert.deepEqual(Object.keys(again.store).sort(), [0, 1, 2, 4, 5, 7].map(longId).sort());
  // Slots are reused: many capture/delete cycles never grow the key count.
  for (let n = 0; n < 40; n++) {
    await again.put("cycle" + n, fullSidecar(n));
    await again.release(Object.keys(again.store).filter((id) => id !== "cycle" + n));
  }
  assert.ok(Object.keys(kv.data).length <= C.MAX_SLOTS + 1, "keys " + Object.keys(kv.data).length);
});

checkAsync("a failed record write changes nothing; an interrupted slot claim is retried in place", async () => {
  let failRecord = true,
    failIndex = false;
  const kv = host({ failSet: (key) => (key === C.INDEX_KEY ? failIndex : key.startsWith("photo.") && failRecord) }),
    db = C.persistence(kv);
  await db.load();
  await assert.rejects(db.put("pA", fullSidecar()), { code: "STORAGE_QUOTA" });
  assert.deepEqual(db.store, {}, "memory does not claim a failed write");
  failRecord = false;
  failIndex = true;
  await assert.rejects(db.put("pA", fullSidecar()), { code: "STORAGE_QUOTA" });
  assert.deepEqual(db.store, {});
  let reopened = C.persistence(kv);
  await reopened.load();
  assert.deepEqual(reopened.store, {}, "an unclaimed record is not a photo record");
  failIndex = false;
  await db.put("pA", fullSidecar());
  assert.deepEqual(db.slots.filter(Boolean), ["pA"]);
  reopened = C.persistence(kv);
  await reopened.load();
  assert.deepEqual(Object.keys(reopened.store), ["pA"]);
  // Editing another photo while one record write fails keeps the others intact.
  await db.put("pB", fullSidecar(1));
  failRecord = true;
  await assert.rejects(db.put("pB", { ...fullSidecar(1), radiusKm: 10 }));
  assert.equal(db.store.pB.radiusKm, 60);
  failRecord = false;
  reopened = C.persistence(kv);
  await reopened.load();
  assert.deepEqual(Object.keys(reopened.store).sort(), ["pA", "pB"]);
  assert.equal(reopened.store.pB.radiusKm, 60);
});

checkAsync("denied or failed reads leave storage unavailable and nothing is written", async () => {
  const kv = host();
  const seed = C.persistence(kv);
  await seed.load();
  await seed.put("pA", fullSidecar());
  for (const failing of [C.INDEX_KEY, C.recordKey(0)]) {
    const denied = host({ failGet: (key) => key === failing });
    Object.assign(denied.data, structuredClone(kv.data));
    const db = C.persistence(denied);
    assert.equal((await db.load()).code, "CAPABILITY_DENIED");
    assert.equal(db.store, null);
    await assert.rejects(db.put("pB", fullSidecar()), { code: "STORAGE_UNAVAILABLE" });
    assert.deepEqual(await db.release([]), [], "no reconciliation without readable storage");
    assert.equal(denied.log.length, 0, "no write was attempted");
  }
});

checkAsync("features() returns the viewpoint cell's declination; declinationAt uses the downloaded cell; absent is null", async () => {
  const data = C.landmarkData(async (url) => F.answer(url).text);
  assert.equal(data.declinationAt(F.viewer), null, "nothing downloaded yet");
  const found = await data.features(F.viewer, 30);
  assert.equal(found.declination, 3, "46_9");
  assert.equal(data.declinationAt(F.viewer), 3);
  assert.equal(data.declinationAt({ lat: 47.2, lon: 9.3 }), 3.2, "another downloaded cell");
  assert.equal(data.declinationAt({ lat: 50.5, lon: 9.3 }), null, "a cell never downloaded");
  assert.equal(data.declinationAt(null), null);
  // Cells without the field (older data) load and report none.
  const old = dataHost({ [C.INDEX_URL]: indexWith(["46_9"]), ...cellFiles(["46_9"], () => [["T", "tower", 46.5, 9.5, 0, 1, 8]]) });
  const plain = C.landmarkData(old.get),
    got = await plain.features({ lat: 46.5, lon: 9.5 }, 10);
  assert.equal(got.features.length, 1);
  assert.equal(got.declination, null);
});

checkAsync("declination regression (0.2.1 hardware): a saved photo's viewpoint cell comes from the current index, without a lookup, whatever dataset its marks are from", async () => {
  // Index r2 now; the photo's marks were picked from r1. Its cell has a declination.
  const r2 = { ...INDEX, revision: 2, dataset: "2026-09-23.1-r2", path: "2026-09-23.1-r2/cells/", cells: ["52_9", "52_10", "51_9"] };
  const ix2 = C.parseIndex(JSON.stringify(r2)),
    cell = (name, extra) => JSON.stringify({ schema: 1, release: r2.release, revision: 2, cell: name.split("_").map(Number), f: [], ...extra });
  const files = { [C.INDEX_URL]: JSON.stringify(r2), [C.cellUrl(ix2, "52_9")]: cell("52_9", { declination: 4.1 }), [C.cellUrl(ix2, "52_10")]: cell("52_10", { declination: 4.2 }), [C.cellUrl(ix2, "51_9")]: cell("51_9") };
  const host = dataHost(files),
    data = C.landmarkData(host.get),
    viewer = { lat: 52.37648, lon: 9.73848 };
  const saved = C.cleanSidecar({ viewer: { ...viewer, accuracyM: 10 }, marks: [mark(1, { dataset: "2026-09-23.1-r1", lat: 52.4, lon: 9.8 })], capture: { ...FULL, zoomRatio: 2 } });
  // The bug: calibration of a saved photo needs no lookup, so nothing was downloaded.
  assert.equal(data.declinationAt(viewer), null);
  assert.equal(C.measuredInputs(saved.capture, 4000, 3000, data.declinationAt(viewer)).skipped.compass, "declination");
  // The fix: fetch just the viewpoint's cell from the current index.
  assert.equal(await data.declinationFor(viewer), 4.1);
  assert.deepEqual(host.log, [C.INDEX_URL, C.cellUrl(ix2, "52_9")], "one cell, from r2, not the marks' r1");
  assert.equal(data.declinationAt(viewer), 4.1);
  const m = C.measuredInputs(saved.capture, 4000, 3000, data.declinationAt(viewer));
  assert.equal(m.used.compass, true);
  assert.equal(m.input.declination, 4.1);
  // A later lookup reuses that cell.
  host.log.length = 0;
  await data.features(viewer, 10);
  assert.ok(!host.log.includes(C.cellUrl(ix2, "52_9")));
  // Unlisted cell, a cell without the field, bad input → null; a failure rejects (the app retries later).
  assert.equal(await data.declinationFor({ lat: 40.4, lon: -3.7 }), null);
  assert.equal(await data.declinationFor({ lat: 51.5, lon: 9.5 }), null);
  assert.equal(await data.declinationFor(null), null);
  const down = C.landmarkData(dataHost(files, { fail: (url) => (url.endsWith("52_9.json") ? C.httpProblem(null, 503) : null) }).get);
  await assert.rejects(down.declinationFor(viewer), { code: "DATA_STATUS" });
});

checkAsync("updating a saved mark to newer data is one record write", async () => {
  const kv = host(),
    db = C.persistence(kv);
  await db.load();
  const r1 = { x: 0.31, y: 0.52, kind: "tower", name: "Telemoritz", lat: 52.36544, lon: 9.74212, positionM: 60, dataset: "2026-09-23.1-r1" };
  await db.put("pA", C.cleanSidecar({ viewer: { lat: 52.37648, lon: 9.73848 }, marks: [r1] }));
  const writes = kv.log.length,
    newer = C.newerMark(r1, "2026-09-23.1-r2", [{ name: "Telemoritz", kind: "tower", lat: 52.36571, lon: 9.7419, positionM: 8, dataset: "2026-09-23.1-r2" }]);
  await db.put("pA", { ...db.store.pA, marks: db.store.pA.marks.map((k) => C.refreshMark(k, newer.feature)) });
  assert.deepEqual(kv.log.slice(writes).map((w) => w.key), [C.recordKey(0)]);
  assert.equal(db.store.pA.marks[0].positionM, 8);
});

checkAsync("a dragged point is written once on release, never per move; unmoved or cancelled drags write nothing", async () => {
  const kv = host(),
    db = C.persistence(kv);
  await db.load();
  await db.put("pA", edited());
  const writes = kv.log.length;
  const drag = C.pointDrag(db.store.pA, { list: "horizon", index: 0 });
  for (let i = 1; i <= 60; i++) drag.move(0.21 + i / 1000, 0.52 - i / 2000);
  assert.equal(kv.log.length, writes, "no storage request while the finger moves");
  const commit = (next) => db.put("pA", next);
  assert.equal(await drag.release(commit), true);
  assert.deepEqual(kv.log.slice(writes).map((w) => w.key), [C.recordKey(0)], "one record write, no index write");
  assert.equal(await drag.release(commit), false, "a second release writes nothing");
  const reopened = C.persistence(kv);
  await reopened.load();
  assert.deepEqual(reopened.store.pA.horizon[0], { x: 0.27, y: 0.49 });
  // Unmoved (back where it started) and cancelled drags.
  const still = C.pointDrag(db.store.pA, { list: "marks", index: 0 });
  still.move(0.3, 0.3);
  still.move(0.2, 0.5);
  assert.equal(await still.release(commit), false);
  const cancelled = C.pointDrag(db.store.pA, { list: "marks", index: 0 });
  cancelled.move(0.3, 0.3);
  cancelled.cancel();
  assert.equal(cancelled.preview, db.store.pA);
  assert.equal(await cancelled.release(commit), false);
  assert.equal(kv.log.length, writes + 1);
  // A failed write rejects the release and leaves the stored point.
  const failing = host({ failSet: (key) => key !== C.INDEX_KEY }),
    fdb = C.persistence(failing);
  await fdb.load();
  failing.data[C.INDEX_KEY] = C.indexValue(["pA", ...Array(C.MAX_SLOTS - 1).fill(null)]);
  failing.data[C.recordKey(0)] = C.recordValue("pA", edited());
  await fdb.load();
  const lost = C.pointDrag(fdb.store.pA, { list: "marks", index: 1 });
  lost.move(0.1, 0.1);
  await assert.rejects(lost.release((next) => fdb.put("pA", next)), { code: "STORAGE_QUOTA" });
  assert.equal(fdb.store.pA.marks[1].x, 0.6);
});

checkAsync("a failed release keeps the records and memory for the next successful list", async () => {
  let failIndex = false;
  const kv = host({ failSet: (key) => key === C.INDEX_KEY && failIndex }),
    db = C.persistence(kv);
  await db.load();
  await db.put("pA", fullSidecar());
  await db.put("pB", fullSidecar(1));
  failIndex = true;
  await assert.rejects(db.release(["pA"]));
  assert.deepEqual(Object.keys(db.store).sort(), ["pA", "pB"]);
  failIndex = false;
  assert.deepEqual(await db.release(["pA"]), ["pB"]);
  const reopened = C.persistence(kv);
  await reopened.load();
  assert.deepEqual(Object.keys(reopened.store), ["pA"]);
});

// ---- Landmark data: index once, cells per dataset+cell, bounded concurrency ----
// A data host double: answers by URL, records requests and peak concurrency.
function dataHost(files, { fail = () => null } = {}) {
  const log = [];
  let active = 0,
    peak = 0;
  const get = async (url) => {
    log.push(url);
    active++;
    peak = Math.max(peak, active);
    try {
      await new Promise((r) => setTimeout(r, 2));
      const failure = fail(url);
      if (failure) throw failure;
      if (!(url in files)) throw C.httpProblem(null, 404);
      return typeof files[url] === "function" ? files[url]() : files[url];
    } finally {
      active--;
    }
  };
  return { get, log, peak: () => peak };
}
const indexWith = (cells, extra = {}) => JSON.stringify({ ...INDEX, cells, ...extra });
const cellFiles = (cells, f = () => []) => Object.fromEntries(cells.map((c) => [C.cellUrl(C.parseIndex(JSON.stringify(INDEX)), c), cellText(c, f(c))]));

checkAsync("index is fetched once per session; a failed index is not cached and a retry works", async () => {
  let down = true;
  const host = dataHost({ [C.INDEX_URL]: indexWith(["46_9"]), ...cellFiles(["46_9"]) }, { fail: (url) => (down && url === C.INDEX_URL ? C.httpProblem({ code: "HTTP_UNAVAILABLE" }) : null) });
  const data = C.landmarkData(host.get);
  await assert.rejects(data.features({ lat: 46.5, lon: 9.5 }, 10), (e) => e.code === "HTTP_UNAVAILABLE" && e.retry && /^Landmark data unavailable/.test(e.message));
  assert.equal(data.index, null);
  down = false;
  await data.features({ lat: 46.5, lon: 9.5 }, 10);
  await data.features({ lat: 46.5, lon: 9.5 }, 30);
  await data.features({ lat: 46.6, lon: 9.4 }, 10);
  assert.deepEqual(host.log.filter((u) => u === C.INDEX_URL).length, 2, "one failed and one successful index request");
  assert.equal(host.log.filter((u) => u.includes("/cells/")).length, 1, "the cell is cached per session");
  // Concurrent first lookups share one index request.
  const shared = dataHost({ [C.INDEX_URL]: indexWith(["46_9"]), ...cellFiles(["46_9"]) });
  const both = C.landmarkData(shared.get);
  await Promise.all([both.features({ lat: 46.5, lon: 9.5 }, 10), both.features({ lat: 46.5, lon: 9.5 }, 30)]);
  assert.deepEqual(shared.log, [C.INDEX_URL, C.cellUrl(both.index, "46_9")]);
});

checkAsync("60 km fetches at most 9 listed cells, never more than two at once, and filters to the radius", async () => {
  const all = [];
  for (let a = 50; a <= 54; a++) for (let o = 7; o <= 12; o++) all.push(a + "_" + o);
  const viewer = { lat: 52.37, lon: 9.74 },
    host = dataHost({ [C.INDEX_URL]: indexWith(all), ...cellFiles(all, (c) => [["Centre " + c, "tower", Number(c.split("_")[0]) + 0.5, Number(c.split("_")[1]) + 0.5, 0, 1, 8]]) }),
    data = C.landmarkData(host.get);
  const found = await data.features(viewer, 60);
  const cells = host.log.filter((u) => u.includes("/cells/"));
  assert.ok(cells.length <= 9 && cells.length === found.cells, String(cells.length));
  assert.ok(host.peak() <= C.DATA_CONCURRENCY && C.DATA_CONCURRENCY + 2 <= 4, "with the map's two tile requests, within the host's four");
  assert.ok(found.features.every((f) => C.metres(viewer, f) <= 60000));
  assert.deepEqual(found.features.map((f) => f.name).sort(), ["Centre 52_10", "Centre 52_9"]);
  assert.equal(found.dataset, INDEX.dataset);
  assert.equal(found.partialCoverage, false);
  assert.equal(C.coverageNote(found), "");
  // Only listed cells are fetched, but missing neighbours must be disclosed.
  const sparse = dataHost({ [C.INDEX_URL]: indexWith(["52_9"]), ...cellFiles(["52_9"]) });
  const partial=await C.landmarkData(sparse.get).features(viewer, 60);
  assert.equal(partial.partialCoverage,true);
  assert.match(C.coverageNote(partial), /Partial coverage/);
  assert.equal(sparse.log.length, 2);
});

checkAsync("outside coverage needs no cell request; a failed or mismatched cell is unavailable, never empty, and a retry fetches only what failed", async () => {
  const cells = ["46_9", "47_9"];
  let failing = new Set(["47_9"]);
  const files = { [C.INDEX_URL]: indexWith(cells), ...cellFiles(cells, (c) => [["Tower " + c, "tower", Number(c.split("_")[0]) + (c === "46_9" ? 0.95 : 0.05), 9.3, 0, 1, 8]]) };
  const host = dataHost(files, { fail: (url) => ([...failing].some((c) => url.endsWith("/" + c + ".json")) ? C.httpProblem(null, 503) : null) });
  const data = C.landmarkData(host.get);
  await assert.rejects(data.features({ lat: 40.4168, lon: -3.7038 }, 60), (e) => e.code === "OUTSIDE_COVERAGE" && e.retry === false && e.message === "No landmark data here yet. Germany and Austria for now.");
  assert.deepEqual(host.log, [C.INDEX_URL]);
  await assert.rejects(data.features({ lat: 46.95, lon: 9.3 }, 30), (e) => e.code === "DATA_STATUS" && e.retry && /HTTP 503/.test(e.message));
  failing = new Set();
  host.log.length = 0;
  const found = await data.features({ lat: 46.95, lon: 9.3 }, 30);
  assert.deepEqual(host.log, [C.cellUrl(data.index, "47_9")], "the good cell stayed cached");
  assert.deepEqual(found.features.map((f) => f.name).sort(), ["Tower 46_9", "Tower 47_9"]);
  // A cell from another release or revision is rejected as unavailable.
  for (const other of [{ release: "2026-08-20.0" }, { revision: 2 }]) {
    const stale = dataHost({ [C.INDEX_URL]: indexWith(["46_9"]), [C.cellUrl(C.parseIndex(JSON.stringify(INDEX)), "46_9")]: cellText("46_9", [["T", "tower", 46.5, 9.5, 0, 1, 8]], other) });
    await assert.rejects(C.landmarkData(stale.get).features({ lat: 46.5, lon: 9.5 }, 10), (e) => e.code === "DATA_INVALID" && e.retry);
  }
  // A cell that is not a feature list fails the lookup as well.
  const broken = dataHost({ [C.INDEX_URL]: indexWith(["46_9"]), [C.cellUrl(C.parseIndex(JSON.stringify(INDEX)), "46_9")]: JSON.stringify({ schema: 1, release: INDEX.release, revision: INDEX.revision, cell: [46, 9], f: null }) });
  await assert.rejects(C.landmarkData(broken.get).features({ lat: 46.5, lon: 9.5 }, 10), { code: "DATA_INVALID" });
  // Schema 2 index: unavailable, not outside coverage.
  const future = dataHost({ [C.INDEX_URL]: indexWith(["46_9"], { schema: 2 }) });
  await assert.rejects(C.landmarkData(future.get).features({ lat: 46.5, lon: 9.5 }, 10), { code: "DATA_INVALID" });
});

checkAsync("Synthetic Aimé serves the contract: 8 landmarks at every radius, 503 and outside coverage", async () => {
  const data = C.landmarkData(async (url) => {
    const r = F.answer(url);
    if (r.status !== 200) throw C.httpProblem(null, r.status);
    return r.text;
  });
  for (const r of C.RADII) {
    const found = await data.features(F.viewer, r);
    const expected = F.features.filter((f) => f.letter !== "Z" && f.km <= r).length;
    assert.equal(found.features.length, expected, r + " km");
  }
  assert.equal((await data.features(F.viewer, 30)).features.length, 8);
  await assert.rejects(data.features(F.outside, 60), { code: "OUTSIDE_COVERAGE" });
  assert.equal(F.answer("https://aime-data.pages.dev/v1/synthetic-1-r1/cells/0_0.json").status, 404);
  assert.equal(F.answer("https://aime-data.pages.dev/v1/synthetic-1/cells/46_9.json").status, 404, "cells live under the dataset, not the release");
  const byName = Object.fromEntries((await data.features(F.viewer, 60)).features.map((f) => [f.name, f.positionM]));
  assert.deepEqual([byName["Synthetic Peak B"], byName["Synthetic Church C"], byName["Synthetic Castle D"]], [8, 16, 60], "fixture p per feature");
});

(async () => {
  for (const [name, fn] of asyncChecks) {
    await fn();
    checks++;
    console.log("ok -", name);
  }
  console.log(`${checks} Aimé module checks passed.`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
