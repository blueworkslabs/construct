"use strict";
// "Point at the sky": with the phone held up like a camera, a viewfinder-style
// view shows where the rear camera axis points and guides it to the selected
// object with plain words and an edge arrow. No camera image is used; the sky
// is drawn from the same positions as the dome.
//
// Orientation comes from orientation.read samples. The host reports the rear
// camera bearing while the phone is upright, but switches to "flat" (bearing
// of the screen's top edge) once the screen tilts within 45° of horizontal,
// which includes the camera aimed high. Both, with pitch and roll, fix the
// phone's full attitude, so the view works from the horizon to the zenith.
//
// Screen frame: x to the screen's right, y to its top, z out of the screen;
// the rear camera looks along −z. World directions are East, North, Up.
const SpacePointer = (() => {
  const K = typeof SpaceSky !== "undefined" ? SpaceSky : require("./space-sky.js");
  const FIELD = 35, // degrees from the centre to the rim of the view
    LOCK = 4, // on target within this many degrees
    TAN = Math.tan((FIELD * Math.PI) / 180),
    rad = (x) => (x * Math.PI) / 180,
    deg = (x) => (x * 180) / Math.PI,
    wrap360 = (x) => ((x % 360) + 360) % 360,
    wrap180 = (x) => ((((x + 180) % 360) + 360) % 360) - 180,
    dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k],
    add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    norm = (a) => {
      const n = Math.hypot(a[0], a[1], a[2]);
      return n > 1e-9 ? scale(a, 1 / n) : null;
    };
  // World East, North and Up in screen coordinates from one sample. bearingDeg
  // is the true bearing of the camera axis ("camera") or of the screen's top
  // edge ("top"). Null when that axis is too close to vertical to fix north.
  function orient({ pitchDeg, rollDeg, bearingDeg, axis }) {
    if (![pitchDeg, rollDeg, bearingDeg].every(Number.isFinite)) return null;
    const p = rad(pitchDeg), r = rad(rollDeg),
      U = [-Math.cos(p) * Math.sin(r), Math.cos(p) * Math.cos(r), Math.sin(p)],
      ref = axis === "camera" ? [0, 0, -1] : [0, 1, 0],
      h = norm(add(ref, scale(U, -dot(ref, U))));
    if (!h || Math.abs(dot(ref, U)) > 0.97) return null;
    const h2 = cross(h, U), // the horizontal direction 90° clockwise of h
      g = rad(bearingDeg);
    return {
      E: add(scale(h, Math.sin(g)), scale(h2, Math.cos(g))),
      N: add(scale(h, Math.cos(g)), scale(h2, -Math.sin(g))),
      U,
    };
  }
  // Moves a frame part of the way toward the next one. Vectors are averaged
  // and re-orthogonalised, so there is no wrap-around and no singularity at the
  // zenith, where roll and bearing stop meaning much.
  function smooth(prev, next, k) {
    if (!prev) return next;
    // A discontinuous reorientation can make opposite vectors cancel (or stay
    // stuck on the old side for seconds). Reacquire large changes directly;
    // ordinary sensor jitter still takes the smoothed path. The trace is
    // 1 + 2*cos(relative rotation), so zero means a 120-degree change.
    if (dot(prev.E, next.E) + dot(prev.N, next.N) + dot(prev.U, next.U) < 0) return next;
    const U = norm(add(prev.U, scale(add(next.U, scale(prev.U, -1)), k))),
      n0 = add(prev.N, scale(add(next.N, scale(prev.N, -1)), k)),
      N = U && norm(add(n0, scale(U, -dot(n0, U))));
    return U && N ? { E: cross(N, U), N, U } : next;
  }
  // Where the camera points (true azimuth and elevation) and how the phone is
  // rolled about that axis.
  function aim(f) {
    const el = deg(Math.asin(Math.max(-1, Math.min(1, -f.U[2])))),
      az = Math.hypot(f.E[2], f.N[2]) > 1e-6 ? wrap360(deg(Math.atan2(-f.E[2], -f.N[2]))) : 0;
    return { az, el, roll: deg(Math.atan2(-f.U[0], f.U[1])) };
  }
  // A sky direction in screen coordinates: x right, y up, depth along the
  // camera axis (negative behind the phone).
  function toScreen(f, dir) {
    const e = rad(dir.el), a = rad(dir.az),
      d = add(add(scale(f.E, Math.cos(e) * Math.sin(a)), scale(f.N, Math.cos(e) * Math.cos(a))), scale(f.U, Math.sin(e)));
    return { x: d[0], y: d[1], depth: -d[2] };
  }
  function separation(a, b) {
    const c =
      Math.sin(rad(a.el)) * Math.sin(rad(b.el)) +
      Math.cos(rad(a.el)) * Math.cos(rad(b.el)) * Math.cos(rad(a.az - b.az));
    return deg(Math.acos(Math.max(-1, Math.min(1, c))));
  }
  const WAYS = ["to the right", "up and to the right", "up", "up and to the left", "to the left", "down and to the left", "down", "down and to the right"];
  // Plain-language guidance from the camera axis to the target. Directions are
  // on the screen, so they match the arrow however the phone is held.
  function guide(f, target) {
    if (!f || !target) return null;
    const a = aim(f),
      sep = separation(a, target),
      s = toScreen(f, target),
      angle = Math.hypot(s.x, s.y) > 1e-6 ? deg(Math.atan2(s.y, s.x)) : -90;
    if (sep <= LOCK)
      return { sep, angle, locked: true, key: "locked", text: "On target. Look past the top of the phone.", short: "On target." };
    if (Math.abs(wrap180(target.az - a.az)) > 110 && a.el < 55 && target.el < 55)
      return { sep, angle, locked: false, turnAround: true, key: "behind", text: `Turn around: it is behind you, ${K.height(target.el)}.`, short: "Turn around: it is behind you." };
    const way = WAYS[Math.round(wrap360(angle) / 45) % 8];
    // short: without the distance, for announcing only when the way changes.
    return { sep, angle, locked: false, key: way, text: `Move the phone ${K.fists(sep)} ${way}.`, short: `Move the phone ${way}.` };
  }
  class View {
    constructor(canvas) {
      this.canvas = canvas;
    }
    // scene: { frame, target {az, el, label}, guide, stars, bodies, objects, palette, dark }
    draw(scene) {
      const rect = this.canvas.getBoundingClientRect(),
        size = Math.max(160, Math.min(rect.width || 320, 560)),
        dpr = Math.min(3, (typeof devicePixelRatio === "number" && devicePixelRatio) || 1),
        px = Math.round(size * dpr);
      if (this.canvas.width !== px) {
        this.canvas.width = px;
        this.canvas.height = px;
      }
      const g = this.canvas.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, size, size);
      if (!scene || !scene.frame) return;
      const c = scene.palette, f = scene.frame, cx = size / 2, cy = size / 2, r = size / 2 - 18,
        at = (dir, slack = 1.15) => {
          const s = toScreen(f, dir);
          if (s.depth < 0.05) return null;
          const x = s.x / s.depth / TAN, y = s.y / s.depth / TAN;
          return Math.hypot(x, y) > slack ? null : [cx + x * r, cy - y * r];
        },
        inside = (p) => Math.hypot(p[0] - cx, p[1] - cy) < r - 4;
      g.save();
      g.beginPath();
      g.arc(cx, cy, r, 0, 2 * Math.PI);
      g.fillStyle = c.sky0;
      g.fill();
      g.clip();
      const labels = [];
      // Horizon, with the compass points on it.
      g.strokeStyle = c.ring;
      g.setLineDash([4, 4]);
      g.beginPath();
      let pen = false;
      for (let az = 0; az <= 360; az += 2) {
        const p = at({ az, el: 0 }, 1.6);
        if (!p) {
          pen = false;
          continue;
        }
        pen ? g.lineTo(...p) : g.moveTo(...p);
        pen = true;
      }
      g.stroke();
      g.setLineDash([]);
      for (const [name, az] of [["N", 0], ["E", 90], ["S", 180], ["W", 270]]) {
        const p = at({ az, el: 0 });
        if (p && inside(p)) labels.push([name, p[0] - 4, p[1] + 10, c.text]);
      }
      for (const s of scene.stars || []) {
        if (s.el < -1 || s.mag > 4.5) continue;
        const p = at(s);
        if (!p) continue;
        g.fillStyle = c.star;
        g.globalAlpha = scene.dark ? 0.9 : 0.45;
        g.beginPath();
        g.arc(p[0], p[1], Math.max(0.8, 3.2 - 0.6 * s.mag), 0, 2 * Math.PI);
        g.fill();
        g.globalAlpha = 1;
        if (s.name && s.mag < 1.6 && inside(p)) labels.push([s.name, p[0] + 6, p[1], c.faint]);
      }
      for (const b of scene.bodies || []) {
        const p = at(b);
        if (!p) continue;
        g.fillStyle = b.key === "moon" ? c.moon : c.planet;
        g.beginPath();
        g.arc(p[0], p[1], b.key === "moon" ? 9 : 4, 0, 2 * Math.PI);
        g.fill();
        if (inside(p)) labels.push([b.label, p[0] + 11, p[1], b.key === "moon" ? c.text : c.planet]);
      }
      for (const o of scene.objects || []) {
        const p = at(o);
        if (!p) continue;
        g.fillStyle = o.state === "visible" ? c.sat : c.dim;
        g.beginPath();
        g.arc(p[0], p[1], o.state === "visible" ? 3 : 2, 0, 2 * Math.PI);
        g.fill();
      }
      const t = scene.target, tp = t ? at(t, 1) : null;
      // Its track: faint behind, dashed ahead, so the way it moves is clear.
      if (t && t.track) {
        g.strokeStyle = c.track;
        g.lineWidth = 2;
        for (const ahead of [false, true]) {
          g.globalAlpha = ahead ? 0.9 : 0.35;
          g.setLineDash(ahead ? [6, 5] : []);
          g.beginPath();
          let pen = false;
          for (const q of t.track) {
            if (ahead ? q.t < 0 : q.t > 0) continue;
            const p = q.el > -1 && at(q, 1.6);
            if (!p) {
              pen = false;
              continue;
            }
            pen ? g.lineTo(...p) : g.moveTo(...p);
            pen = true;
          }
          g.stroke();
        }
        g.globalAlpha = 1;
        g.setLineDash([]);
        g.lineWidth = 1;
      }
      if (tp) {
        g.fillStyle = c.satMajor;
        g.beginPath();
        g.arc(tp[0], tp[1], 6, 0, 2 * Math.PI);
        g.fill();
        // Near the middle, the label moves clear of the reticle.
        const lockR = Math.max(10, (Math.tan(rad(LOCK)) / TAN) * r);
        if (t.label)
          labels.push(Math.hypot(tp[0] - cx, tp[1] - cy) < lockR + 24
            ? [t.label, cx + lockR + 24, cy - lockR - 8, c.satMajor]
            : [t.label, tp[0] + 10, tp[1] - 12, c.satMajor]);
      }
      g.restore();
      // Labels after the clip; one that would run off the right goes left of its dot.
      g.font = "12px system-ui, sans-serif";
      g.textBaseline = "middle";
      for (const [text, x, y, colour] of labels) {
        g.fillStyle = colour;
        const w = g.measureText(text).width,
          lx = x + w > size - 2 ? x - w - 22 : x;
        g.fillText(text, Math.max(2, lx), y);
      }
      g.strokeStyle = c.edge;
      g.beginPath();
      g.arc(cx, cy, r, 0, 2 * Math.PI);
      g.stroke();
      // Centre reticle: the camera axis. The lock ring is the LOCK radius.
      const locked = !!(scene.guide && scene.guide.locked),
        lockR = Math.max(10, (Math.tan(rad(LOCK)) / TAN) * r);
      g.strokeStyle = locked ? c.selected : c.text;
      g.lineWidth = locked ? 3 : 1.5;
      g.beginPath();
      g.arc(cx, cy, lockR, 0, 2 * Math.PI);
      g.stroke();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        g.beginPath();
        g.moveTo(cx + dx * (lockR + 6), cy + dy * (lockR + 6));
        g.lineTo(cx + dx * (lockR + 18), cy + dy * (lockR + 18));
        g.stroke();
      }
      g.lineWidth = 1;
      // Target out of view: an arrow on the rim, the way to move the phone.
      if (t && !tp && scene.guide) {
        const a = -rad(scene.guide.angle), // canvas y grows downward
          ax = cx + Math.cos(a) * (r - 16), ay = cy + Math.sin(a) * (r - 16);
        g.fillStyle = c.satMajor;
        g.beginPath();
        g.moveTo(ax + Math.cos(a) * 14, ay + Math.sin(a) * 14);
        g.lineTo(ax + Math.cos(a + 2.4) * 12, ay + Math.sin(a + 2.4) * 12);
        g.lineTo(ax + Math.cos(a - 2.4) * 12, ay + Math.sin(a - 2.4) * 12);
        g.closePath();
        g.fill();
      }
    }
  }
  return { FIELD, LOCK, orient, smooth, aim, toScreen, separation, guide, View };
})();
if (typeof module !== "undefined") module.exports = SpacePointer;
