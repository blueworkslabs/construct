"use strict";
// Synthetic check of the Lookout resection solver: does marking known landmarks
// recover heading and field of view well enough to rank the right landmark
// first? No real photos or personal locations; the viewer sits at a fixed
// public reference (Frankfurt airport area) and landmarks are generated.
const assert = require("node:assert/strict");
const S = require("../docs/lookout/resection.js");
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
const viewer = { lat: 50.0379, lon: 8.5622 };
const TAP = 0.005, // 0.5 % of frame width
  GPS_M = 15,
  OSM_M = 5;
const jitter = (p, m) => S.destination(p, rnd() * 360, (Math.abs(gauss(m)) / 1000));
const percentile = (arr, p) => {
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(p * a.length))];
};
// One synthetic scene: true heading/FOV, n known landmarks inside the frame.
// Main phone lenses span roughly 62–78° across the long edge; the default
// guess is 70°. Ultrawide lenses are excluded by the capture copy.
function scene(n, fov = 62 + rnd() * 16) {
  const heading = rnd() * 360,
    marks = [];
  for (let i = 0; i < n; i++) {
    const x = 0.08 + rnd() * 0.84,
      km = 2 + rnd() * 23,
      truth = S.destination(viewer, S.wrap(heading + S.columnAngle(x, fov)), km);
    marks.push({ x: Math.min(1, Math.max(0, x + gauss(TAP))), point: jitter(truth, OSM_M) });
  }
  return { heading, fov, marks, seen: jitter(viewer, GPS_M) };
}
test("angles wrap and invert", () => {
  assert.equal(S.wrap(-90), 270);
  assert.equal(S.diff(10, 350), 20);
  assert.equal(S.diff(350, 10), -20);
  assert.equal(S.columnAngle(0.5, 70), 0);
  assert.ok(Math.abs(S.columnAngle(1, 70) - 35) < 1e-9);
  for (const x of [0, 0.2, 0.5, 0.9, 1]) assert.ok(Math.abs(S.angleColumn(S.columnAngle(x, 66), 66) - x) < 1e-9);
  const p = S.destination(viewer, 47, 12.5);
  assert.ok(Math.abs(S.bearing(viewer, p) - 47) < 1e-6 && Math.abs(S.distance(viewer, p) - 12.5) < 1e-6);
  assert.equal(S.defaultFov(1024, 768), 70);
  assert.ok(S.defaultFov(768, 1024) < 60 && S.defaultFov(768, 1024) > 50);
});
test("input validation", () => {
  assert.throws(() => S.calibrate({ viewer: null, marks: [] }));
  assert.throws(() => S.calibrate({ viewer, marks: [] }), /compass/);
  assert.throws(() => S.calibrate({ viewer, marks: [{ x: 2, point: viewer }] }));
  assert.throws(() => S.calibrate({ viewer, marks: [{ x: 0.5, point: { lat: viewer.lat, lon: viewer.lon + 0.0001 } }] }), /50 m/);
  const c = S.calibrate({ viewer, marks: [], heading: 370 });
  assert.equal(c.source, "compass");
  assert.equal(c.heading, 10);
});
test("one known landmark: exact near the mark, FOV guess limits the far edge", () => {
  const near = [],
    edge = [];
  for (let i = 0; i < 1000; i++) {
    const s = scene(1);
    const cal = S.calibrate({ viewer: s.seen, marks: s.marks, width: 1024, height: 768 });
    assert.equal(cal.source, "one");
    const truth = (x) => s.heading + S.columnAngle(x, s.fov),
      err = (x) => Math.abs(S.diff(S.bearingAt(cal, x), truth(x)));
    // A tap within a fifth of the frame from the mark: only tap/OSM/GPS noise.
    const x1 = s.marks[0].x,
      xn = x1 < 0.5 ? Math.min(1, x1 + 0.2) : Math.max(0, x1 - 0.2);
    near.push(err(xn));
    // Worst case: the far edge with the lens FOV guessed wrong by up to 20°.
    edge.push(err(x1 < 0.5 ? 0.98 : 0.02));
  }
  console.log(`  near-mark bearing error median ${percentile(near, 0.5).toFixed(2)}°, p90 ${percentile(near, 0.9).toFixed(2)}°; far-edge p90 ${percentile(edge, 0.9).toFixed(2)}°`);
  assert.ok(percentile(near, 0.5) < 1.5);
  assert.ok(percentile(near, 0.9) < 3.5);
  assert.ok(percentile(edge, 0.9) < 8);
});
test("two known landmarks also recover the field of view", () => {
  const fovErr = [],
    bearingErr = [];
  for (let i = 0; i < 1000; i++) {
    const s = scene(2);
    const cal = S.calibrate({ viewer: s.seen, marks: s.marks });
    if (cal.source !== "two") continue; // marks too close in bearing; falls back honestly
    fovErr.push(Math.abs(cal.fov - s.fov));
    for (const x of [0.05, 0.5, 0.95]) bearingErr.push(Math.abs(S.diff(S.bearingAt(cal, x), s.heading + S.columnAngle(x, s.fov))));
  }
  console.log(`  FOV error median ${percentile(fovErr, 0.5).toFixed(2)}°, p90 ${percentile(fovErr, 0.9).toFixed(2)}°; bearing p90 ${percentile(bearingErr, 0.9).toFixed(2)}° (${fovErr.length} scenes)`);
  assert.ok(fovErr.length > 750); // random columns are often within 5° of each other
  assert.ok(percentile(fovErr, 0.5) < 4);
  assert.ok(percentile(bearingErr, 0.9) < 4);
});
test("three or more marks fit by least squares and report residual", () => {
  const bearingErr = [],
    residuals = [];
  for (let i = 0; i < 500; i++) {
    const s = scene(3 + Math.floor(rnd() * 3));
    const cal = S.calibrate({ viewer: s.seen, marks: s.marks });
    assert.ok(["fit", "two", "one"].includes(cal.source));
    residuals.push(cal.residualDeg);
    for (const x of [0.05, 0.5, 0.95]) bearingErr.push(Math.abs(S.diff(S.bearingAt(cal, x), s.heading + S.columnAngle(x, s.fov))));
  }
  console.log(`  bearing p90 ${percentile(bearingErr, 0.9).toFixed(2)}°, residual median ${percentile(residuals, 0.5).toFixed(2)}°`);
  assert.ok(percentile(bearingErr, 0.9) < 3);
  assert.ok(percentile(residuals, 0.9) < 3);
});
test("nearly collinear pair falls back to one-mark behaviour", () => {
  const a = S.destination(viewer, 100, 10),
    b = S.destination(viewer, 101, 20);
  const cal = S.calibrate({ viewer, marks: [{ x: 0.5, point: a }, { x: 0.52, point: b }] });
  assert.equal(cal.source, "one");
  assert.equal(cal.marks, 2);
});
test("ranking: the tapped landmark comes first after one mark, mostly top-3 on compass alone", () => {
  let firstMarked = 0,
    top3Marked = 0,
    top3Compass = 0,
    trials = 500;
  for (let i = 0; i < trials; i++) {
    const s = scene(1);
    // Eight candidates spread over the frame plus the true target at a random column.
    const xt = 0.1 + rnd() * 0.8,
      target = { point: jitter(S.destination(viewer, S.wrap(s.heading + S.columnAngle(xt, s.fov)), 3 + rnd() * 20), OSM_M), name: "target" };
    const others = [];
    for (let k = 0; k < 8; k++) {
      const xk = rnd(),
        km = 2 + rnd() * 30;
      others.push({ point: S.destination(viewer, S.wrap(s.heading + S.columnAngle(xk, s.fov) + gauss(3)), km), name: "other" + k });
    }
    const tap = Math.min(1, Math.max(0, xt + gauss(TAP)));
    const marked = S.calibrate({ viewer: s.seen, marks: s.marks, width: 1024, height: 768 });
    const rm = S.rank(marked, tap, s.seen, [target, ...others]);
    if (rm[0].candidate === target) firstMarked++;
    if (rm.slice(0, 3).some((e) => e.candidate === target)) top3Marked++;
    const compass = S.calibrate({ viewer: s.seen, marks: [], heading: s.heading + gauss(S.COMPASS_SIGMA), width: 1024, height: 768 });
    const r = S.rank(compass, tap, s.seen, [target, ...others]).slice(0, 3);
    if (r.some((e) => e.candidate === target)) top3Compass++;
  }
  // Eight decoys in one frame is dense (one per ~9°); real scenes vary.
  console.log(`  marked: target first ${((firstMarked / trials) * 100).toFixed(1)} %, top 3 ${((top3Marked / trials) * 100).toFixed(1)} %; compass only: top 3 ${((top3Compass / trials) * 100).toFixed(1)} %`);
  assert.ok(firstMarked / trials > 0.7);
  assert.ok(top3Marked / trials > 0.9);
  assert.ok(top3Compass / trials > 0.6);
  const cal = S.calibrate({ viewer, marks: [], heading: 0 });
  assert.ok(S.uncertainty(cal, 0.5) > S.COMPASS_SIGMA);
  assert.ok(S.uncertainty(S.calibrate({ viewer, marks: [{ x: 0.5, point: S.destination(viewer, 0, 5) }] }), 0.5) < 3);
  assert.deepEqual(S.rank(cal, 0.5, viewer, [null, { point: { lat: 200, lon: 0 } }]), []);
});
test("three clustered or duplicate marks do not manufacture a fitted lens", () => {
  for (const marks of [
    [.499, .5, .501].map((x, i) => ({x, point: S.destination(viewer, 90 + i * .2, 5)})),
    Array.from({length: 3}, () => ({x: .5, point: S.destination(viewer, 90, 5)})),
    [80, 90, 100].map((b) => ({x: .5, point: S.destination(viewer, b, 5)})),
  ]) {
    const cal = S.calibrate({viewer, marks});
    assert.equal(cal.source, "one");
    assert.equal(cal.reason, "insufficient-spread");
    assert.equal(cal.fov, 70);
    assert.equal(cal.marks, 3);
  }
});
test("ranking preserves angular order even when all displayed scores underflow", () => {
  const cal = S.calibrate({viewer, marks: [{x: .5, point: S.destination(viewer, 0, 5)}]});
  const behind = {name: "behind", point: S.destination(viewer, 160, 1)};
  const closerRay = {name: "closer-ray", point: S.destination(viewer, 40, 10)};
  const ranked = S.rank(cal, .5, viewer, [behind, closerRay]);
  assert.equal(ranked[0].candidate, closerRay);
  assert.equal(ranked[0].score, 0);
  assert.equal(ranked[1].score, 0);
  assert.ok(ranked[0].logScore > ranked[1].logScore);
});
console.log(`${count} Lookout resection checks passed.`);
