"use strict";
// The sky dome: horizon at the edge, straight up in the centre, compass
// orientation (N up, E right, like holding a compass flat). Canvas only; the
// list view is the accessible equivalent. In follow mode `turn(heading)` rotates
// the dome so that heading is at the top (0 = north up).
class SpaceDome {
  constructor(canvas, onSelect) {
    this.canvas = canvas;
    this.onSelect = onSelect;
    this.scene = null;
    this.rotation = 0;
    this.points = [];
    canvas.addEventListener("click", (e) => this.tap(e));
    if (typeof ResizeObserver !== "undefined")
      new ResizeObserver(() => this.draw()).observe(canvas);
  }
  static project(az, el, cx, cy, r, rotation = 0) {
    const rr = (r * (90 - Math.max(-12, Math.min(90, el)))) / 90,
      a = ((az - rotation) * Math.PI) / 180;
    return [cx + rr * Math.sin(a), cy - rr * Math.cos(a)];
  }
  static palette(red) {
    return red
      ? {
          sky0: "#0a0000", sky1: "#140202", edge: "#3a0b0b", ring: "#3a0b0b",
          text: "#b33a3a", faint: "#6e1d1d", star: "#c24848", line: "#5a1717",
          moon: "#d65a5a", planet: "#e06a4a", sat: "#ff5a4a", satMajor: "#ff7a66",
          selected: "#ff9a8a", dim: "#6e1d1d", track: "#ff5a4a",
        }
      : {
          sky0: "#0d1a14", sky1: "#1c3a2a", edge: "#2E4638", ring: "#2E4638",
          text: "#9DB3A6", faint: "#6F8C7C", star: "#E6F0EA", line: "#5b7568",
          moon: "#F3EBD2", planet: "#E9C46A", sat: "#5FD3A0", satMajor: "#8CF0C4",
          selected: "#8CF0C4", dim: "#6F8C7C", track: "#5FD3A0",
        };
  }
  set(scene) {
    this.scene = scene;
    this.draw();
  }
  // Follow mode: put this heading (degrees true) at the top and redraw.
  turn(heading) {
    this.rotation = heading;
    this.draw();
  }
  geometry() {
    const rect = this.canvas.getBoundingClientRect(),
      size = Math.max(160, Math.min(rect.width || 320, 560));
    return { size, cx: size / 2, cy: size / 2, r: size / 2 - 26 };
  }
  draw() {
    const s = this.scene;
    if (!s) return;
    const { size, cx, cy, r } = this.geometry(),
      dpr = Math.min(3, (typeof devicePixelRatio === "number" && devicePixelRatio) || 1),
      px = Math.round(size * dpr);
    if (this.canvas.width !== px) {
      this.canvas.width = px;
      this.canvas.height = px;
    }
    const g = this.canvas.getContext("2d");
    if (!g) return;
    const c = SpaceDome.palette(s.red),
      P = (az, el) => SpaceDome.project(az, el, cx, cy, r, this.rotation);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);
    const grad = g.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, c.sky0);
    grad.addColorStop(1, c.sky1);
    g.fillStyle = grad;
    g.beginPath();
    g.arc(cx, cy, r, 0, 2 * Math.PI);
    g.fill();
    g.strokeStyle = c.edge;
    g.lineWidth = 1;
    g.stroke();
    if (s.follow) {
      // Where you are facing: a wedge of ±28° from the centre to the top edge.
      const w = (28 * Math.PI) / 180;
      g.fillStyle = c.track;
      g.globalAlpha = 0.12;
      g.beginPath();
      g.moveTo(cx, cy);
      g.arc(cx, cy, r, -Math.PI / 2 - w, -Math.PI / 2 + w);
      g.closePath();
      g.fill();
      g.globalAlpha = 0.4;
      g.strokeStyle = c.track;
      g.stroke();
      g.globalAlpha = 1;
    }
    g.setLineDash([2, 4]);
    g.strokeStyle = c.ring;
    for (const el of [30, 60]) {
      g.beginPath();
      g.arc(cx, cy, (r * (90 - el)) / 90, 0, 2 * Math.PI);
      g.stroke();
    }
    g.setLineDash([]);
    g.font = "10px system-ui, sans-serif";
    g.fillStyle = c.faint;
    g.textAlign = "left";
    g.fillText("30°", cx + 4, cy - (r * 60) / 90 + 12);
    g.fillText("60°", cx + 4, cy - (r * 30) / 90 + 12);
    g.textAlign = "center";
    g.textBaseline = "middle";
    for (const [label, az] of [["N", 0], ["NE", 45], ["E", 90], ["SE", 135], ["S", 180], ["SW", 225], ["W", 270], ["NW", 315]]) {
      const [x, y] = P(az, -9);
      g.font = label.length > 1 ? "10px system-ui, sans-serif" : "bold 13px system-ui, sans-serif";
      g.fillStyle = label.length > 1 ? c.faint : c.text;
      g.fillText(label, x, y);
    }
    // Names are drawn after the sky so they stay readable near the horizon.
    const labels = [];
    g.save();
    g.beginPath();
    g.arc(cx, cy, r, 0, 2 * Math.PI);
    g.clip();
    // Asterism lines, then stars sized by brightness.
    if (s.stars.length) {
      g.strokeStyle = c.line;
      g.globalAlpha = 0.55;
      for (const [, paths] of s.asterisms)
        for (const path of paths) {
          const pts = path.map((i) => s.stars[i]);
          g.beginPath();
          let pen = false;
          for (const p of pts) {
            if (!p || p.el < 0) {
              pen = false;
              continue;
            }
            const [x, y] = P(p.az, p.el);
            if (pen) g.lineTo(x, y);
            else g.moveTo(x, y);
            pen = true;
          }
          g.stroke();
        }
      g.globalAlpha = 1;
      g.fillStyle = c.star;
      for (const p of s.stars) {
        if (p.el < 0) continue;
        const [x, y] = P(p.az, p.el);
        g.globalAlpha = s.dark ? 0.9 : 0.35;
        g.beginPath();
        g.arc(x, y, Math.max(0.7, 2.6 - 0.55 * p.mag), 0, 2 * Math.PI);
        g.fill();
      }
      g.globalAlpha = 1;
      for (const p of s.stars)
        if (p.el > 3 && p.name && (p.mag < 0.9 || p.name === "Polaris")) {
          const [x, y] = P(p.az, p.el);
          labels.push([p.name, x + 5, y, c.text, false]);
        }
    }
    for (const b of s.bodies) {
      if (b.el < -1) continue;
      const [x, y] = P(b.az, b.el);
      g.fillStyle = b.key === "moon" ? c.moon : c.planet;
      g.beginPath();
      g.arc(x, y, b.key === "moon" ? 7 : 3.2, 0, 2 * Math.PI);
      g.fill();
      labels.push([b.label, x, y + (b.key === "moon" ? 16 : 12), b.key === "moon" ? c.text : c.planet, true]);
    }
    // Satellites: faint hollow ticks unless visible; visible ones get a track.
    this.points = [];
    const order = [...s.objects].sort((a, b) => (a.state === "visible") - (b.state === "visible"));
    for (const o of order) {
      const [x, y] = P(o.az, o.el),
        on = o.state === "visible" || o.state === "low";
      this.points.push({ id: o.id, x, y, on });
      if (!on) {
        g.strokeStyle = c.dim;
        g.globalAlpha = o.id === s.selected ? 1 : 0.7;
        g.beginPath();
        g.arc(x, y, 2.6, 0, 2 * Math.PI);
        g.stroke();
        g.globalAlpha = 1;
      } else {
        if (o.trail && o.trail.length > 1) {
          const past = o.trail.filter((p) => p.t <= 0 && p.el > -1),
            next = o.trail.filter((p) => p.t >= 0 && p.el > -1);
          g.strokeStyle = c.track;
          g.globalAlpha = 0.55;
          g.lineWidth = 1.6;
          g.beginPath();
          past.forEach((p, i) => (i ? g.lineTo(...P(p.az, p.el)) : g.moveTo(...P(p.az, p.el))));
          g.stroke();
          g.setLineDash([2, 3]);
          g.lineWidth = 1.2;
          g.beginPath();
          next.forEach((p, i) => (i ? g.lineTo(...P(p.az, p.el)) : g.moveTo(...P(p.az, p.el))));
          g.stroke();
          g.setLineDash([]);
          g.globalAlpha = 1;
          const ahead = o.trail.find((p) => p.t === 20);
          if (ahead) {
            const [qx, qy] = P(ahead.az, ahead.el),
              a = Math.atan2(qy - y, qx - x);
            g.fillStyle = c.track;
            g.beginPath();
            g.moveTo(x + 15 * Math.cos(a), y + 15 * Math.sin(a));
            g.lineTo(x + 10 * Math.cos(a) + 3.5 * Math.cos(a + Math.PI / 2), y + 10 * Math.sin(a) + 3.5 * Math.sin(a + Math.PI / 2));
            g.lineTo(x + 10 * Math.cos(a) - 3.5 * Math.cos(a + Math.PI / 2), y + 10 * Math.sin(a) - 3.5 * Math.sin(a + Math.PI / 2));
            g.fill();
          }
        }
        g.fillStyle = o.major ? c.satMajor : c.sat;
        g.globalAlpha = o.state === "low" ? 0.6 : 1;
        // A train: its other members as small beads, then the stand-in.
        for (const m of o.members || []) {
          const [mx, my] = P(m.az, m.el);
          this.points.push({ id: o.id, x: mx, y: my, on });
          g.beginPath();
          g.arc(mx, my, 1.8, 0, 2 * Math.PI);
          g.fill();
        }
        g.beginPath();
        g.arc(x, y, o.major ? 5 : 3.6, 0, 2 * Math.PI);
        g.fill();
        g.globalAlpha = 1;
      }
      if (o.label && (on || o.id === s.selected)) labels.push([o.label, x, y - 12, c.satMajor, true, true]);
      if (o.id === s.selected) {
        g.strokeStyle = c.selected;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x, y, 11, 0, 2 * Math.PI);
        g.stroke();
        g.lineWidth = 1;
      }
    }
    g.restore();
    g.textAlign = "left";
    for (const [text, x, y, colour, centred, bold] of labels) {
      g.font = `${bold ? "bold " : ""}10px system-ui, sans-serif`;
      const w = g.measureText(text).width,
        left = centred ? x - w / 2 : x;
      g.fillStyle = colour;
      g.fillText(text, Math.max(2, Math.min(size - w - 2, left)), y);
    }
  }
  // Nearest object within a finger's width; visible ones win ties.
  hit(x, y) {
    let best = null;
    for (const p of this.points) {
      const d = Math.hypot(p.x - x, p.y - y) - (p.on ? 6 : 0);
      if (d < 26 && (!best || d < best.d)) best = { id: p.id, d };
    }
    return best ? best.id : null;
  }
  tap(e) {
    const rect = this.canvas.getBoundingClientRect(),
      scale = this.geometry().size / (rect.width || 1);
    this.onSelect(this.hit((e.clientX - rect.left) * scale, (e.clientY - rect.top) * scale));
  }
}
if (typeof module !== "undefined") module.exports = SpaceDome;
