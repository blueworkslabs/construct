// An orientation.read sample as the host builds it (ModuleOrientation.sample
// and CaptureTilt.angles), for a phone whose rear camera points at true
// azimuth/elevation `az`/`el`, rolled `roll` degrees (right side down > 0),
// with display rotation 0 (portrait) or 1 (landscape, device +x up on screen).
// `declination` shifts the reported azimuth to magnetic.
const rad = (x) => (x * Math.PI) / 180, deg = (x) => (x * 180) / Math.PI;
const unit = (az, el) => [Math.cos(rad(el)) * Math.sin(rad(az)), Math.cos(rad(el)) * Math.cos(rad(az)), Math.sin(rad(el))];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a, k) => a.map((x) => x * k), add = (a, b) => a.map((x, i) => x + b[i]);
const round1 = (x) => Math.round(x * 10) / 10;
function bearing(east, north) {
  if (Math.hypot(east, north) < 0.25) return null;
  return round1(((deg(Math.atan2(east, north)) % 360) + 360) % 360) % 360;
}
module.exports = function sample(az, el, roll = 0, { rotation = 0, declination = 0 } = {}) {
  // Screen right Rs, screen up Us, out of the screen Z (world ENU vectors).
  const F = unit(az, el), U0 = unit(az, el + 90), R0 = cross(U0, scale(F, -1)),
    Rs = add(scale(R0, Math.cos(rad(roll))), scale(U0, -Math.sin(rad(roll)))),
    Us = add(scale(R0, Math.sin(rad(roll))), scale(U0, Math.cos(rad(roll)))),
    Z = scale(F, -1),
    [X, Y] = rotation === 1 ? [Us, scale(Rs, -1)] : [Rs, Us];
  // Android's rotation matrix: rows East, North, Up; columns device x, y, z.
  const r = [X[0], Y[0], Z[0], X[1], Y[1], Z[1], X[2], Y[2], Z[2]];
  const [ux, uy, uz] = [r[6], r[7], r[8]],
    [right, up] = rotation === 1 ? [-uy, ux] : [ux, uy],
    flat = Math.abs(r[8]) >= 0.7071,
    [col, sign] = rotation === 1 ? [0, 1] : [1, 1],
    azimuth = flat ? bearing(sign * r[col], sign * r[3 + col]) : bearing(-r[2], -r[5]);
  const out = { pose: flat ? "flat" : "upright", pitchDeg: round1(deg(Math.atan2(uz, Math.hypot(ux, uy)))), rollDeg: round1(deg(Math.atan2(-right, up))), calibrate: false };
  if (azimuth !== null) Object.assign(out, { azimuthDeg: round1((((azimuth - declination) % 360) + 360) % 360), headingRef: "magnetic", accuracyDeg: 8 });
  return out;
};
