"use strict";
// Lookout reference solver: photo column ↔ compass bearing by resection.
// Pure functions, no DOM, no host calls. Runs in the module (global `Resection`)
// and under Node for the synthetic checks in scripts/test_lookout_resection.cjs.
//
// Model: pinhole camera, roll ≈ 0, small pitch. A column x in [0, 1] across the
// photo (0 = left edge) sits at a horizontal angle θ(x) from the optical axis:
//   θ(x) = atan((x − ½) · 2 · tan(f/2))          f = horizontal field of view
// The bearing of that column is heading + θ(x). Marking a landmark of known
// position at column x pins heading; two marks also pin f.
const Resection = (() => {
  const R = 6371.0088,
    rad = (x) => (x * Math.PI) / 180,
    deg = (x) => (x * 180) / Math.PI,
    wrap = (d) => ((d % 360) + 360) % 360,
    // Signed smallest difference a − b in (−180, 180].
    diff = (a, b) => ((((a - b) % 360) + 540) % 360) - 180,
    num = (x) => typeof x === "number" && Number.isFinite(x);
  const FOV_MIN = 20,
    FOV_MAX = 120,
    TAP_SIGMA = 0.7, // degrees: ~1 % of frame width at 70° FOV
    COMPASS_SIGMA = 12, // degrees: typical phone magnetometer after calibration
    FOV_GUESS_SIGMA = 8; // degrees: unknown lens, default FOV assumed
  const point = (p) =>
    p && num(p.lat) && num(p.lon) && Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180;
  function distance(a, b) {
    const h =
      Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
      Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
  }
  function bearing(a, b) {
    const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat)),
      x =
        Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
        Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
    return wrap(deg(Math.atan2(y, x)));
  }
  // Destination point: from `a`, bearing `b` degrees, distance `km`.
  function destination(a, b, km) {
    const d = km / R,
      la = rad(a.lat),
      lo = rad(a.lon),
      br = rad(b),
      lat = Math.asin(Math.sin(la) * Math.cos(d) + Math.cos(la) * Math.sin(d) * Math.cos(br)),
      lon = lo + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(la), Math.cos(d) - Math.sin(la) * Math.sin(lat));
    return { lat: deg(lat), lon: ((deg(lon) + 540) % 360) - 180 };
  }
  const clampFov = (f) => Math.max(FOV_MIN, Math.min(FOV_MAX, f));
  const columnAngle = (x, f) => deg(Math.atan((x - 0.5) * 2 * Math.tan(rad(clampFov(f)) / 2)));
  const angleColumn = (a, f) => 0.5 + Math.tan(rad(a)) / (2 * Math.tan(rad(clampFov(f)) / 2));
  // Typical phone main lens: ~70° across the long edge. Portrait photos are
  // narrower across their width. Ultrawide lenses are out of scope.
  function defaultFov(width, height) {
    if (!num(width) || !num(height) || width <= 0 || height <= 0) return 70;
    const long = Math.max(width, height),
      short = Math.min(width, height);
    return width >= height ? 70 : deg(2 * Math.atan(Math.tan(rad(35)) * (short / long)));
  }
  // Circular mean of angles in degrees.
  function meanAngle(list) {
    let sx = 0,
      sy = 0;
    for (const a of list) {
      sx += Math.cos(rad(a));
      sy += Math.sin(rad(a));
    }
    return wrap(deg(Math.atan2(sy, sx)));
  }
  // For a fixed FOV, the best heading is the circular mean of (β_k − θ_k).
  function fitHeading(marks, f) {
    return meanAngle(marks.map((m) => m.bearing - columnAngle(m.x, f)));
  }
  function rms(marks, heading, f) {
    let s = 0;
    for (const m of marks) s += diff(m.bearing, heading + columnAngle(m.x, f)) ** 2;
    return Math.sqrt(s / marks.length);
  }
  // Golden-section search for the FOV minimising the RMS bearing residual.
  function fitFov(marks) {
    let lo = FOV_MIN,
      hi = FOV_MAX;
    const g = (Math.sqrt(5) - 1) / 2,
      cost = (f) => rms(marks, fitHeading(marks, f), f);
    let a = hi - g * (hi - lo),
      b = lo + g * (hi - lo),
      fa = cost(a),
      fb = cost(b);
    for (let i = 0; i < 60; i++) {
      if (fa < fb) {
        hi = b;
        b = a;
        fb = fa;
        a = hi - g * (hi - lo);
        fa = cost(a);
      } else {
        lo = a;
        a = b;
        fa = fb;
        b = lo + g * (hi - lo);
        fb = cost(b);
      }
    }
    return (lo + hi) / 2;
  }
  // calibrate({viewer, marks, fov, heading, width, height})
  //   viewer: {lat, lon}          where the photo was taken
  //   marks:  [{x, point}]        column in [0,1] and the landmark's position
  //   fov:    known horizontal FOV in degrees (optional)
  //   heading: compass bearing of the optical axis (optional, used with no marks)
  // Returns {heading, fov, source, residualDeg, marks:n} or throws on bad input.
  function calibrate(input) {
    const { viewer, marks = [], width, height } = input;
    if (!point(viewer)) throw new Error("Viewer position required.");
    const list = marks.map((m) => {
      if (!m || !num(m.x) || m.x < 0 || m.x > 1 || !point(m.point))
        throw new Error("Each mark needs a column in [0, 1] and a position.");
      if (distance(viewer, m.point) < 0.05)
        throw new Error("A mark must be at least 50 m from the viewer.");
      return { x: m.x, bearing: bearing(viewer, m.point) };
    });
    const guess = num(input.fov) ? clampFov(input.fov) : defaultFov(width, height);
    if (list.length === 0) {
      if (!num(input.heading)) throw new Error("Without a mark a compass heading is required.");
      return { heading: wrap(input.heading), fov: guess, source: "compass", residualDeg: 0, marks: 0 };
    }
    if (list.length === 1 || num(input.fov)) {
      const heading = fitHeading(list, guess);
      return {
        heading,
        fov: guess,
        source: list.length === 1 ? "one" : "fixed-fov",
        residualDeg: rms(list, heading, guess),
        marks: list.length,
      };
    }
    // Repeated/clustered marks do not become informative just by adding more.
    // This is a basic degeneracy check, not a complete conditioning estimate.
    const spread = Math.max(...list.flatMap((a) => list.map((b) => Math.abs(diff(a.bearing, b.bearing)))));
    const columnSpread = columnAngle(Math.max(...list.map((m) => m.x)), guess) -
      columnAngle(Math.min(...list.map((m) => m.x)), guess);
    if (spread < 5 || columnSpread < 5) {
      const heading = fitHeading(list, guess);
      return { heading, fov: guess, source: "one", residualDeg: rms(list, heading, guess), marks: list.length,
        reason: "insufficient-spread" };
    }
    const fov = fitFov(list),
      heading = fitHeading(list, fov);
    return { heading, fov, source: list.length === 2 ? "two" : "fit", residualDeg: rms(list, heading, fov), marks: list.length };
  }
  // Bearing of column x under a calibration.
  const bearingAt = (cal, x) => wrap(cal.heading + columnAngle(x, cal.fov));
  // 1-σ bearing uncertainty of column x in degrees: tap precision plus the
  // unknowns the calibration did not remove.
  function uncertainty(cal, x) {
    let s = TAP_SIGMA ** 2;
    if (cal.source === "compass") s += COMPASS_SIGMA ** 2;
    if (cal.source === "compass" || cal.source === "one")
      s += (columnAngle(x, cal.fov + FOV_GUESS_SIGMA) - columnAngle(x, cal.fov)) ** 2;
    if (cal.marks > 0) s += Math.max(cal.residualDeg, TAP_SIGMA) ** 2;
    return Math.sqrt(s);
  }
  // rank(cal, x, viewer, candidates) → candidates sorted best first.
  //   candidates: [{point, weight?, maxKm?, ...}]   weight: visibility prior ≥ 0
  // Each result carries bearing, deltaDeg (signed, candidate − tap), distanceKm,
  // sigmaDeg, nonnegative relative score and logScore (not a probability).
  // Candidates beyond maxKm (default 40 km) are
  // kept but down-weighted; the caller decides how many to show.
  function rank(cal, x, viewer, candidates) {
    if (!point(viewer)) throw new Error("Viewer position required.");
    const b = bearingAt(cal, x),
      sigma = uncertainty(cal, x);
    return candidates
      .filter((c) => c && point(c.point))
      .map((c) => {
        const cb = bearing(viewer, c.point),
          d = distance(viewer, c.point),
          delta = diff(cb, b),
          far = d > (num(c.maxKm) ? c.maxKm : 40) ? 0.5 : 1,
          weight = num(c.weight) && c.weight >= 0 ? c.weight : 1,
          logScore = -0.5 * (delta / sigma) ** 2 + Math.log(far) + Math.log(weight);
        return {
          candidate: c,
          bearing: cb,
          deltaDeg: delta,
          distanceKm: d,
          sigmaDeg: sigma,
          score: Math.exp(logScore),
          logScore,
        };
      })
      .sort((p, q) => q.logScore - p.logScore || p.distanceKm - q.distanceKm);
  }
  return {
    TAP_SIGMA,
    COMPASS_SIGMA,
    FOV_MIN,
    FOV_MAX,
    wrap,
    diff,
    distance,
    bearing,
    destination,
    columnAngle,
    angleColumn,
    defaultFov,
    calibrate,
    bearingAt,
    uncertainty,
    rank,
  };
})();
if (typeof module !== "undefined") module.exports = Resection;
