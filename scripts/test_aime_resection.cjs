"use strict";
// Synthetic check of the Aimé resection solver. Scenes have a full pose
// (heading, lens, pitch, roll); marks and taps are 2D. Beyond accuracy, the
// suite measures COVERAGE: how often the true error lies within 2σ of the
// reported uncertainty. No real photos or personal locations; the viewer sits
// at a public reference (Frankfurt airport area) and landmarks are generated.
const assert = require("node:assert/strict");
const S = require("../docs/aime/resection.js");
let count = 0;
function test(name, body) {
  body();
  count++;
  console.log("PASS " + name);
}
// Deterministic PRNG (mulberry32) so failures reproduce.
let seed = 20260926;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const gauss = (s) => s * Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
const viewer = { lat: 50.0379, lon: 8.5622, accuracyM: 15 };
const W = 1024,
  H = 768,
  ASPECT = H / W,
  TAP = 0.005, // 0.5 % of frame
  GPS_M = 15,
  OSM_M = 5;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const jitter = (p, m) => S.destination(p, rnd() * 360, Math.abs(gauss(m)) / 1000);
const percentile = (arr, p) => {
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(p * a.length))];
};
const fmt = (v) => v.toFixed(2) + "°";
// Truth helpers for a pose.
const truthCal = (P) => ({ ...P, aspect: ASPECT });
const truthBearing = (P, x, y) => S.azimuthOf(P, ASPECT, x, y);
// A synthetic scene: main lens 62–78° (70° guessed), pitch −5…25° down, roll ±5°.
function scene(n, opts = {}) {
  const P = {
    heading: rnd() * 360,
    fov: opts.fov ?? 62 + rnd() * 16,
    pitch: opts.pitch ?? -5 + rnd() * 30,
    roll: opts.roll ?? gauss(3),
  };
  const marks = [];
  for (let i = 0; i < n; i++) {
    const x = 0.08 + rnd() * 0.84,
      y = 0.15 + rnd() * 0.7,
      km = 2 + rnd() * 23,
      truth = S.destination(viewer, truthBearing(P, x, y), km);
    marks.push({ x: clamp01(x + gauss(TAP)), y: clamp01(y + gauss(TAP)), point: jitter(truth, OSM_M) });
  }
  // Two horizon taps when the horizon is inside the frame.
  const horizon = [];
  for (const x of [0.2, 0.8]) {
    const y = S.horizonRow(truthCal(P), x);
    if (y > 0.02 && y < 0.98) horizon.push({ x, y: clamp01(y + gauss(TAP)) });
  }
  return { P, marks, horizon: horizon.length === 2 ? horizon : [], seen: { ...jitter(viewer, GPS_M), accuracyM: 15 } };
}
// Error and 2σ coverage over random taps for a calibration.
function evaluate(cal, P, taps = 5) {
  const out = [];
  for (let i = 0; i < taps; i++) {
    const x = rnd(),
      y = rnd(),
      err = Math.abs(S.diff(S.bearingAt(cal, x, y), truthBearing(P, x, y))),
      sigma = S.uncertainty(cal, x, y);
    out.push({ err, sigma, covered: err <= 2 * sigma });
  }
  return out;
}
function report(label, rows, minCoverage, maxP90) {
  const errs = rows.map((r) => r.err),
    cov = rows.filter((r) => r.covered).length / rows.length,
    sig = rows.map((r) => r.sigma);
  console.log(
    `  ${label}: error median ${fmt(percentile(errs, 0.5))}, p90 ${fmt(percentile(errs, 0.9))}; σ median ${fmt(percentile(sig, 0.5))}; 2σ coverage ${(cov * 100).toFixed(1)} % (${rows.length} taps)`,
  );
  assert.ok(cov >= minCoverage, `${label}: coverage ${cov} below ${minCoverage}`);
  if (maxP90 !== undefined) assert.ok(percentile(errs, 0.9) < maxP90, `${label}: p90 ${percentile(errs, 0.9)} above ${maxP90}`);
  return { cov, p90: percentile(errs, 0.9) };
}
test("forward model: level camera matches the column formula, horizon follows pitch and roll", () => {
  for (const x of [0, 0.3, 0.5, 0.9, 1]) {
    const P = { heading: 123, fov: 70, pitch: 0, roll: 0 };
    assert.ok(Math.abs(S.diff(S.azimuthOf(P, ASPECT, x, 0.5), 123 + S.columnAngle(x, 70))) < 1e-9);
    assert.ok(Math.abs(S.elevationOf(P, ASPECT, x, 0.5)) < 1e-9);
  }
  const down = truthCal({ heading: 0, fov: 70, pitch: 20, roll: 0 });
  const expectedRow = 0.5 - Math.tan(S.wrap(20) * (Math.PI / 180)) / (2 * Math.tan((70 / 2) * (Math.PI / 180)) * ASPECT);
  assert.ok(Math.abs(S.horizonRow(down, 0.5) - expectedRow) < 1e-6);
  assert.ok(S.horizonRow(down, 0.5) < 0.5, "looking down puts the horizon above centre");
  assert.ok(Math.abs(S.elevationAt(down, 0.5, S.horizonRow(down, 0.5))) < 1e-6);
  const rolled = truthCal({ heading: 0, fov: 70, pitch: 0, roll: 10 });
  assert.ok(S.horizonRow(rolled, 0.1) !== S.horizonRow(rolled, 0.9), "roll tilts the horizon");
  assert.equal(S.wrap(-90), 270);
  assert.equal(S.diff(10, 350), 20);
  assert.equal(S.defaultFov(1024, 768), 70);
  assert.ok(S.defaultFov(768, 1024) < 60 && S.defaultFov(768, 1024) > 50);
});
test("input validation and compass-only calibration", () => {
  assert.throws(() => S.calibrate({ viewer: null, marks: [] }));
  assert.throws(() => S.calibrate({ viewer, marks: [] }), /compass/);
  assert.throws(() => S.calibrate({ viewer, marks: [{ x: 0.5, point: S.destination(viewer, 0, 5) }] }), /x and y/);
  assert.throws(() => S.calibrate({ viewer, marks: [{ x: 0.5, y: 0.5, point: { lat: viewer.lat, lon: viewer.lon + 0.0001 } }] }), /50 m/);
  assert.throws(() => S.calibrate({ viewer, marks: [], heading: 0, horizon: [{ x: 2, y: 0 }] }), /horizon/);
  const c = S.calibrate({ viewer, marks: [], heading: 370, width: W, height: H });
  assert.equal(c.source, "compass");
  assert.ok(Math.abs(S.diff(c.heading, 10)) < 1e-6);
  assert.equal(c.lens, "assumed");
  assert.equal(c.level, "assumed");
  assert.ok(S.uncertainty(c, 0.5, 0.5) > S.COMPASS_SIGMA * 0.9);
});
test("one mark: exact near the mark, honest σ elsewhere (2σ coverage ≥ 90 %)", () => {
  const near = [],
    all = [];
  for (let i = 0; i < 600; i++) {
    const s = scene(1);
    const cal = S.calibrate({ viewer: s.seen, marks: s.marks, width: W, height: H });
    assert.equal(cal.source, "marks");
    assert.equal(cal.lens, "assumed");
    const m = s.marks[0],
      xn = clamp01(m.x + (m.x < 0.5 ? 0.15 : -0.15));
    near.push(Math.abs(S.diff(S.bearingAt(cal, xn, m.y), truthBearing(s.P, xn, m.y))));
    all.push(...evaluate(cal, s.P));
  }
  console.log(`  near the mark (same row, 15 % away): median ${fmt(percentile(near, 0.5))}, p90 ${fmt(percentile(near, 0.9))}`);
  assert.ok(percentile(near, 0.9) < 3.5);
  report("one mark, random taps", all, 0.9);
});
test("two marks: lens fitted when separated, coverage holds either way", () => {
  const fitted = [],
    assumed = [],
    fovErr = [];
  for (let i = 0; i < 600; i++) {
    const s = scene(2);
    const cal = S.calibrate({ viewer: s.seen, marks: s.marks, width: W, height: H });
    (cal.lens === "fitted" ? fitted : assumed).push(...evaluate(cal, s.P));
    if (cal.lens === "fitted") fovErr.push(Math.abs(cal.fov - s.P.fov));
  }
  console.log(`  lens fitted in ${fitted.length / 5} scenes (FOV error median ${fmt(percentile(fovErr, 0.5))}), assumed in ${assumed.length / 5}`);
  report("two marks, lens fitted", fitted, 0.9);
  if (assumed.length) report("two marks, lens assumed", assumed, 0.9);
});
test("two marks plus a horizon line: the elevated-viewpoint case", () => {
  const rows = [],
    level = [];
  for (let i = 0; i < 600; i++) {
    const s = scene(2);
    if (s.horizon.length < 2) continue;
    const cal = S.calibrate({ viewer: s.seen, marks: s.marks, horizon: s.horizon, width: W, height: H });
    rows.push(...evaluate(cal, s.P));
    level.push(Math.hypot(cal.pitch - s.P.pitch, cal.roll - s.P.roll));
  }
  console.log(`  pitch/roll error median ${fmt(percentile(level, 0.5))}, p90 ${fmt(percentile(level, 0.9))} (${rows.length / 5} scenes with the horizon in frame)`);
  report("two marks + horizon", rows, 0.9, 3);
});
test("three or more marks: pose solved from bearings alone", () => {
  const rows = [];
  for (let i = 0; i < 400; i++) {
    const s = scene(3 + Math.floor(rnd() * 3));
    const cal = S.calibrate({ viewer: s.seen, marks: s.marks, width: W, height: H });
    rows.push(...evaluate(cal, s.P));
  }
  report("three-plus marks", rows, 0.9, 4);
});
test("review case: 25° pitch, two perfect marks on the centre row, tap at (0.8, 0.9)", () => {
  const P = { heading: 40, fov: 70, pitch: 25, roll: 0 };
  const marks = [0.2, 0.8].map((x) => ({ x, y: 0.5, point: S.destination(viewer, truthBearing(P, x, 0.5), 10) }));
  const cal = S.calibrate({ viewer, marks, width: W, height: H });
  const err = Math.abs(S.diff(S.bearingAt(cal, 0.8, 0.9), truthBearing(P, 0.8, 0.9))),
    sigma = S.uncertainty(cal, 0.8, 0.9);
  console.log(`  without horizon: error ${fmt(err)}, σ ${fmt(sigma)}`);
  assert.ok(err <= 2 * sigma, "error must be inside the reported 2σ");
  const horizon = [0.2, 0.8].map((x) => ({ x, y: S.horizonRow(truthCal(P), x) }));
  const levelled = S.calibrate({ viewer, marks, horizon, width: W, height: H });
  const err2 = Math.abs(S.diff(S.bearingAt(levelled, 0.8, 0.9), truthBearing(P, 0.8, 0.9)));
  console.log(`  with horizon: error ${fmt(err2)}, σ ${fmt(S.uncertainty(levelled, 0.8, 0.9))}, pitch ${fmt(levelled.pitch)}`);
  assert.ok(err2 < 0.5);
  assert.ok(Math.abs(levelled.pitch - 25) < 1);
  assert.equal(levelled.level, "fitted");
});
test("review case: 10° roll, two perfect marks, tap on the bottom row", () => {
  const P = { heading: 300, fov: 70, pitch: 0, roll: 10 };
  const marks = [0.2, 0.8].map((x) => ({ x, y: 0.5, point: S.destination(viewer, truthBearing(P, x, 0.5), 8) }));
  const cal = S.calibrate({ viewer, marks, width: W, height: H });
  const err = Math.abs(S.diff(S.bearingAt(cal, 0.8, 0.9), truthBearing(P, 0.8, 0.9))),
    sigma = S.uncertainty(cal, 0.8, 0.9);
  console.log(`  roll only: error ${fmt(err)}, σ ${fmt(sigma)}`);
  assert.ok(err <= 2 * sigma);
  const horizon = [0.1, 0.9].map((x) => ({ x, y: S.horizonRow(truthCal(P), x) }));
  const levelled = S.calibrate({ viewer, marks, horizon, width: W, height: H });
  assert.ok(Math.abs(levelled.roll - 10) < 1.5, `roll ${levelled.roll}`);
  assert.ok(Math.abs(S.diff(S.bearingAt(levelled, 0.8, 0.9), truthBearing(P, 0.8, 0.9))) < 0.7);
});
test("review case: one mark at the right edge, true lens 78°, default 70°: centre error inside σ", () => {
  const P = { heading: 200, fov: 78, pitch: 0, roll: 0 };
  const marks = [{ x: 1, y: 0.5, point: S.destination(viewer, truthBearing(P, 1, 0.5), 12) }];
  const cal = S.calibrate({ viewer, marks, width: W, height: H });
  const err = Math.abs(S.diff(S.bearingAt(cal, 0.5, 0.5), truthBearing(P, 0.5, 0.5))),
    sigma = S.uncertainty(cal, 0.5, 0.5);
  console.log(`  edge mark: centre error ${fmt(err)}, σ ${fmt(sigma)}; σ at the mark ${fmt(S.uncertainty(cal, 1, 0.5))}`);
  assert.ok(err <= 2 * sigma);
  assert.ok(S.uncertainty(cal, 1, 0.5) < sigma, "uncertainty is smallest at the reference mark");
});
test("review case: two close marks with a 0.7° perturbation do not manufacture a lens", () => {
  const P = { heading: 90, fov: 70, pitch: 0, roll: 0 };
  const marks = [0.1, 0.18].map((x, i) => ({ x, y: 0.5, point: S.destination(viewer, truthBearing(P, x, 0.5) + (i ? 0.7 : 0), 6) }));
  const cal = S.calibrate({ viewer, marks, width: W, height: H });
  const err = Math.abs(S.diff(S.bearingAt(cal, 0.95, 0.5), truthBearing(P, 0.95, 0.5))),
    sigma = S.uncertainty(cal, 0.95, 0.5);
  console.log(`  close pair: fov ${fmt(cal.fov)} (${cal.lens}), far-edge error ${fmt(err)}, σ ${fmt(sigma)}`);
  assert.ok(Math.abs(cal.fov - 70) < 6, "prior keeps the lens sane");
  assert.equal(cal.lens, "assumed");
  assert.ok(err <= 2 * sigma);
});
test("clustered or duplicate marks do not manufacture a fitted lens", () => {
  for (const marks of [
    [0.499, 0.5, 0.501].map((x, i) => ({ x, y: 0.5, point: S.destination(viewer, 90 + i * 0.2, 5) })),
    Array.from({ length: 3 }, () => ({ x: 0.5, y: 0.5, point: S.destination(viewer, 90, 5) })),
    [80, 90, 100].map((b) => ({ x: 0.5, y: 0.5, point: S.destination(viewer, b, 5) })),
  ]) {
    const cal = S.calibrate({ viewer, marks, width: W, height: H });
    assert.equal(cal.lens, "assumed");
    assert.ok(Math.abs(cal.fov - 70) < 2, `fov ${cal.fov}`);
    assert.equal(cal.marks, 3);
  }
  // Inconsistent marks (80/90/100° at one pixel) must widen σ, not hide it.
  const bad = S.calibrate({ viewer, marks: [80, 90, 100].map((b) => ({ x: 0.5, y: 0.5, point: S.destination(viewer, b, 5) })), width: W, height: H });
  assert.ok(bad.residualDeg > 5 && S.uncertainty(bad, 0.5, 0.5) > 5, `residual ${bad.residualDeg}, σ ${S.uncertainty(bad, 0.5, 0.5)}`);
});
test("coarse or nearby: position accuracy flows into σ", () => {
  const fine = S.calibrate({ viewer: { ...viewer, accuracyM: 10 }, marks: [{ x: 0.5, y: 0.5, point: S.destination(viewer, 0, 5) }], width: W, height: H });
  const coarse = S.calibrate({ viewer: { ...viewer, accuracyM: 2000 }, marks: [{ x: 0.5, y: 0.5, point: S.destination(viewer, 0, 5) }], width: W, height: H });
  const close = S.calibrate({ viewer: { ...viewer, accuracyM: 15 }, marks: [{ x: 0.5, y: 0.5, point: S.destination(viewer, 0, 0.06) }], width: W, height: H });
  console.log(`  σ at the mark: fine ${fmt(S.uncertainty(fine, 0.5, 0.5))}, coarse 2 km ${fmt(S.uncertainty(coarse, 0.5, 0.5))}, mark 60 m away ${fmt(S.uncertainty(close, 0.5, 0.5))}`);
  assert.ok(S.uncertainty(coarse, 0.5, 0.5) > 15);
  assert.ok(S.uncertainty(close, 0.5, 0.5) > 10);
  assert.ok(S.uncertainty(fine, 0.5, 0.5) < 1.5);
});
// Scenes with the viewer error as ONE shared offset and marks/targets close by.
function nearScene(n, opts = {}) {
  const P = { heading: rnd() * 360, fov: 62 + rnd() * 16, pitch: -5 + rnd() * 30, roll: gauss(3) };
  const accuracyM = opts.accuracyM ?? 15,
    truthViewer = viewer,
    seen = { ...S.destination(truthViewer, rnd() * 360, Math.abs(gauss(accuracyM)) / 1000), accuracyM };
  const marks = [];
  for (let i = 0; i < n; i++) {
    const x = 0.08 + rnd() * 0.84,
      y = 0.15 + rnd() * 0.7,
      km = opts.minKm + rnd() * (opts.maxKm - opts.minKm),
      truth = S.destination(truthViewer, truthBearing(P, x, y), km);
    marks.push({ x: clamp01(x + gauss(TAP)), y: clamp01(y + gauss(TAP)), point: jitter(truth, OSM_M) });
  }
  return { P, marks, seen, truthViewer };
}
// Candidate-comparison coverage: is the true target's |delta| within 2σ of ITS σ?
function evaluateTargets(cal, s, minKm, maxKm, taps = 4) {
  const out = [];
  for (let i = 0; i < taps; i++) {
    const x = rnd(),
      y = rnd(),
      km = minKm + rnd() * (maxKm - minKm),
      target = { point: jitter(S.destination(s.truthViewer, truthBearing(s.P, x, y), km), OSM_M) };
    const r = S.rank(cal, clamp01(x + gauss(TAP)), clamp01(y + gauss(TAP)), [target])[0];
    out.push({ err: Math.abs(r.deltaDeg), sigma: r.sigmaDeg, covered: r.close });
  }
  return out;
}
test("review case: six marks 100 m away with a 15 m shared fix error do not average it away", () => {
  const truth = { lat: 50, lon: 8 },
    seen = { ...S.destination(truth, 90, 0.015), accuracyM: 15 };
  const marks = Array.from({ length: 6 }, (_, i) => {
    const x = 0.2 + (0.6 * i) / 5;
    return { x, y: 0.5, point: S.destination(truth, S.columnAngle(x, 70), 0.1) };
  });
  const c = S.calibrate({ viewer: seen, marks, horizon: [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }], width: W, height: H });
  const err = Math.abs(S.diff(S.bearingAt(c, 0.5, 0.5), 0)),
    sigma = S.uncertainty(c, 0.5, 0.5),
    moved = S.distance(seen, c.viewer) * 1000;
  console.log(`  centre error ${fmt(err)}, σ ${fmt(sigma)}, χ² ${c.chi2.toFixed(3)}, viewpoint moved ${moved.toFixed(1)} m (${c.viewpoint}), true offset 15 m`);
  // Marks fanned along one row at one distance cannot separate a sideways
  // viewpoint shift from a heading rotation; the honest answer is a wide σ
  // (15 m over 100 m ≈ 8.5°), not a confident wrong heading.
  assert.ok(err <= 2 * sigma, "error inside 2σ");
  assert.ok(sigma > 5, "σ carries the 15 m / 100 m ambiguity");
  assert.equal(c.viewpoint, "reported");
  // A genuine target 100 m away at bearing 30°, tap on the optical axis: delta must read ≈30° within its σ.
  const r = S.rank(c, 0.5, 0.5, [{ point: S.destination(truth, 30, 0.1) }])[0];
  assert.ok(Math.abs(Math.abs(r.deltaDeg) - 30) <= 2 * r.sigmaDeg, `delta ${r.deltaDeg} σ ${r.sigmaDeg}`);
});
test("review case: 10 km mark, 15 m fix error, genuine target 100 m away is not rejected", () => {
  const truth = { lat: 50, lon: 8 },
    seen = { ...S.destination(truth, 90, 0.015), accuracyM: 15 };
  const mark = { x: 0.5, y: 0.5, point: S.destination(truth, 0, 10) },
    cal = S.calibrate({ viewer: seen, marks: [mark], width: W, height: H });
  const tx = S.angleColumn(30, 70),
    r = S.rank(cal, tx, 0.5, [{ point: S.destination(truth, 30, 0.1) }])[0];
  console.log(`  100 m target: delta ${fmt(r.deltaDeg)}, σ ${fmt(r.sigmaDeg)} (wedge σ ${fmt(r.wedgeSigmaDeg)}), close ${r.close}`);
  assert.ok(r.close, "nearby target inside its own 2σ");
  assert.ok(r.sigmaDeg > 4 && r.sigmaDeg < 20, "σ reflects 15 m over 100 m");
  assert.ok(r.wedgeSigmaDeg < 5, "the wedge itself stays narrow (lens assumed, 30° off-centre)");
  const rf = S.rank(cal, tx, 0.5, [{ point: S.destination(truth, 30, 8) }])[0];
  assert.ok(rf.sigmaDeg < 5 && rf.sigmaDeg < r.sigmaDeg / 2, `far target σ ${rf.sigmaDeg} vs near ${r.sigmaDeg}`);
  assert.ok(rf.close);
});
test("shared error cancels for a candidate beside a mark, grows for a candidate much nearer", () => {
  const truth = { lat: 50, lon: 8 },
    seen = { ...S.destination(truth, 45, 0.3), accuracyM: 300 };
  const mark = { x: 0.5, y: 0.5, point: S.destination(truth, 0, 5) },
    cal = S.calibrate({ viewer: seen, marks: [mark], width: W, height: H });
  const beside = S.rank(cal, 0.5, 0.5, [{ point: S.destination(truth, 0, 5.2) }])[0],
    nearer = S.rank(cal, 0.5, 0.5, [{ point: S.destination(truth, 0, 0.6) }])[0];
  console.log(`  coarse 300 m fix: σ beside the mark ${fmt(beside.sigmaDeg)}, σ for a target at 600 m ${fmt(nearer.sigmaDeg)}, wedge ${fmt(beside.wedgeSigmaDeg)}`);
  assert.ok(beside.sigmaDeg < 2, "a candidate next to the mark shares its error");
  assert.ok(nearer.sigmaDeg > 10, "a much nearer candidate does not");
  assert.ok(beside.close && nearer.close);
});
test("nearby marks (0.1–2 km), 15 m fix: 2σ coverage for directions and for candidates", () => {
  const dirs = [],
    tg = [];
  for (let i = 0; i < 300; i++) {
    const s = nearScene(1 + Math.floor(rnd() * 6), { minKm: 0.1, maxKm: 2 });
    const cal = S.calibrate({ viewer: s.seen, marks: s.marks, width: W, height: H });
    dirs.push(...evaluate(cal, s.P));
    tg.push(...evaluateTargets(cal, s, 0.1, 2));
  }
  report("nearby, directions", dirs, 0.9);
  report("nearby, candidate comparison", tg, 0.9);
});
test("coarse fix (300–2000 m), marks 1–10 km: coverage holds and σ is wide", () => {
  const dirs = [],
    tg = [],
    sig = [];
  for (let i = 0; i < 300; i++) {
    const s = nearScene(1 + Math.floor(rnd() * 3), { minKm: 1, maxKm: 10, accuracyM: 300 + rnd() * 1700 });
    const cal = S.calibrate({ viewer: s.seen, marks: s.marks, width: W, height: H });
    dirs.push(...evaluate(cal, s.P));
    const t = evaluateTargets(cal, s, 0.5, 10);
    tg.push(...t);
    sig.push(...t.map((r) => r.sigma));
  }
  report("coarse fix, directions", dirs, 0.9);
  report("coarse fix, candidate comparison", tg, 0.9);
  assert.ok(percentile(sig, 0.5) > 3, "coarse fixes must widen candidate σ");
});
test("ranking: tapped landmark first after one mark, top-3 with horizon, preserved order on underflow", () => {
  let firstMarked = 0,
    top3Marked = 0,
    top3Compass = 0;
  const trials = 400;
  for (let i = 0; i < trials; i++) {
    const s = scene(1);
    const xt = 0.1 + rnd() * 0.8,
      yt = 0.15 + rnd() * 0.7,
      target = { point: jitter(S.destination(viewer, truthBearing(s.P, xt, yt), 3 + rnd() * 20), OSM_M), name: "target" };
    const others = [];
    for (let k = 0; k < 8; k++)
      others.push({ point: S.destination(viewer, truthBearing(s.P, rnd(), rnd()) + gauss(3), 2 + rnd() * 30), name: "other" + k });
    const tx = clamp01(xt + gauss(TAP)),
      ty = clamp01(yt + gauss(TAP));
    const marked = S.calibrate({ viewer: s.seen, marks: s.marks, horizon: s.horizon, width: W, height: H });
    const rm = S.rank(marked, tx, ty, [target, ...others]);
    if (rm[0].candidate === target) firstMarked++;
    if (rm.slice(0, 3).some((e) => e.candidate === target)) top3Marked++;
    const compass = S.calibrate({ viewer: s.seen, marks: [], heading: s.P.heading + gauss(S.COMPASS_SIGMA), width: W, height: H });
    if (S.rank(compass, tx, ty, [target, ...others]).slice(0, 3).some((e) => e.candidate === target)) top3Compass++;
  }
  console.log(`  one mark (+horizon when in frame) vs 8 decoys: first ${((firstMarked / trials) * 100).toFixed(1)} %, top 3 ${((top3Marked / trials) * 100).toFixed(1)} %; compass only top 3 ${((top3Compass / trials) * 100).toFixed(1)} %`);
  assert.ok(firstMarked / trials > 0.6);
  assert.ok(top3Marked / trials > 0.85);
  assert.ok(top3Compass / trials > 0.5);
  const cal = S.calibrate({ viewer, marks: [{ x: 0.5, y: 0.5, point: S.destination(viewer, 0, 5) }], width: W, height: H });
  const behind = { name: "behind", point: S.destination(viewer, 160, 1) },
    closerRay = { name: "closer-ray", point: S.destination(viewer, 40, 10) };
  const ranked = S.rank(cal, 0.5, 0.5, [behind, closerRay]);
  assert.equal(ranked[0].candidate, closerRay);
  assert.equal(ranked[0].score, 0);
  assert.ok(ranked[0].logScore > ranked[1].logScore);
  assert.deepEqual(S.rank(cal, 0.5, 0.5, [null, { point: { lat: 200, lon: 0 } }]), []);
});
console.log(`${count} Aimé resection checks passed.`);
