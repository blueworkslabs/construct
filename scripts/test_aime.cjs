// Aimé module logic: sidecars, capture association, reconciliation, viewpoint
// choice, landmark cells (cell math, index/cell validation, fetch and cache),
// radius changes, search, shortlist, and the Synthetic Aimé scene. The solver itself is covered by test_aime_resection.cjs.
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

check("capture association needs exactly one new stable id", () => {
  assert.equal(C.associate(["a", "b"], ["a", "b", "c"]), "c");
  assert.equal(C.associate(["a", "b"], ["b", "c"]), "c", "a concurrent deletion does not hide the new photo");
  assert.equal(C.associate(["a"], ["a"]), null, "nothing new");
  assert.equal(C.associate(["a"], ["a", "b", "c"]), null, "ambiguous: never assigned by position");
  assert.equal(C.associate([], ["x"]), "x");
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
  assert.throws(() => C.parseIndex("<html>404</html>"), { code: "DATA_INVALID" });
  assert.deepEqual([...C.parseIndex(JSON.stringify({ ...INDEX, cells: ["46_9", "x", 7, "1000_1"] })).cells], ["46_9"]);
  assert.deepEqual(C.cellPlan(ix, { lat: 46.8, lon: 9.2 }, 30).sort(), ["46_9", "47_9"], "only listed cells");
  assert.deepEqual(C.cellPlan(ix, { lat: 40.4, lon: -3.7 }, 60), [], "outside coverage");
  assert.equal(C.outsideMessage(ix.coverage), "No landmark data here yet. Germany and Austria for now.");
  assert.equal(C.outsideMessage(["DE"]), "No landmark data here yet. Germany for now.");
  assert.equal(C.outsideMessage([]), "No landmark data here yet.");
});

check("cell parsing: p is the feature's positionM; e and w kept; invalid p rejects the cell; other bad records are skipped; mismatched cells rejected", () => {
  const ix = C.parseIndex(JSON.stringify(INDEX));
  const f = C.parseCell(ix, "46_9", cellText("46_9", [
    ["Piz Test", "peak", 46.9, 9.3, 3012, 1.8, 8],
    ["St. Test", "church", 46.85, 9.25, 0, 1.1, 16],
    ["Places Church", "church", 46.84, 9.24, 0, 1.1, 60],
    ["Test Memorial", "monument", 46.7, 9.1, 0, 1, 60],
    ["Test Dam", "dam", 46.71, 9.11, 120, 5, 130],
    ["Places Peak", "peak", 46.73, 9.13, 2100, 1.5, 250],
    ["Odd weight", "tower", 46.72, 9.12, "x", null, 5],
    ["Big bound", "tower", 46.74, 9.14, 0, 1, 1000],
    ["Shop", "bakery", 46.7, 9.1, 0, 1, 8],
    ["", "peak", 46.7, 9.1, 0, 1, 8],
    [42, "peak", 46.7, 9.1, 0, 1, 8],
    ["Long", "peak", 46.7, 9.1, 0, 1, 8, "extra"],
    ["NaN", "peak", NaN, 9.1, 0, 1, 8],
    ["Far", "peak", 91, 9.1, 0, 1, 8],
    ["Proto", "constructor", 46.7, 9.1, 0, 1, 8],
  ]));
  assert.deepEqual(f.map((x) => x.name), ["Piz Test", "St. Test", "Places Church", "Test Memorial", "Test Dam", "Places Peak", "Odd weight", "Big bound"]);
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
  assert.equal(dam.w, 2, "weight clamped to the contract's 0.5–2.0");
  assert.deepEqual([odd.e, odd.w], [0, 1], "unknown e/w fall back");
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
  // New marks next to legacy ones: identity never merges them by accident.
  const next = C.markFrom({ name: "Mark 1", kind: "tower", lat: 46.9, lon: 9.1, p: 12, positionM: 12, dataset: "2026-09-23.1-r1", w: 1.3, e: 80 }, 0.3, 0.5);
  assert.deepEqual(next, { x: 0.3, y: 0.5, kind: "tower", name: "Mark 1", lat: 46.9, lon: 9.1, positionM: 12, dataset: "2026-09-23.1-r1" }, "marks store the dataset");
  assert.ok(!C.sameFeature(next, legacy.marks[0]));
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
const fullSidecar = (salt = 0) =>
  C.cleanSidecar({
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
  const record = C.envelopeLength(C.recordKey(15), C.recordValue(longId(1), fullSidecar()));
  const index = C.envelopeLength(C.INDEX_KEY, C.indexValue(Array.from({ length: C.MAX_SLOTS }, (_, i) => longId(i))));
  assert.ok(record <= C.MESSAGE_BUDGET && record < C.MESSAGE_LIMIT, "record " + record);
  assert.ok(index <= C.MESSAGE_BUDGET, "index " + index);
  assert.ok(C.MESSAGE_BUDGET < C.MESSAGE_LIMIT);
  assert.throws(() => C.checkEnvelope("photo.0", { blob: "x".repeat(C.MESSAGE_BUDGET) }), { code: "STORAGE_SIZE" });
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
  // Only listed cells are requested; an unlisted neighbour is simply absent.
  const sparse = dataHost({ [C.INDEX_URL]: indexWith(["52_9"]), ...cellFiles(["52_9"]) });
  await C.landmarkData(sparse.get).features(viewer, 60);
  assert.equal(sparse.log.length, 2);
});

checkAsync("outside coverage needs no cell request; a failed or mismatched cell is unavailable, never empty, and a retry fetches only what failed", async () => {
  const cells = ["46_9", "47_9"];
  let failing = new Set(["47_9"]);
  const files = { [C.INDEX_URL]: indexWith(cells), ...cellFiles(cells, (c) => [["Tower " + c, "tower", 46.95, 9.3, 0, 1, 8]]) };
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
