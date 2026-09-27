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
// pitch p (positive = looking down) and roll r. The viewpoint is the reported
// fix plus one SHARED offset (east, north metres) whose prior is the fix
// accuracy: every mark and every candidate bearing sees the same offset, so
// many marks cannot average a single GPS error away, and nearby marks can
// actually tighten the viewpoint (resection). Marks of known position give
// azimuth observations; horizon points give elevation-zero observations; a
// compass gives a heading observation. Everything is fitted together by
// weighted least squares with priors on the unobserved parameters, so the
// covariance says honestly what is and is not known. Uncertainty for a tap
// direction, and for the comparison with a specific candidate, is propagated
// from that covariance.
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
    HORIZON_SIGMA = 0.7, // degrees: tap on a true level horizon
    TILT_SIGMA = 1.5, // degrees: phone gravity sensor at the shutter
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
  // Reported fix shifted by (east, north) metres.
  const shifted = (viewer, east, north) =>
    destination(viewer, deg(Math.atan2(east, north)), Math.hypot(east, north) / 1000);
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
  // Camera axes in world (east, north, up) for pose P = {heading, fov, pitch, roll}.
  // Conventions: pitch > 0 looks down (the horizon moves above the centre);
  // roll > 0 turns the camera's right side down, so the horizon appears
  // HIGHER on the right of the photo. Host-captured tilt must use these signs.
  function basis(P) {
    const H = rad(P.heading),
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
    return { F, R: Rr, D: Dr, t: Math.tan(rad(clampFov(P.fov)) / 2) };
  }
  // World ray (east, north, up) of pixel (x, y) under pose P.
  function ray(P, aspect, x, y) {
    const { F, R, D, t } = basis(P),
      u = (x - 0.5) * 2 * t,
      v = (y - 0.5) * 2 * t * aspect;
    return [F[0] + u * R[0] + v * D[0], F[1] + u * R[1] + v * D[1], F[2] + u * R[2] + v * D[2]];
  }
  // Inverse: pixel {x, y} of the world direction (azimuth, elevation), or null
  // when it lies behind the camera. x/y may fall outside [0, 1] (off-frame).
  function project(P, aspect, azimuth, elevation = 0) {
    const a = rad(azimuth),
      e = rad(elevation),
      w = [Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e)],
      { F, R, D, t } = basis(P),
      dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2],
      f = dot(w, F);
    if (f <= 1e-6) return null;
    return { x: 0.5 + dot(w, R) / f / (2 * t), y: 0.5 + dot(w, D) / f / (2 * t * aspect) };
  }
  const azimuthOf = (P, aspect, x, y) => {
    const w = ray(P, aspect, x, y);
    return wrap(deg(Math.atan2(w[0], w[1])));
  };
  const elevationOf = (P, aspect, x, y) => {
    const w = ray(P, aspect, x, y);
    return deg(Math.atan2(w[2], Math.hypot(w[0], w[1])));
  };
  // Small dense linear algebra for the normal equations.
  function solveLinear(A, b) {
    const n = b.length,
      M = A.map((row, i) => [...row, b[i]]);
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      if (Math.abs(M[piv][c]) < 1e-14) return null;
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
  const KEYS = ["heading", "fov", "pitch", "roll", "east", "north"],
    N = KEYS.length,
    STEP = { heading: 1e-3, fov: 1e-3, pitch: 1e-3, roll: 1e-3, east: 0.5, north: 0.5 };
  // calibrate(input):
  //   viewer:  {lat, lon, accuracyM?}        reported fix; accuracy is the shared-offset prior
  //   marks:   [{x, y, point, positionM?}]    known landmarks tapped in the photo
  //   horizon: [{x, y}]                       optional taps on a true level horizon
  //   heading: compass azimuth (optional)     weak observation; headingRef
  //            "true" (default) or "magnetic" (+ declination, east positive);
  //            headingSigma widens σ (floor 12°)
  //   tilt:    {pitch, roll, sigma?} (optional) gravity-sensor tilt at the shutter,
  //            solver sign conventions (see basis); sigma defaults to 1.5°
  //   fov:     known lens FOV (optional)      tight prior (fovSigma, default 1°)
  //   width, height                           photo size for aspect and default FOV
  // Returns the fitted state, its covariance and honest flags.
  function calibrate(input) {
    const { viewer, marks = [], horizon = [], width, height } = input;
    if (!point(viewer)) throw new Error("Viewer position required.");
    const aspect = aspectOf(width, height),
      accuracyM = num(viewer.accuracyM) && viewer.accuracyM > 0 ? viewer.accuracyM : VIEWER_SIGMA_M;
    const list = marks.map((m) => {
      if (!m || !num(m.x) || !num(m.y) || m.x < 0 || m.x > 1 || m.y < 0 || m.y > 1 || !point(m.point))
        throw new Error("Each mark needs x and y in [0, 1] and a position.");
      const d = distance(viewer, m.point);
      if (d < 0.05) throw new Error("A mark must be at least 50 m from the viewer.");
      // Per-mark noise: tap and the feature's own placement. The viewer error is
      // shared and lives in the (east, north) parameters, not here.
      const featureM = num(m.positionM) && m.positionM > 0 ? m.positionM : FEATURE_SIGMA_M,
        sigma = Math.hypot(TAP_SIGMA, deg(Math.atan(featureM / (d * 1000))));
      return { x: m.x, y: m.y, point: m.point, distanceKm: d, sigma };
    });
    const obs = list.map((m) => ({ kind: "mark", m, sigma: m.sigma }));
    for (const h of horizon) {
      if (!h || !num(h.x) || !num(h.y) || h.x < 0 || h.x > 1 || h.y < 0 || h.y > 1)
        throw new Error("Each horizon point needs x and y in [0, 1].");
      obs.push({ kind: "horizon", h, sigma: HORIZON_SIGMA });
    }
    // Compass: true north by default; a magnetic heading needs the declination
    // (east positive) and is never silently used as true. The sensor's accuracy
    // widens σ but never below COMPASS_SIGMA.
    let compass = null,
      compassSigma = COMPASS_SIGMA;
    if (input.heading != null) {
      const ref = input.headingRef ?? "true";
      if (!num(input.heading) || (ref !== "true" && ref !== "magnetic"))
        throw new Error("Heading needs degrees and headingRef true or magnetic.");
      if (ref === "magnetic" && !num(input.declination))
        throw new Error("Magnetic heading needs a declination.");
      if (input.headingSigma != null && !(num(input.headingSigma) && input.headingSigma > 0))
        throw new Error("Heading sigma must be positive.");
      compass = wrap(input.heading + (ref === "magnetic" ? input.declination : 0));
      if (input.headingSigma != null) compassSigma = Math.max(COMPASS_SIGMA, input.headingSigma);
    }
    if (!list.length && compass === null)
      throw new Error("Without a mark a compass heading is required.");
    if (compass !== null) obs.push({ kind: "compass", value: compass, sigma: compassSigma });
    const tilt = input.tilt;
    if (tilt != null) {
      if (!num(tilt.pitch) || !num(tilt.roll) || Math.abs(tilt.pitch) > 89 || Math.abs(tilt.roll) > 89 ||
          (tilt.sigma != null && !(num(tilt.sigma) && tilt.sigma > 0)))
        throw new Error("Tilt needs pitch and roll within ±89° and a positive sigma.");
      const s = tilt.sigma ?? TILT_SIGMA;
      obs.push({ kind: "pitch", value: tilt.pitch, sigma: s }, { kind: "roll", value: tilt.roll, sigma: s });
    }
    const fovGuess = num(input.fov) ? clampFov(input.fov) : defaultFov(width, height),
      fovSigma = num(input.fov) ? (num(input.fovSigma) && input.fovSigma > 0 ? input.fovSigma : 1) : FOV_PRIOR_SIGMA;
    // Priors keep unobserved parameters near sensible values and, more
    // importantly, feed their ignorance into the covariance.
    const prior = {
      fov: { mu: fovGuess, sigma: fovSigma },
      pitch: { mu: 0, sigma: PITCH_PRIOR_SIGMA },
      roll: { mu: 0, sigma: ROLL_PRIOR_SIGMA },
      east: { mu: 0, sigma: accuracyM },
      north: { mu: 0, sigma: accuracyM },
    };
    const PRIOR_KEYS = Object.keys(prior);
    // Start: level camera at the reported fix, heading from the marks or compass.
    let P = { heading: 0, fov: fovGuess, pitch: 0, roll: 0, east: 0, north: 0 };
    if (list.length) {
      let sx = 0,
        sy = 0;
      for (const m of list) {
        const a = rad(bearing(viewer, m.point) - columnAngle(m.x, fovGuess));
        sx += Math.cos(a);
        sy += Math.sin(a);
      }
      P.heading = wrap(deg(Math.atan2(sy, sx)));
    } else P.heading = compass;
    if (tilt != null) {
      P.pitch = tilt.pitch;
      P.roll = tilt.roll;
    } else if (horizon.length) {
      // Horizon above centre means looking down: v_h = −tan(pitch).
      const v = horizon.reduce((s, h) => s + (h.y - 0.5) * 2 * Math.tan(rad(fovGuess) / 2) * aspect, 0) / horizon.length;
      P.pitch = deg(Math.atan(-v));
    }
    const residuals = (Q) => {
      const r = [],
        at = shifted(viewer, Q.east, Q.north);
      for (const o of obs) {
        if (o.kind === "mark") r.push(diff(azimuthOf(Q, aspect, o.m.x, o.m.y), bearing(at, o.m.point)) / o.sigma);
        else if (o.kind === "horizon") r.push(elevationOf(Q, aspect, o.h.x, o.h.y) / o.sigma);
        else if (o.kind === "pitch") r.push((Q.pitch - o.value) / o.sigma);
        else if (o.kind === "roll") r.push((Q.roll - o.value) / o.sigma);
        else r.push(diff(Q.heading, o.value) / o.sigma);
      }
      for (const k of PRIOR_KEYS) r.push((Q[k] - prior[k].mu) / prior[k].sigma);
      return r;
    };
    const jacobian = (Q) => {
      const base = residuals(Q),
        J = base.map(() => Array(N).fill(0));
      for (let j = 0; j < N; j++) {
        const k = KEYS[j],
          rp = residuals({ ...Q, [k]: Q[k] + STEP[k] }),
          rm = residuals({ ...Q, [k]: Q[k] - STEP[k] });
        for (let i = 0; i < base.length; i++) J[i][j] = (rp[i] - rm[i]) / (2 * STEP[k]);
      }
      return { base, J };
    };
    const sumsq = (r) => r.reduce((s, v) => s + v * v, 0);
    const normal = (base, J) => {
      const A = Array.from({ length: N }, () => Array(N).fill(0)),
        g = Array(N).fill(0);
      for (let i = 0; i < base.length; i++)
        for (let a = 0; a < N; a++) {
          g[a] += J[i][a] * base[i];
          for (let b = 0; b < N; b++) A[a][b] += J[i][a] * J[i][b];
        }
      return { A, g };
    };
    const bound = accuracyM * 6;
    // Levenberg–Marquardt, six parameters, numeric Jacobian.
    let lambda = 1e-2,
      cost = sumsq(residuals(P));
    for (let iter = 0; iter < 80; iter++) {
      const { base, J } = jacobian(P),
        { A, g } = normal(base, J);
      let improved = false;
      for (let tries = 0; tries < 10 && !improved; tries++) {
        const M = A.map((row, i) => row.map((v, j) => (i === j ? v * (1 + lambda) + 1e-12 : v))),
          delta = solveLinear(M, g.map((v) => -v));
        if (!delta) break;
        const Q = {
          heading: wrap(P.heading + delta[0]),
          fov: clampFov(P.fov + delta[1]),
          pitch: Math.max(-89, Math.min(89, P.pitch + delta[2])),
          roll: Math.max(-89, Math.min(89, P.roll + delta[3])),
          east: Math.max(-bound, Math.min(bound, P.east + delta[4])),
          north: Math.max(-bound, Math.min(bound, P.north + delta[5])),
        };
        const c = sumsq(residuals(Q));
        if (c < cost) {
          const done = cost - c < 1e-10;
          P = Q;
          cost = c;
          lambda = Math.max(1e-7, lambda / 3);
          improved = true;
          if (done) iter = 80;
        } else lambda *= 4;
      }
      if (!improved) break;
    }
    // Covariance from the final Jacobian; inflate when observations disagree
    // beyond their stated precision (dof > 0 only).
    const { base, J } = jacobian(P),
      { A } = normal(base, J);
    let cov = invert(A);
    if (!cov) throw new Error("Calibration is singular.");
    const at = shifted(viewer, P.east, P.north),
      markRes = list.map((m) => diff(azimuthOf(P, aspect, m.x, m.y), bearing(at, m.point))),
      dof = obs.length + PRIOR_KEYS.length - N,
      chi2 = sumsq(base),
      inflate = dof > 0 ? Math.max(1, chi2 / dof) : 1;
    cov = cov.map((row) => row.map((v) => v * inflate));
    const sigma = Object.fromEntries(KEYS.map((k, i) => [k, Math.sqrt(Math.max(0, cov[i][i]))]));
    return {
      heading: P.heading,
      fov: P.fov,
      pitch: P.pitch,
      roll: P.roll,
      east: P.east,
      north: P.north,
      viewer: { lat: at.lat, lon: at.lon, reported: { lat: viewer.lat, lon: viewer.lon }, accuracyM },
      aspect,
      cov,
      sigma,
      source: list.length ? "marks" : "compass",
      marks: list.length,
      horizonPoints: horizon.length,
      tilt: tilt != null ? "measured" : "none",
      // "assumed" means the data left the parameter near its prior width.
      lens: sigma.fov < 0.7 * FOV_PRIOR_SIGMA ? "fitted" : "assumed",
      level: sigma.pitch < 0.7 * PITCH_PRIOR_SIGMA && sigma.roll < 0.7 * ROLL_PRIOR_SIGMA ? "fitted" : "assumed",
      viewpoint: Math.hypot(sigma.east, sigma.north) < 0.7 * Math.SQRT2 * accuracyM ? "refined" : "reported",
      residualDeg: list.length ? Math.sqrt(markRes.reduce((s, v) => s + v * v, 0) / list.length) : 0,
      chi2,
    };
  }
  const pose = (cal) => ({ heading: cal.heading, fov: cal.fov, pitch: cal.pitch, roll: cal.roll });
  // Bearing and elevation of pixel (x, y) under a calibration. y defaults to
  // the image centre row for callers that only have a column.
  const bearingAt = (cal, x, y = 0.5) => azimuthOf(pose(cal), cal.aspect, x, y);
  const elevationAt = (cal, x, y = 0.5) => elevationOf(pose(cal), cal.aspect, x, y);
  // Gradient of an angle with respect to the fitted state (numeric).
  function gradient(cal, fn) {
    const S = { ...pose(cal), east: cal.east, north: cal.north };
    return KEYS.map((k) => {
      const plus = fn({ ...S, [k]: S[k] + STEP[k] }),
        minus = fn({ ...S, [k]: S[k] - STEP[k] });
      return diff(plus, minus) / (2 * STEP[k]);
    });
  }
  const viewerOf = (cal, s) => shifted(cal.viewer.reported, s.east, s.north);
  // 1-σ uncertainty in degrees.
  //   uncertainty(cal, x, y)          the tap DIRECTION (wedge on the map): pose covariance + tap.
  //   uncertainty(cal, x, y, target)  the COMPARISON with a candidate at `target`: the same,
  //                                   plus how the shared viewpoint error moves the candidate's
  //                                   bearing (correlated through the fit) and the candidate's
  //                                   own placement over its distance.
  function uncertainty(cal, x, y = 0.5, target = null) {
    const g = gradient(cal, (s) => {
      const az = azimuthOf(s, cal.aspect, x, y);
      return target ? az - bearing(viewerOf(cal, s), target.point) : az;
    });
    let s = TAP_SIGMA ** 2;
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) s += g[a] * cal.cov[a][b] * g[b];
    if (target) {
      const d = distance(cal.viewer, target.point),
        featureM = num(target.positionM) && target.positionM > 0 ? target.positionM : FEATURE_SIGMA_M;
      s += deg(Math.atan(featureM / Math.max(1, d * 1000))) ** 2;
    }
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
  // Pixel of a world direction under a calibration (null if behind the camera).
  const pixelAt = (cal, azimuth, elevation = 0) => project(pose(cal), cal.aspect, azimuth, elevation);
  // Pixels sharing one azimuth, found analytically: all directions with azimuth
  // A form the vertical half-plane spanned by h = (sin A, cos A, 0) and up. Its
  // image is the line n·(F + uR + vD) = 0 with n = h × up, clipped to the frame
  // and to the half where h·d > 0 (A, not A + 180°). Works at any pitch/roll.
  // Returns up to `steps + 1` points ordered top to bottom, or [] if not visible.
  function bearingLine(cal, azimuth, steps = 24) {
    const { F, R, D, t } = basis(pose(cal)),
      U = t,
      V = t * cal.aspect,
      A = rad(azimuth),
      h = [Math.sin(A), Math.cos(A), 0],
      n = [Math.cos(A), -Math.sin(A), 0],
      dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2],
      al = dot(n, F), be = dot(n, R), ga = dot(n, D),
      g = (q) => dot(h, F) + q.u * dot(h, R) + q.v * dot(h, D),
      eps = 1e-12;
    const hits = [];
    if (Math.abs(ga) > eps)
      for (const u of [-U, U]) {
        const v = -(al + be * u) / ga;
        if (Math.abs(v) <= V * (1 + 1e-9)) hits.push({ u, v });
      }
    if (Math.abs(be) > eps)
      for (const v of [-V, V]) {
        const u = -(al + ga * v) / be;
        if (Math.abs(u) <= U * (1 + 1e-9)) hits.push({ u, v });
      }
    let p0 = null, p1 = null, best = -1;
    for (let i = 0; i < hits.length; i++)
      for (let j = i + 1; j < hits.length; j++) {
        const dd = Math.hypot(hits[i].u - hits[j].u, hits[i].v - hits[j].v);
        if (dd > best) { best = dd; p0 = hits[i]; p1 = hits[j]; }
      }
    if (!p0 || best < 1e-9 * U) return [];
    // Keep the half-plane h·d > 0; stop just short of the zenith/nadir crossing.
    let g0 = g(p0), g1 = g(p1);
    const floor = 1e-6 * (Math.abs(g0) + Math.abs(g1) + 1e-12);
    if (g0 <= floor && g1 <= floor) return [];
    const cut = (a, b, ga_, gb) => { const k = (floor - ga_) / (gb - ga_); return { u: a.u + k * (b.u - a.u), v: a.v + k * (b.v - a.v) }; };
    if (g0 < floor) p0 = cut(p0, p1, g0, g1);
    else if (g1 < floor) p1 = cut(p1, p0, g1, g0);
    const out = [];
    for (let k = 0; k <= steps; k++) {
      const u = p0.u + ((p1.u - p0.u) * k) / steps,
        v = p0.v + ((p1.v - p0.v) * k) / steps;
      out.push({ x: Math.min(1, Math.max(0, 0.5 + u / (2 * U))), y: Math.min(1, Math.max(0, 0.5 + v / (2 * V))) });
    }
    return out[0].y <= out[out.length - 1].y ? out : out.reverse();
  }
  // locate(cal, target) → where a map point lies in the photo.
  //   target: {point, positionM?}
  // Returns {bearing, distanceKm, sigmaDeg, inFrame, side, anchor, line, band}.
  // Visibility is the bearing line's actual intersection with the frame. The
  // anchor is where that line crosses the horizon when the crossing is in frame,
  // otherwise the line point nearest the horizon; σ is the comparison
  // uncertainty there and `band` holds the lines at bearing ± 2σ. Out of frame,
  // `side` is "left"/"right"/"above"/"below" or "behind-left"/"behind-right",
  // judged at the elevation of the image centre, and the anchor is the matching
  // frame edge.
  function locate(cal, target) {
    if (!target || !point(target.point)) throw new Error("Target position required.");
    const b = bearing(cal.viewer, target.point),
      d = distance(cal.viewer, target.point),
      line = bearingLine(cal, b),
      inside = (q) => q && q.x >= 0 && q.x <= 1 && q.y >= 0 && q.y <= 1;
    if (line.length) {
      const h = pixelAt(cal, b, 0),
        anchor = inside(h) ? h : line.reduce((a, q) => (Math.abs(elevationAt(cal, q.x, q.y)) < Math.abs(elevationAt(cal, a.x, a.y)) ? q : a)),
        sigma = uncertainty(cal, anchor.x, anchor.y, target);
      return { bearing: b, distanceKm: d, sigmaDeg: sigma, inFrame: true, side: null, anchor: { x: anchor.x, y: anchor.y }, line,
        band: [bearingLine(cal, b - 2 * sigma), bearingLine(cal, b + 2 * sigma)] };
    }
    const q = pixelAt(cal, b, elevationAt(cal, 0.5, 0.5));
    let side, anchor;
    if (!q) {
      const lr = diff(b, bearingAt(cal, 0.5, 0.5)) < 0 ? "left" : "right";
      side = "behind-" + lr;
      anchor = { x: lr === "left" ? 0 : 1, y: 0.5 };
    } else if (q.x < 0 || q.x > 1) {
      side = q.x < 0 ? "left" : "right";
      anchor = { x: q.x < 0 ? 0 : 1, y: Math.min(1, Math.max(0, q.y)) };
    } else {
      side = q.y < 0 ? "above" : "below";
      anchor = { x: q.x, y: q.y < 0 ? 0 : 1 };
    }
    return { bearing: b, distanceKm: d, sigmaDeg: uncertainty(cal, anchor.x, anchor.y, target), inFrame: false, side, anchor, line: [], band: [[], []] };
  }
  // rank(cal, x, y, candidates) → candidates sorted best first.
  //   candidates: [{point, weight?, maxKm?, positionM?, ...}]   weight: visibility prior ≥ 0
  // Bearings are taken from the fitted viewpoint. Each result carries the
  // candidate's bearing, deltaDeg (signed, candidate − tap), distanceKm, its
  // own sigmaDeg (comparison uncertainty), wedgeSigmaDeg (direction only), a
  // `close` flag (|delta| ≤ 2σ), a nonnegative relative score and logScore
  // (not a probability). Candidates beyond maxKm (default 40 km) are kept but
  // down-weighted; the caller decides how many to show and says "no close
  // match" when nothing is close.
  function rank(cal, x, y, candidates) {
    const b = bearingAt(cal, x, y),
      wedge = uncertainty(cal, x, y);
    return candidates
      .filter((c) => c && point(c.point))
      .map((c) => {
        const cb = bearing(cal.viewer, c.point),
          d = distance(cal.viewer, c.point),
          delta = diff(cb, b),
          sigma = uncertainty(cal, x, y, c),
          far = d > (num(c.maxKm) ? c.maxKm : 40) ? 0.5 : 1,
          weight = num(c.weight) && c.weight >= 0 ? c.weight : 1,
          logScore = -0.5 * (delta / sigma) ** 2 + Math.log(far) + Math.log(weight);
        return { candidate: c, bearing: cb, deltaDeg: delta, distanceKm: d, sigmaDeg: sigma, wedgeSigmaDeg: wedge, close: Math.abs(delta) <= 2 * sigma, score: Math.exp(logScore), logScore };
      })
      .sort((p, q) => q.logScore - p.logScore || p.distanceKm - q.distanceKm);
  }
  return {
    TAP_SIGMA,
    COMPASS_SIGMA,
    FOV_PRIOR_SIGMA,
    PITCH_PRIOR_SIGMA,
    ROLL_PRIOR_SIGMA,
    FEATURE_SIGMA_M,
    FOV_MIN,
    FOV_MAX,
    wrap,
    diff,
    distance,
    bearing,
    destination,
    shifted,
    columnAngle,
    angleColumn,
    defaultFov,
    TILT_SIGMA,
    azimuthOf,
    elevationOf,
    project,
    calibrate,
    bearingAt,
    elevationAt,
    pixelAt,
    bearingLine,
    locate,
    uncertainty,
    horizonRow,
    rank,
  };
})();
if (typeof module !== "undefined") module.exports = Resection;
