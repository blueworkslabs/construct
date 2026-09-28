"use strict";
// Magnetic declination from the World Magnetic Model WMM2025 (NOAA NCEI and the
// British Geological Survey; US government work, public domain), valid 2025.0–2030.0.
// Coefficients are WMM.COF from WMM2025COF.zip (sha256 of WMM.COF in docs/space-watch.md).
// Compass headings from orientation.read are magnetic; true = magnetic + declination.
const SpaceMagnetic = (() => {
  const EPOCH = 2025.0, N = 12, A = 6378.137, F = 1 / 298.257223563, RE = 6371.2;
  // [n, m, g, h, gDot, hDot] in nT and nT/year.
  const COEFFICIENTS = [
    [1,0,-29351.8,0,12,0],
    [1,1,-1410.8,4545.4,9.7,-21.5],
    [2,0,-2556.6,0,-11.6,0],
    [2,1,2951.1,-3133.6,-5.2,-27.7],
    [2,2,1649.3,-815.1,-8,-12.1],
    [3,0,1361,0,-1.3,0],
    [3,1,-2404.1,-56.6,-4.2,4],
    [3,2,1243.8,237.5,0.4,-0.3],
    [3,3,453.6,-549.5,-15.6,-4.1],
    [4,0,895,0,-1.6,0],
    [4,1,799.5,278.6,-2.4,-1.1],
    [4,2,55.7,-133.9,-6,4.1],
    [4,3,-281.1,212,5.6,1.6],
    [4,4,12.1,-375.6,-7,-4.4],
    [5,0,-233.2,0,0.6,0],
    [5,1,368.9,45.4,1.4,-0.5],
    [5,2,187.2,220.2,0,2.2],
    [5,3,-138.7,-122.9,0.6,0.4],
    [5,4,-142,43,2.2,1.7],
    [5,5,20.9,106.1,0.9,1.9],
    [6,0,64.4,0,-0.2,0],
    [6,1,63.8,-18.4,-0.4,0.3],
    [6,2,76.9,16.8,0.9,-1.6],
    [6,3,-115.7,48.8,1.2,-0.4],
    [6,4,-40.9,-59.8,-0.9,0.9],
    [6,5,14.9,10.9,0.3,0.7],
    [6,6,-60.7,72.7,0.9,0.9],
    [7,0,79.5,0,-0,0],
    [7,1,-77,-48.9,-0.1,0.6],
    [7,2,-8.8,-14.4,-0.1,0.5],
    [7,3,59.3,-1,0.5,-0.8],
    [7,4,15.8,23.4,-0.1,0],
    [7,5,2.5,-7.4,-0.8,-1],
    [7,6,-11.1,-25.1,-0.8,0.6],
    [7,7,14.2,-2.3,0.8,-0.2],
    [8,0,23.2,0,-0.1,0],
    [8,1,10.8,7.1,0.2,-0.2],
    [8,2,-17.5,-12.6,0,0.5],
    [8,3,2,11.4,0.5,-0.4],
    [8,4,-21.7,-9.7,-0.1,0.4],
    [8,5,16.9,12.7,0.3,-0.5],
    [8,6,15,0.7,0.2,-0.6],
    [8,7,-16.8,-5.2,-0,0.3],
    [8,8,0.9,3.9,0.2,0.2],
    [9,0,4.6,0,-0,0],
    [9,1,7.8,-24.8,-0.1,-0.3],
    [9,2,3,12.2,0.1,0.3],
    [9,3,-0.2,8.3,0.3,-0.3],
    [9,4,-2.5,-3.3,-0.3,0.3],
    [9,5,-13.1,-5.2,0,0.2],
    [9,6,2.4,7.2,0.3,-0.1],
    [9,7,8.6,-0.6,-0.1,-0.2],
    [9,8,-8.7,0.8,0.1,0.4],
    [9,9,-12.9,10,-0.1,0.1],
    [10,0,-1.3,0,0.1,0],
    [10,1,-6.4,3.3,0,0],
    [10,2,0.2,0,0.1,-0],
    [10,3,2,2.4,0.1,-0.2],
    [10,4,-1,5.3,-0,0.1],
    [10,5,-0.6,-9.1,-0.3,-0.1],
    [10,6,-0.9,0.4,0,0.1],
    [10,7,1.5,-4.2,-0.1,0],
    [10,8,0.9,-3.8,-0.1,-0.1],
    [10,9,-2.7,0.9,-0,0.2],
    [10,10,-3.9,-9.1,-0,-0],
    [11,0,2.9,0,0,0],
    [11,1,-1.5,0,-0,-0],
    [11,2,-2.5,2.9,0,0.1],
    [11,3,2.4,-0.6,0,-0],
    [11,4,-0.6,0.2,0,0.1],
    [11,5,-0.1,0.5,-0.1,-0],
    [11,6,-0.6,-0.3,0,-0],
    [11,7,-0.1,-1.2,-0,0.1],
    [11,8,1.1,-1.7,-0.1,-0],
    [11,9,-1,-2.9,-0.1,0],
    [11,10,-0.2,-1.8,-0.1,0],
    [11,11,2.6,-2.3,-0.1,0],
    [12,0,-2,0,0,0],
    [12,1,-0.2,-1.3,0,-0],
    [12,2,0.3,0.7,-0,0],
    [12,3,1.2,1,-0,-0.1],
    [12,4,-1.3,-1.4,-0,0.1],
    [12,5,0.6,-0,-0,-0],
    [12,6,0.6,0.6,0.1,-0],
    [12,7,0.5,-0.1,-0,-0],
    [12,8,-0.1,0.8,0,0],
    [12,9,-0.4,0.1,0,-0],
    [12,10,-0.2,-1,-0.1,-0],
    [12,11,-1.3,0.1,-0,0],
    [12,12,-0.7,0.2,-0.1,-0.1],
  ];
  const g = [], h = [], gd = [], hd = [];
  for (let n = 0; n <= N; n++) {
    g.push(new Array(N + 1).fill(0)); h.push(new Array(N + 1).fill(0));
    gd.push(new Array(N + 1).fill(0)); hd.push(new Array(N + 1).fill(0));
  }
  for (const [n, m, a, b, c, d] of COEFFICIENTS) { g[n][m] = a; h[n][m] = b; gd[n][m] = c; hd[n][m] = d; }
  const decimalYear = (ms) => {
    const d = new Date(ms), y = d.getUTCFullYear(), start = Date.UTC(y, 0, 1), end = Date.UTC(y + 1, 0, 1);
    return y + (ms - start) / (end - start);
  };
  // North, east and down field components (nT) at a geodetic place, height in km.
  function field(latDeg, lonDeg, hKm, year) {
    const lat = (latDeg * Math.PI) / 180, lon = (lonDeg * Math.PI) / 180,
      e2 = F * (2 - F), sl = Math.sin(lat), cl = Math.cos(lat),
      rc = A / Math.sqrt(1 - e2 * sl * sl),
      px = (rc + hKm) * cl, pz = (rc * (1 - e2) + hKm) * sl,
      r = Math.hypot(px, pz), latc = Math.asin(pz / r), dt = year - EPOCH,
      x = Math.sin(latc), cx = Math.cos(latc);
    // Schmidt semi-normalised associated Legendre functions of sin(latc), with
    // derivatives with respect to latc.
    const P = [], dP = [];
    for (let n = 0; n <= N; n++) { P.push(new Array(N + 1).fill(0)); dP.push(new Array(N + 1).fill(0)); }
    P[0][0] = 1;
    for (let n = 1; n <= N; n++)
      for (let m = 0; m <= n; m++) {
        if (n === m) {
          const k = n === 1 ? 1 : Math.sqrt(1 - 1 / (2 * n));
          P[n][n] = k * cx * P[n - 1][n - 1];
          dP[n][n] = k * (cx * dP[n - 1][n - 1] - x * P[n - 1][n - 1]);
        } else {
          const a1 = (2 * n - 1) / Math.sqrt(n * n - m * m),
            a2 = n >= 2 ? Math.sqrt(((n - 1) * (n - 1) - m * m) / (n * n - m * m)) : 0;
          P[n][m] = a1 * x * P[n - 1][m] - (n >= 2 ? a2 * P[n - 2][m] : 0);
          dP[n][m] = a1 * (x * dP[n - 1][m] + cx * P[n - 1][m]) - (n >= 2 ? a2 * dP[n - 2][m] : 0);
        }
      }
    let bx = 0, by = 0, bz = 0;
    for (let n = 1; n <= N; n++) {
      const ar = Math.pow(RE / r, n + 2);
      for (let m = 0; m <= n; m++) {
        const gnm = g[n][m] + dt * gd[n][m], hnm = h[n][m] + dt * hd[n][m],
          cm = Math.cos(m * lon), sm = Math.sin(m * lon),
          t1 = gnm * cm + hnm * sm, t2 = gnm * sm - hnm * cm;
        bx -= ar * t1 * dP[n][m];
        by += ar * m * t2 * P[n][m];
        bz -= ar * (n + 1) * t1 * P[n][m];
      }
    }
    by /= cx;
    const psi = latc - lat;
    return { x: bx * Math.cos(psi) - bz * Math.sin(psi), y: by, z: bx * Math.sin(psi) + bz * Math.cos(psi) };
  }
  // Declination in degrees east of true north, or null outside the model's use
  // (poles, or dates beyond the five-year validity with a year's grace).
  function declination(latDeg, lonDeg, ms, hKm = 0) {
    const year = decimalYear(ms);
    if (!(Math.abs(latDeg) <= 89.5) || !(Math.abs(lonDeg) <= 180) || year < EPOCH - 1 || year > EPOCH + 6) return null;
    const b = field(latDeg, lonDeg, hKm, year);
    return (Math.atan2(b.y, b.x) * 180) / Math.PI;
  }
  return { EPOCH, field, declination, decimalYear };
})();
if (typeof module !== "undefined") module.exports = SpaceMagnetic;
