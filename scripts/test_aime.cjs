// Aimé module logic: sidecars, capture association, reconciliation, viewpoint
// choice, Overpass query/parsing, radius changes, search, shortlist, and the
// Synthetic Aimé scene. The solver itself is covered by test_aime_resection.cjs.
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

const mark = (i, extra = {}) => ({ x: 0.1 * (i % 9), y: 0.5, osmType: "node", osmId: 100 + i, name: "Mark " + i, lat: 46.9, lon: 9.1, positionM: 8, ...extra });
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
  assert.equal(C.cleanSidecar({ marks: [mark(1, { osmType: "way", positionM: undefined })] }).marks[0].positionM, 30, "way centre estimate");
  assert.equal(C.cleanSidecar({ marks: [mark(1, { osmType: "way", positionM: 45 })] }).marks[0].positionM, 45, "stored estimate kept on reopen");
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

check("Overpass query follows the brief for each radius and stays within the URL bound", () => {
  const q = C.overpassQuery(46.8, 9.2, 30);
  assert.match(q, /^\[out:json\]\[timeout:20\];/);
  assert.equal((q.match(/around:30000,46\.80000,9\.20000/g) || []).length, 6);
  assert.match(q, /out tags center 400;$/);
  for (const r of C.RADII) assert.ok(C.overpassUrl(-89.99999, -179.99999, r).length <= 2048);
  assert.ok(C.overpassUrl(46.8, 9.2, 10).startsWith("https://overpass-api.de/api/interpreter?data="));
  assert.throws(() => C.overpassQuery(46.8, 9.2, 20), /10\/30\/60/);
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

check("Overpass parsing keeps type+id, kinds, placement and weights; drops the rest", () => {
  const body = JSON.stringify({
    elements: [
      { type: "node", id: 1, lat: 46.9, lon: 9.3, tags: { name: "Piz Test", natural: "peak", ele: "3012 m", wikidata: "Q1" } },
      { type: "way", id: 1, center: { lat: 46.85, lon: 9.25 }, tags: { name: "St. Test", building: "church" } },
      { type: "relation", id: 2, center: { lat: 46.7, lon: 9.1 }, tags: { name: "Test Castle", historic: "castle" } },
      { type: "node", id: 3, lat: 46.7, lon: 9.1, tags: { name: "Mast", man_made: "mast" } },
      { type: "node", id: 4, lat: 46.7, lon: 9.1, tags: { name: "Look", tourism: "viewpoint" } },
      { type: "node", id: 5, lat: 46.7, lon: 9.1, tags: { natural: "peak" } },
      { type: "way", id: 6, tags: { name: "No centre", building: "chapel" } },
      { type: "node", id: 1, lat: 46.9, lon: 9.3, tags: { name: "Duplicate", natural: "peak" } },
      { type: "node", id: 7, lat: 46.7, lon: 9.1, tags: { name: "Shop", shop: "bakery" } },
      { type: "area", id: 8, lat: 46.7, lon: 9.1, tags: { name: "Odd", natural: "peak" } },
    ],
  });
  const { features, incomplete } = C.parseOverpass(body);
  assert.equal(incomplete, false);
  assert.deepEqual(features.map(C.featureKey), ["node/1", "way/1", "relation/2", "node/3", "node/4"]);
  const [peak, church, castle, mast, look] = features;
  assert.equal(peak.ele, 3012);
  assert.equal(peak.weight, 1.5);
  assert.equal(peak.maxKm, 100);
  assert.equal(peak.positionM, 8);
  assert.equal(church.positionM, 30);
  assert.equal(church.weight, 1);
  assert.equal(castle.weight, 1.1);
  assert.equal(mast.weight, 1.3);
  assert.equal(look.weight, 0.8);
  assert.equal(C.kindLabel(peak), "peak");
  assert.equal("wikidata" in peak, false);
  const capped = JSON.stringify({ elements: Array.from({ length: 400 }, (_, i) => ({ type: "node", id: i + 1, lat: 46, lon: 9, tags: { name: "T" + i, man_made: "tower" } })) });
  assert.equal(C.parseOverpass(capped).incomplete, true);
  assert.throws(() => C.parseOverpass("<html>busy</html>"), { code: "OVERPASS_DATA" });
  assert.throws(() => C.parseOverpass('{"remark":"runtime error"}'), { code: "OVERPASS_DATA" });
  assert.deepEqual(C.parseOverpass('{"elements":[]}'), { features: [], incomplete: false });
});

check("Overpass HTTP-200 runtime failures never become empty or partial success", () => {
  for (const elements of [[], JSON.parse(F.overpass()).elements]) {
    assert.throws(() => C.parseOverpass(JSON.stringify({ elements, remark: "runtime error: Query timed out" })),
      (e) => e.code === "OVERPASS_INCOMPLETE");
  }
  assert.equal(C.parseOverpass(JSON.stringify({ elements: [], remark: "" })).features.length, 0);
});

check("transport failures name their gate and 429/504 offer a single retry", () => {
  assert.equal(C.httpProblem(null, 429).code, "OVERPASS_BUSY");
  assert.equal(C.httpProblem(null, 504).retry, true);
  assert.equal(C.httpProblem({ code: "CAPABILITY_DENIED" }).retry, false);
  assert.match(C.httpProblem({ code: "CAPABILITY_DENIED" }).message, /Internet access is off/);
  assert.match(C.httpProblem({ code: "HTTP_SIZE" }).message, /smaller radius/);
  assert.match(C.httpProblem({ code: "HTTP_UNAVAILABLE" }).message, /could not be reached/);
});

check("local search: diacritics, nearest first, typed OSM ids", () => {
  const { features } = C.parseOverpass(F.overpass());
  const extra = C.parseOverpass(JSON.stringify({ elements: [{ type: "way", id: 9000000001, center: { lat: 46.81, lon: 9.21 }, tags: { name: "Église Témoin", building: "church" } }] })).features;
  const all = features.concat(extra);
  assert.deepEqual(C.search(all, "eglise", F.viewer).map((r) => r.feature.name), ["Église Témoin"]);
  const every = C.search(all, "", F.viewer).map((r) => r.distanceM);
  assert.deepEqual(every, [...every].sort((a, b) => a - b));
  assert.deepEqual(C.search(all, "node/9000000001", F.viewer).map((r) => C.featureKey(r.feature)), ["node/9000000001"]);
  assert.deepEqual(C.search(all, "w 9000000001", F.viewer).map((r) => C.featureKey(r.feature)), ["way/9000000001"]);
  assert.equal(C.search(all, "9000000001", F.viewer).length, 2, "bare id matches every type");
  assert.deepEqual(C.parseOsmId("relation/42"), { type: "relation", id: 42 });
  assert.equal(C.parseOsmId("tower"), null);
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
  const { features } = C.parseOverpass(F.overpass());
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
  const behind = features.filter((f) => f.name === "Synthetic Viewpoint F");
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
    marks: Array.from({ length: 9 }, (_, j) => ({
      x: 0.12345678901234567,
      y: 0.98765432109876543,
      osmType: "relation",
      osmId: Number.MAX_SAFE_INTEGER - j,
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
