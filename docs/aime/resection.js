"use strict";
// Aimé reference solver: photo pixel ↔ compass bearing from a known viewpoint.
// Pure functions, no DOM, no host calls. Global `Resection` in the module,
// CommonJS under Node for scripts/test_aime_resection.cjs.
//
// Camera model (pinhole, full pose). Normalised pixel (x, y): x across from the
// left, y down from the top, both in [0, 1]. With horizontal field of view f
// and aspect a = height / width the camera-frame ray is
//   u = (x − ½)·2·tan(f/2),   v = (y − ½)·2·tan(f/2)·a,   d = (u right, v down, 1 forward)
// The pose is heading H (azimuth of the optical axis, clockwise from north),
// pitch p (positive = looking down) and roll r. Marks of known position give
// azimuth observations; horizon points give elevation-zero observations; a
// compass gives a heading observation. Everything is fitted together by
// weighted least squares with priors on the unobserved parameters, so the
// covariance says honestly what is and is not known. Bearing uncertainty at
// any pixel is propagated from that covariance.
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
    COMPASS_SIGMA = 12, // degrees: phone magnetometer after calibration
    FOV_PRIOR_SIGMA = 8, // degrees: main lens unknown, 70° assumed
    PITCH_PRIOR_SIGMA = 15, // degrees: hand-held viewpoint photos tilt this much
    ROLL_PRIOR_SIGMA = 5, // degrees: people hold phones roughly level
    HORIZON_SIGMA = 0.7, // degrees: tap on the horizon line
    VIEWER_SIGMA_M = 20, // metres, when the fix has no accuracy
    FEATURE_SIGMA_M = 8; // metres: OSM node placement
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
  // Level-camera column angle; kept for rulers and for the 1D checks.
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
  const aspectOf = (width, height) =>
    num(width) && num(height) && width > 0 && height > 0 ? height / width : 0.75;
  // World ray (east, north, up) of pixel (x, y) under pose P = {heading, fov, pitch, roll}.
  function ray(P, aspect, x, y) {
    const t = Math.tan(rad(clampFov(P.fov)) / 2),
      u = (x - 0.5) * 2 * t,
      v = (y - 0.5) * 2 * t * aspect,
      H = rad(P.heading),
      p = rad(P.pitch),
      r = rad(P.roll),
      sH = Math.sin(H),
      cH = Math.cos(H),
      sp = Math.sin(p),
      cp = Math.cos(p),
      sr = Math.sin(r),
      cr = Math.cos(r);
    // Level frame: forward F0, right R0, down D0; then pitch about R0, roll about F.
    const F = [sH * cp, cH * cp, -sp],
      Rt = [cH, -sH, 0],
      Dn = [-sH * sp, -cH * sp, -cp],
      Rr = [Rt[0] * cr + Dn[0] * sr, Rt[1] * cr + Dn[1] * sr, Rt[2] * cr + Dn[2] * sr],
      Dr = [Dn[0] * cr - Rt[0] * sr, Dn[1] * cr - Rt[1] * sr, Dn[2] * cr - Rt[2] * sr];
    return [F[0] + u * Rr[0] + v * Dr[0], F[1] + u * Rr[1] + v * Dr[1], F[2] + u * Rr[2] + v * Dr[2]];
  }
  const azimuthOf = (P, aspect, x, y) => {
    const w = ray(P, aspect, x, y);
    return wrap(deg(Math.atan2(w[0], w[1])));
  };
  const elevationOf = (P, aspect, x, y) => {
    const w = ray(P, aspect, x, y);
    return deg(Math.atan2(w[2], Math.hypot(w[0], w[1])));
  };
  // Small dense linear algebra for the 4×4 normal equations.
  function solveLinear(A, b) {
    const n = b.length,
      M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-12) return null;
      [M[c], M[piv]] = [M[piv], M[c]];
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const k = M[r][c] / M[c][c];
        for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
      }
    }
    return M.map((row, i) => row[n] / row[i]);
  }
  function invert(A) {
    const n = A.length,
      cols = [];
    for (let j = 0; j < n; j++) {
      const e = Array(n).fill(0);
      e[j] = 1;
      const col = solveLinear(A, e);
      if (!col) return null;
      cols.push(col);
    }
    return A.map((_, i) => cols.map((c) => c[i]));
  }
  const KEYS = ["heading", "fov", "pitch", "roll"];
  // calibrate(input):
  //   viewer:  {lat, lon, accuracyM?}        estimated viewpoint
  //   marks:   [{x, y, point, positionM?}]    known landmarks tapped in the photo
  //   horizon: [{x, y}]                       optional taps on the horizon line
  //   heading: compass azimuth (optional)     used as a weak observation
  //   fov:     known lens FOV (optional)      used as a tight prior
  //   width, height                           photo size for aspect and default FOV
  // Returns a calibration with the fitted pose, its covariance and honest flags.
  function calibrate(input) {
    const { viewer, marks = [], horizon = [], width, height } = input;
    if (!point(viewer)) throw new Error("Viewer position required.");
    const aspect = aspectOf(width, height),
      viewerSigma = num(viewer.accuracyM) && viewer.accuracyM > 0 ? viewer.accuracyM : VIEWER_SIGMA_M;
    const obs = [];
    const list = marks.map((m) => {
      if (!m || !num(m.x) || !num(m.y) || m.x < 0 || m.x > 1 || m.y < 0 || m.y > 1 || !point(m.point))
        throw new Error("Each mark needs x and y in [0, 1] and a position.");
      const d = distance(viewer, m.point);
      if (d < 0.05) throw new Error("A mark must be at least 50 m from the viewer.");
      const posM = Math.hypot(viewerSigma, num(m.positionM) ? m.positionM : FEATURE_SIGMA_M),
        sigma = Math.hypot(TAP_SIGMA, deg(Math.atan(posM / (d * 1000))));
      return { x: m.x, y: m.y, bearing: bearing(viewer, m.point), distanceKm: d, sigma };
    });
    for (const m of list) obs.push({ kind: "mark", m, sigma: m.sigma });
    for (const h of horizon) {
      if (!h || !num(h.x) || !num(h.y) || h.x < 0 || h.x > 1 || h.y < 0 || h.y > 1)
        throw new Error("Each horizon point needs x and y in [0, 1].");
      obs.push({ kind: "horizon", h, sigma: HORIZON_SIGMA });
    }
    const compass = num(input.heading) ? wrap(input.heading) : null;
    if (!list.length && compass === null)
      throw new Error("Without a mark a compass heading is required.");
    if (compass !== null) obs.push({ kind: "compass", value: compass, sigma: COMPASS_SIGMA });
    const fovGuess = num(input.fov) ? clampFov(input.fov) : defaultFov(width, height);
    // Priors keep unobserved parameters near sensible values and, more
    // importantly, feed their ignorance into the covariance.
    const prior = {
      fov: { mu: fovGuess, sigma: num(input.fov) ? 1 : FOV_PRIOR_SIGMA },
      pitch: { mu: 0, sigma: PITCH_PRIOR_SIGMA },
      roll: { mu: 0, sigma: ROLL_PRIOR_SIGMA },
    };
    // Start: level camera, heading from the marks (circular mean) or compass.
    let P = { heading: 0, fov: fovGuess, pitch: 0, roll: 0 };
    if (list.length) {
      let sx = 0,
        sy = 0;
      for (const m of list) {
        const a = rad(m.bearing - columnAngle(m.x, fovGuess));
        sx += Math.cos(a);
        sy += Math.sin(a);
      }
      P.heading = wrap(deg(Math.atan2(sy, sx)));
    } else P.heading = compass;
    if (horizon.length) {
      // Horizon above centre means looking down: v_h = −tan(pitch).
      const v = horizon.reduce((s, h) => s + (h.y - 0.5) * 2 * Math.tan(rad(fovGuess) / 2) * aspect, 0) / horizon.length;
      P.pitch = deg(Math.atan(-v));
    }
    const residuals = (Q) => {
      const r = [];
      for (const o of obs) {
        if (o.kind === "mark") r.push(diff(azimuthOf(Q, aspect, o.m.x, o.m.y), o.m.bearing) / o.sigma);
        else if (o.kind === "horizon") r.push(elevationOf(Q, aspect, o.h.x, o.h.y) / o.sigma);
        else r.push(diff(Q.heading, o.value) / o.sigma);
      }
      for (const k of ["fov", "pitch", "roll"]) r.push((Q[k] - prior[k].mu) / prior[k].sigma);
      return r;
    };
    const jacobian = (Q) => {
      const base = residuals(Q),
        J = base.map(() => Array(4).fill(0)),
        step = { heading: 1e-3, fov: 1e-3, pitch: 1e-3, roll: 1e-3 };
      for (let j = 0; j < 4; j++) {
        const k = KEYS[j],
          plus = { ...Q, [k]: Q[k] + step[k] },
          minus = { ...Q, [k]: Q[k] - step[k] },
          rp = residuals(plus),
          rm = residuals(minus);
        for (let i = 0; i < base.length; i++) J[i][j] = (rp[i] - rm[i]) / (2 * step[k]);
      }
      return { base, J };
    };
    const sumsq = (r) => r.reduce((s, v) => s + v * v, 0);
    // Levenberg–Marquardt, 4 parameters, numeric Jacobian.
    let lambda = 1e-2,
      cost = sumsq(residuals(P));
    for (let iter = 0; iter < 60; iter++) {
      const { base, J } = jacobian(P),
        A = Array.from({ length: 4 }, () => Array(4).fill(0)),
        g = Array(4).fill(0);
      for (let i = 0; i < base.length; i++)
        for (let a = 0; a < 4; a++) {
          g[a] += J[i][a] * base[i];
          for (let b = 0; b < 4; b++) A[a][b] += J[i][a] * J[i][b];
        }
      let improved = false;
      for (let tries = 0; tries < 8 && !improved; tries++) {
        const M = A.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) + 1e-9 : v))),
          delta = solveLinear(M, g.map((v) => -v));
        if (!delta) break;
        const Q = {
          heading: wrap(P.heading + delta[0]),
          fov: clampFov(P.fov + delta[1]),
          pitch: Math.max(-89, Math.min(89, P.pitch + delta[2])),
          roll: Math.max(-89, Math.min(89, P.roll + delta[3])),
        };
        const c = sumsq(residuals(Q));
        if (c < cost) {
          const done = cost - c < 1e-10;
          P = Q;
          cost = c;
          lambda = Math.max(1e-6, lambda / 3);
          improved = true;
          if (done) iter = 60;
        } else lambda *= 4;
      }
      if (!improved) break;
    }
    // Covariance from the final Jacobian; inflate when marks disagree beyond
    // their stated precision (dof > 0 only).
    const { base, J } = jacobian(P),
      A = Array.from({ length: 4 }, () => Array(4).fill(0));
    for (let i = 0; i < base.length; i++)
      for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) A[a][b] += J[i][a] * J[i][b];
    let cov = invert(A);
    if (!cov) throw new Error("Calibration is singular.");
    const markRes = list.map((m) => diff(azimuthOf(P, aspect, m.x, m.y), m.bearing)),
      dof = obs.length - 4 + 3, // priors count as observations
      chi2 = sumsq(base),
      inflate = dof > 0 ? Math.max(1, chi2 / dof) : 1;
    cov = cov.map((row) => row.map((v) => v * inflate));
    const sigma = Object.fromEntries(KEYS.map((k, i) => [k, Math.sqrt(Math.max(0, cov[i][i]))]));
    return {
      heading: P.heading,
      fov: P.fov,
      pitch: P.pitch,
      roll: P.roll,
      aspect,
      cov,
      sigma,
      source: list.length ? "marks" : "compass",
      marks: list.length,
      horizonPoints: horizon.length,
      // "assumed" means the data left the parameter near its prior width.
      lens: sigma.fov < 0.7 * FOV_PRIOR_SIGMA ? "fitted" : "assumed",
      level: sigma.pitch < 0.7 * PITCH_PRIOR_SIGMA && sigma.roll < 0.7 * ROLL_PRIOR_SIGMA ? "fitted" : "assumed",
      residualDeg: list.length ? Math.sqrt(markRes.reduce((s, v) => s + v * v, 0) / list.length) : 0,
      chi2,
    };
  }
  const pose = (cal) => ({ heading: cal.heading, fov: cal.fov, pitch: cal.pitch, roll: cal.roll });
  // Bearing and elevation of pixel (x, y) under a calibration. y defaults to
  // the image centre row for callers that only have a column.
  const bearingAt = (cal, x, y = 0.5) => azimuthOf(pose(cal), cal.aspect, x, y);
  const elevationAt = (cal, x, y = 0.5) => elevationOf(pose(cal), cal.aspect, x, y);
  // 1-σ bearing uncertainty of pixel (x, y): propagated pose covariance plus
  // tap precision. Grows away from the marks, with pitch/roll ignorance for
  // rows far from the marks' rows, and with lens ignorance towards the edges.
  function uncertainty(cal, x, y = 0.5) {
    const P = pose(cal),
      g = KEYS.map((k) => {
        const step = 1e-3,
          plus = azimuthOf({ ...P, [k]: P[k] + step }, cal.aspect, x, y),
          minus = azimuthOf({ ...P, [k]: P[k] - step }, cal.aspect, x, y);
        return diff(plus, minus) / (2 * step);
      });
    let s = TAP_SIGMA ** 2;
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) s += g[a] * cal.cov[a][b] * g[b];
    return Math.sqrt(Math.max(0, s));
  }
  // Row of the horizon at column x, for drawing the level line (may be off-image).
  function horizonRow(cal, x) {
    let lo = -2,
      hi = 3;
    for (let i = 0; i < 50; i++) {
      const mid = (lo + hi) / 2;
      if (elevationAt(cal, x, mid) > 0) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  }
  // rank(cal, x, y, viewer, candidates) → candidates sorted best first.
  //   candidates: [{point, weight?, maxKm?, ...}]   weight: visibility prior ≥ 0
  // Each result carries bearing, deltaDeg (signed, candidate − tap), distanceKm,
  // sigmaDeg, a nonnegative relative score and logScore (not a probability).
  // Candidates beyond maxKm (default 40 km) are kept but down-weighted; the
  // caller decides how many to show and when to say "no close matches".
  function rank(cal, x, y, viewer, candidates) {
    if (!point(viewer)) throw new Error("Viewer position required.");
    const b = bearingAt(cal, x, y),
      sigma = uncertainty(cal, x, y);
    return candidates
      .filter((c) => c && point(c.point))
      .map((c) => {
        const cb = bearing(viewer, c.point),
          d = distance(viewer, c.point),
          delta = diff(cb, b),
          far = d > (num(c.maxKm) ? c.maxKm : 40) ? 0.5 : 1,
          weight = num(c.weight) && c.weight >= 0 ? c.weight : 1,
          logScore = -0.5 * (delta / sigma) ** 2 + Math.log(far) + Math.log(weight);
        return { candidate: c, bearing: cb, deltaDeg: delta, distanceKm: d, sigmaDeg: sigma, score: Math.exp(logScore), logScore };
      })
      .sort((p, q) => q.logScore - p.logScore || p.distanceKm - q.distanceKm);
  }
  return {
    TAP_SIGMA,
    COMPASS_SIGMA,
    FOV_PRIOR_SIGMA,
    PITCH_PRIOR_SIGMA,
    ROLL_PRIOR_SIGMA,
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
    azimuthOf,
    elevationOf,
    calibrate,
    bearingAt,
    elevationAt,
    uncertainty,
    horizonRow,
    rank,
  };
})();
if (typeof module !== "undefined") module.exports = Resection;
