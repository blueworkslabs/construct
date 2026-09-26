"use strict";
// Aimé map: derived from Sky Watch's SkyMap (tiles, pan, pinch, wheel and
// double-tap zoom, scale bar, tile cooldowns). Adds the viewer dot (reported and
// fitted), the tap wedge (±1 direction σ, fainter band to ±2σ), mark pins, numbered candidate pins,
// dragging the viewer dot to correct it and tapping to place an unlocated viewpoint.
class AimeMap {
  static projection = {
    x: (lon) => (lon + 180) / 360,
    y: (lat) => {
      const s = Math.sin((Math.max(-85, Math.min(85, lat)) * Math.PI) / 180);
      return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
    },
    point: (x, y) => ({
      lat: Math.max(-85, Math.min(85, (Math.atan(Math.sinh(Math.PI * (1 - 2 * Math.max(0.001638, Math.min(0.998362, y))))) * 180) / Math.PI)),
      lon: (((x % 1) + 1) % 1) * 360 - 180,
    }),
    dx: (x, c) => {
      const d = x - c;
      return d - Math.round(d);
    },
  };
  static scaleBar(mPerPx, maxPx) {
    if (!(mPerPx > 0) || !(maxPx > 0)) return null;
    const target = mPerPx * maxPx;
    let best = 1;
    for (let e = 1; e <= 1e7; e *= 10) for (const s of [1, 2, 5]) if (s * e <= target) best = s * e;
    return { metres: best, pixels: best / mPerPx, text: best >= 1000 ? best / 1000 + " km" : best + " m" };
  }
  static clampZoom(z, fallback = 10) {
    return Math.max(2, Math.min(17, Number.isFinite(z) ? z : fallback));
  }
  // callbacks: {getImage(url) → dataUrl, onViewer(point) when dragged or placed, onPan(), onError(e|null)}
  constructor(canvas, callbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.cb = callbacks;
    this.center = { lat: 46.8, lon: 9.2 };
    this.zoom = 10;
    this.scene = { viewer: null, fitted: null, wedge: null, marks: [], candidates: [], focus: null };
    this.placing = false; // tap sets the viewpoint
    this.editable = false; // viewer dot can be dragged
    this.cache = new Map();
    this.failures = new Map();
    this.pending = new Set();
    this.wanted = new Set();
    this.visible = true;
    this.drag = null;
    this.pinch = null;
    this.pointers = new Map();
    this.lastTap = null;
    this.width = 0;
    this.height = 0;
    if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => this.draw()).observe(canvas);
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    canvas.addEventListener("pointerup", (e) => this.release(e));
    canvas.addEventListener("pointercancel", (e) => this.release(e));
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        this.zoomTo(this.zoom - Math.sign(e.deltaY) * 0.5, e.clientX - r.left, e.clientY - r.top);
        this.cb.onPan?.();
      },
      { passive: false },
    );
  }
  local(e) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  down(e) {
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()],
        r = this.canvas.getBoundingClientRect();
      this.drag = null;
      this.pinch = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: this.zoom, anchor: this.geoAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top) };
      return;
    }
    const at = this.local(e),
      v = this.scene.viewer && this.xy(this.scene.viewer),
      onViewer = this.editable && v && Math.hypot(v.x - at.x, v.y - at.y) < 32;
    this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, viewer: onViewer,
      original: onViewer ? { viewer: { ...this.scene.viewer }, fitted: this.scene.fitted, wedge: this.scene.wedge } : null };
  }
  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (p) {
      p.x = e.clientX;
      p.y = e.clientY;
    }
    const m = AimeMap.projection;
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()],
        r = this.canvas.getBoundingClientRect(),
        d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
      this.zoom = AimeMap.clampZoom(this.pinch.zoom + Math.log2(d / this.pinch.distance), this.zoom);
      const s = this.scale();
      this.center = m.point(m.x(this.pinch.anchor.lon) - ((a.x + b.x) / 2 - r.left - this.width / 2) / s, m.y(this.pinch.anchor.lat) - ((a.y + b.y) / 2 - r.top - this.height / 2) / s);
      this.draw();
      this.cb.onPan?.();
      return;
    }
    const d = this.drag;
    if (!d || d.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 7) d.moved = true;
    if (d.moved) {
      if (d.viewer) {
        const at = this.local(e);
        this.scene.viewer = { ...this.scene.viewer, ...this.geoAt(at.x, at.y) };
        this.scene.fitted = null;
        this.scene.wedge = null;
      } else {
        const s = this.scale();
        this.center = m.point(m.x(this.center.lon) - (e.clientX - d.lastX) / s, m.y(this.center.lat) - (e.clientY - d.lastY) / s);
        this.cb.onPan?.();
      }
      this.draw();
    }
    d.lastX = e.clientX;
    d.lastY = e.clientY;
  }
  release(e) {
    this.pointers.delete(e.pointerId);
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      this.drag = null;
      this.lastTap = null;
      return;
    }
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (e.type !== "pointerup") {
      if (d.original) Object.assign(this.scene, d.original);
      this.draw();
      return;
    }
    if (d.moved) {
      if (d.viewer) this.cb.onViewer?.({ lat: this.scene.viewer.lat, lon: this.scene.viewer.lon, mPerPx: this.metresPerPixel() });
      return;
    }
    const at = this.local(e);
    if (this.placing) {
      const point = this.geoAt(at.x, at.y);
      this.scene.viewer = { ...point, accuracyM: null };
      this.draw();
      this.cb.onViewer?.({ ...point, mPerPx: this.metresPerPixel() });
      return;
    }
    const t = this.lastTap,
      now = Date.now();
    if (t && now - t.time < 320 && Math.hypot(t.x - at.x, t.y - at.y) < 40) {
      this.lastTap = null;
      this.zoomTo(Math.round(this.zoom) + 1, at.x, at.y);
      this.cb.onPan?.();
    } else this.lastTap = { ...at, time: now };
  }
  scale() {
    return 256 * 2 ** this.zoom;
  }
  metresPerPixel(lat = this.center.lat) {
    return (40075016 * Math.cos((lat * Math.PI) / 180)) / this.scale();
  }
  geoAt(x, y) {
    const m = AimeMap.projection,
      s = this.scale();
    return m.point(m.x(this.center.lon) + (x - this.width / 2) / s, m.y(this.center.lat) + (y - this.height / 2) / s);
  }
  xy(p) {
    const m = AimeMap.projection,
      s = this.scale();
    return { x: this.width / 2 + m.dx(m.x(p.lon), m.x(this.center.lon)) * s, y: this.height / 2 + (m.y(p.lat) - m.y(this.center.lat)) * s };
  }
  zoomTo(zoom, x, y) {
    const next = AimeMap.clampZoom(zoom, this.zoom);
    if (next === this.zoom) return;
    if (Number.isFinite(x) && Number.isFinite(y) && this.width > 0 && this.height > 0) {
      const anchor = this.geoAt(x, y),
        m = AimeMap.projection;
      this.zoom = next;
      const s = this.scale();
      this.center = m.point(m.x(anchor.lon) - (x - this.width / 2) / s, m.y(anchor.lat) - (y - this.height / 2) / s);
    } else this.zoom = next;
    this.draw();
  }
  zoomBy(n) {
    this.zoomTo(Math.round(this.zoom) + n);
  }
  // scene: {viewer: {lat, lon, accuracyM}, fitted: {lat, lon}|null,
  //   wedge: {bearing, sigma, lengthKm}|null, marks: [{lat, lon, name}],
  //   candidates: [{lat, lon, n, greyed}], focus: index into candidates|null}
  setScene(scene, fit = true) {
    this.scene = { viewer: null, fitted: null, wedge: null, marks: [], candidates: [], focus: null, ...scene };
    if (fit) this.fit();
    this.draw();
  }
  // Frame the viewer with the focused candidate (or everything shown).
  fit() {
    const s = this.scene,
      pts = [];
    if (s.viewer) pts.push(s.viewer);
    if (s.focus !== null && s.candidates[s.focus]) pts.push(s.candidates[s.focus]);
    else pts.push(...s.candidates, ...s.marks);
    if (!pts.length) return;
    const m = AimeMap.projection,
      anchor = m.x(pts[0].lon),
      xs = pts.map((p) => anchor + m.dx(m.x(p.lon), anchor)),
      ys = pts.map((p) => m.y(p.lat)),
      cx = (Math.min(...xs) + Math.max(...xs)) / 2,
      cy = (Math.min(...ys) + Math.max(...ys)) / 2,
      span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)),
      r = this.canvas.getBoundingClientRect(),
      px = Math.max(128, Math.min(r.width || 300, r.height || 300)) - 80;
    this.center = m.point(cx, cy);
    this.zoom = AimeMap.clampZoom(span > 0 ? Math.floor(Math.log2(px / (256 * span))) : 14);
  }
  pause(value) {
    this.visible = !value;
    if (value) {
      if (this.drag?.original) Object.assign(this.scene, this.drag.original);
      this.drag = this.pinch = null;
      this.pointers.clear();
    }
    if (!value) this.draw();
  }
  draw() {
    if (!this.visible) return;
    const c = this.canvas,
      r = c.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.width = r.width;
    this.height = r.height;
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 3);
    if (c.width !== Math.round(r.width * dpr) || c.height !== Math.round(r.height * dpr)) {
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
    }
    const ctx = this.ctx,
      m = AimeMap.projection;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.fillStyle = "#15291e";
    ctx.fillRect(0, 0, r.width, r.height);
    const tileZoom = Math.round(this.zoom),
      n = 2 ** tileZoom,
      tile = 256 * 2 ** (this.zoom - tileZoom),
      s = this.scale(),
      left = m.x(this.center.lon) * s - r.width / 2,
      top = m.y(this.center.lat) * s - r.height / 2;
    this.wanted = new Set();
    for (let y = Math.floor(top / tile); y <= Math.floor((top + r.height) / tile); y++)
      for (let x = Math.floor(left / tile); x <= Math.floor((left + r.width) / tile); x++) {
        if (y < 0 || y >= n) continue;
        const key = `${tileZoom}/${((x % n) + n) % n}/${y}`;
        this.wanted.add(key);
        const image = this.cache.get(key);
        if (image) ctx.drawImage(image, x * tile - left, y * tile - top, tile + 0.5, tile + 0.5);
      }
    const sc = this.scene,
      mpp = this.metresPerPixel();
    if (sc.viewer && sc.wedge) this.drawWedge(sc.fitted || sc.viewer, sc.wedge, mpp);
    sc.marks.forEach((p) => this.pin(this.xy(p), "#5FD3A0", "", p.name));
    sc.candidates.forEach((p, i) => this.pin(this.xy(p), p.greyed ? "#9DB3A6" : i === sc.focus ? "#E9C46A" : "#F08A7E", String(p.n), i === sc.focus ? p.name : ""));
    if (sc.viewer) {
      const v = this.xy(sc.viewer);
      if (sc.viewer.accuracyM > 0) {
        ctx.beginPath();
        ctx.arc(v.x, v.y, Math.max(6, sc.viewer.accuracyM / mpp), 0, Math.PI * 2);
        ctx.fillStyle = "#5fd3a022";
        ctx.fill();
        ctx.strokeStyle = "#5fd3a088";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      // Reported/confirmed viewpoint: hollow ring. Fitted viewpoint: solid dot.
      ctx.beginPath();
      ctx.arc(v.x, v.y, 10, 0, Math.PI * 2);
      ctx.strokeStyle = "#E6F0EA";
      ctx.lineWidth = 3;
      ctx.stroke();
      const f = this.xy(sc.fitted || sc.viewer);
      ctx.beginPath();
      ctx.arc(f.x, f.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = "#5FD3A0";
      ctx.fill();
    }
    const bar = AimeMap.scaleBar(mpp, Math.min(140, r.width / 3));
    if (bar) {
      const x = r.width - bar.pixels - 10,
        y = r.height - 34;
      ctx.font = "600 11px system-ui";
      ctx.fillStyle = "#102a1fcc";
      ctx.fillRect(x - 6, y - 18, bar.pixels + 12, 26);
      ctx.strokeStyle = "#e6f0ea";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x, y);
      ctx.lineTo(x + bar.pixels, y);
      ctx.lineTo(x + bar.pixels, y - 4);
      ctx.stroke();
      ctx.fillStyle = "#e6f0ea";
      ctx.fillText(bar.text, x, y - 7);
    }
    this.pump();
  }
  // Wedge spanning bearing ±k·σ along the tap bearing (k = 1: the inner band).
  wedgePoints(from, wedge, k = 1) {
    const pts = [from],
      steps = 16,
      half = k * wedge.sigma;
    for (let i = 0; i <= steps; i++) pts.push(Resection.destination(from, wedge.bearing - half + (2 * half * i) / steps, wedge.lengthKm));
    return pts;
  }
  // Bands use direction σ. Candidate comparison σ can be wider due to position
  // uncertainty, so an offered nearby candidate can still lie outside the bands.
  drawWedge(from, wedge) {
    const ctx = this.ctx,
      band = (k, fill, stroke) => {
        const pts = this.wedgePoints(from, wedge, k).map((p) => this.xy(p));
        ctx.beginPath();
        pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth = k === 1 ? 1.5 : 1;
        ctx.stroke();
      };
    band(2, "#e9c46a14", "#e9c46a55");
    band(1, "#e9c46a33", "#e9c46acc");
    const end = this.xy(Resection.destination(from, wedge.bearing, wedge.lengthKm)),
      start = this.xy(from);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.setLineDash([6, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  pin(q, colour, label, name) {
    if (q.x < -30 || q.y < -30 || q.x > this.width + 30 || q.y > this.height + 30) return;
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(q.x, q.y);
    ctx.arc(q.x, q.y - 16, 10, Math.PI * 0.75, Math.PI * 2.25);
    ctx.closePath();
    ctx.fillStyle = colour;
    ctx.fill();
    ctx.strokeStyle = "#06110B";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.font = "700 11px system-ui";
    ctx.textAlign = "center";
    ctx.fillStyle = "#06110B";
    if (label) ctx.fillText(label, q.x, q.y - 12);
    if (name) {
      ctx.font = "600 12px system-ui";
      const w = ctx.measureText(name).width + 12;
      ctx.fillStyle = "#102a1fe8";
      ctx.fillRect(q.x - w / 2, q.y - 52, w, 20);
      ctx.fillStyle = "#e6f0ea";
      ctx.fillText(name, q.x, q.y - 38);
    }
    ctx.textAlign = "start";
  }
  pump() {
    if (!this.visible) return;
    for (const key of this.wanted) {
      if (this.pending.size >= 2) return;
      if (this.cache.has(key) || this.pending.has(key) || (this.failures.get(key) || 0) > Date.now()) continue;
      this.pending.add(key);
      this.cb
        .getImage(`https://tile.openstreetmap.org/${key}.png`)
        .then(
          (data) =>
            new Promise((resolve, reject) => {
              const img = new Image();
              img.onload = () => (img.width === 256 && img.height === 256 ? resolve(img) : reject(new Error("Invalid map tile dimensions")));
              img.onerror = () => reject(new Error("Map tile unavailable"));
              img.src = data;
            }),
        )
        .then((img) => {
          this.cache.set(key, img);
          while (this.cache.size > 64) this.cache.delete(this.cache.keys().next().value);
          this.cb.onError?.(null);
        })
        .catch((e) => {
          // Menu cancellation is not a failed tile and must not impose a cooldown.
          if (!this.visible || e.code === "RUN_PAUSED" || e.code === "RUN_STALE") return;
          this.failures.set(key, Date.now() + 60000);
          while (this.failures.size > 128) this.failures.delete(this.failures.keys().next().value);
          this.cb.onError?.(e);
        })
        .finally(() => {
          this.pending.delete(key);
          this.draw();
        });
    }
  }
}
if (typeof module !== "undefined") module.exports = AimeMap;
