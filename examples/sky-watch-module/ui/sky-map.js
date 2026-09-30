"use strict";
class SkyMap {
  constructor(canvas, getImage, onSelect, onPan, onError) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.getImage = getImage;
    this.onSelect = onSelect;
    this.onPan = onPan;
    this.onError = onError;
    this.center = { lat: 50, lon: 8 };
    this.area = this.center;
    this.radius = 50;
    this.zoom = 8;
    this.aircraft = [];
    this.selected = null;
    this.cache = new Map();
    this.failures = new Map();
    this.pending = new Set();
    this.wanted = new Set();
    this.hits = [];
    // Follow: the map is turned so this true heading (degrees) is up, and a
    // wedge shows the view from the area centre.
    this.rotation = 0;
    this.follow = false;
    this.visible = true;
    this.drag = null;
    this.pinch = null;
    this.pointers = new Map();
    this.lastTap = null;
    this.observer = new ResizeObserver(() => this.draw());
    this.observer.observe(canvas);
    canvas.addEventListener("pointerdown", (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        // Second finger: stop dragging, start a pinch anchored on the midpoint.
        const [a, b] = [...this.pointers.values()],
          r = canvas.getBoundingClientRect();
        this.drag = null;
        this.pinch = {
          distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          zoom: this.zoom,
          anchor: this.geoAt((a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top),
        };
        return;
      }
      this.drag = {
        id: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        moved: false,
      };
    });
    canvas.addEventListener("pointermove", (e) => {
      const p = this.pointers.get(e.pointerId);
      if (p) {
        p.x = e.clientX;
        p.y = e.clientY;
      }
      if (this.pinch && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()],
          r = canvas.getBoundingClientRect(),
          d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        this.zoom = SkyMap.clampZoom(
          this.pinch.zoom + Math.log2(d / this.pinch.distance), this.zoom,
        );
        const p = SkyData.projection, s = this.scale(),
          [ux, uy] = this.unrotate((a.x + b.x) / 2 - r.left - this.width / 2, (a.y + b.y) / 2 - r.top - this.height / 2);
        this.center = p.point(p.x(this.pinch.anchor.lon) - ux / s, p.y(this.pinch.anchor.lat) - uy / s);
        this.draw();
        this.onPan();
        return;
      }
      const d = this.drag;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.lastX,
        dy = e.clientY - d.lastY;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 7) d.moved = true;
      if (d.moved) {
        const p = SkyData.projection,
          s = this.scale(),
          [ux, uy] = this.unrotate(dx, dy);
        this.center = p.point(
          p.x(this.center.lon) - ux / s,
          p.y(this.center.lat) - uy / s,
        );
        this.draw();
        this.onPan();
      }
      d.lastX = e.clientX;
      d.lastY = e.clientY;
    });
    const release = (e) => {
      this.pointers.delete(e.pointerId);
      if (this.pinch) {
        if (this.pointers.size < 2) this.pinch = null;
        this.drag = null;
        this.lastTap = null;
        return;
      }
      const d = this.drag;
      this.drag = null;
      if (!d || d.moved || e.type !== "pointerup") return;
      const r = canvas.getBoundingClientRect(),
        x = e.clientX - r.left,
        y = e.clientY - r.top;
      const hit = this.hits
        .map((h) => ({ ...h, d: Math.hypot(h.x - x, h.y - y) }))
        .sort((a, b) => a.d - b.d)[0];
      if (hit && hit.d < 30) {
        this.lastTap = null;
        this.onSelect(hit.key);
        return;
      }
      const t = this.lastTap,
        now = Date.now();
      if (t && now - t.time < 320 && Math.hypot(t.x - x, t.y - y) < 40) {
        // Double tap on open map: zoom one level in around the tapped point.
        this.lastTap = null;
        this.zoomTo(Math.round(this.zoom) + 1, x, y);
        this.onPan();
      } else this.lastTap = { x, y, time: now };
    };
    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const r = canvas.getBoundingClientRect();
        this.zoomTo(
          this.zoom - Math.sign(e.deltaY) * 0.5,
          e.clientX - r.left,
          e.clientY - r.top,
        );
        this.onPan();
      },
      { passive: false },
    );
  }
  scale() {
    return 256 * 2 ** this.zoom;
  }
  static clampZoom(z, fallback = 8) {
    return Math.max(2, Math.min(13, Number.isFinite(z) ? z : fallback));
  }
  // Screen offsets from the centre ↔ north-up map offsets, under rotation.
  rotate(ux, uy) {
    const t = (-this.rotation * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    return [ux * c - uy * s, ux * s + uy * c];
  }
  unrotate(x, y) {
    const t = (this.rotation * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    return [x * c - y * s, x * s + y * c];
  }
  // Follow mode: put this true heading at the top (0 = north-up) and redraw.
  turn(heading, follow = heading !== 0) {
    this.rotation = ((heading % 360) + 360) % 360;
    this.follow = follow;
    this.draw();
  }
  // Geographic point under a canvas pixel.
  geoAt(x, y) {
    const p = SkyData.projection,
      s = this.scale(),
      [ux, uy] = this.unrotate(x - this.width / 2, y - this.height / 2);
    return p.point(p.x(this.center.lon) + ux / s, p.y(this.center.lat) + uy / s);
  }
  // Change zoom while keeping the geography under (x, y) fixed on screen.
  zoomTo(zoom, x, y) {
    const next = SkyMap.clampZoom(zoom, this.zoom);
    if (next === this.zoom) return;
    if (
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      this.width > 0 &&
      this.height > 0
    ) {
      const anchor = this.geoAt(x, y),
        p = SkyData.projection;
      this.zoom = next;
      const s = this.scale();
      this.center = p.point(
        p.x(anchor.lon) - (x - this.width / 2) / s,
        p.y(anchor.lat) - (y - this.height / 2) / s,
      );
    } else this.zoom = next;
    this.draw();
  }
  setArea(center, radius, fit = true) {
    this.area = { ...center };
    this.radius = radius;
    if (fit) {
      this.center = { ...center };
      const r = this.canvas.getBoundingClientRect(),
        span = Math.max(128, Math.min(r.width, r.height));
      this.zoom = SkyMap.clampZoom(
        Math.floor(
          Math.log2(
            (40075 * Math.cos((center.lat * Math.PI) / 180) * span) /
              (256 * radius * 2.2),
          ),
        ),
      );
    }
    this.draw();
  }
  reset() {
    this.center = { ...this.area };
    this.draw();
  }
  zoomBy(n) {
    this.zoomTo(Math.round(this.zoom) + n);
  }
  // Is this point drawn inside the viewport (with a small margin)?
  shows(point) {
    if (!this.width || !this.height) return true;
    const q = this.xy(point);
    return (
      q.x >= 24 &&
      q.y >= 24 &&
      q.x <= this.width - 24 &&
      q.y <= this.height - 24
    );
  }
  centerOn(point) {
    this.center = { ...point };
    this.draw();
  }
  update(rows, key) {
    this.aircraft = rows;
    this.selected = key;
    this.draw();
  }
  xy(p) {
    const m = SkyData.projection,
      s = this.scale(),
      [x, y] = this.rotate(m.dx(m.x(p.lon), m.x(this.center.lon)) * s, (m.y(p.lat) - m.y(this.center.lat)) * s);
    return { x: this.width / 2 + x, y: this.height / 2 + y };
  }
  draw() {
    if (!this.visible) return;
    const c = this.canvas,
      r = c.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.width = r.width;
    this.height = r.height;
    const d = Math.min(devicePixelRatio || 1, 3);
    if (
      c.width !== Math.round(r.width * d) ||
      c.height !== Math.round(r.height * d)
    ) {
      c.width = Math.round(r.width * d);
      c.height = Math.round(r.height * d);
    }
    const ctx = this.ctx;
    ctx.setTransform(d, 0, 0, d, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    ctx.fillStyle = "#15291e";
    ctx.fillRect(0, 0, r.width, r.height);
    // Tiles come from the nearest integer zoom and are scaled for fractional zoom.
    const p = SkyData.projection,
      tileZoom = Math.round(this.zoom),
      n = 2 ** tileZoom,
      tile = 256 * 2 ** (this.zoom - tileZoom),
      s = this.scale(),
      cx = p.x(this.center.lon) * s,
      cy = p.y(this.center.lat) * s,
      // A turned map shows the corners of a larger north-up square.
      margin = this.rotation ? (Math.hypot(r.width, r.height) - Math.min(r.width, r.height)) / 2 : 0,
      left = cx - r.width / 2,
      top = cy - r.height / 2;
    ctx.save();
    ctx.translate(r.width / 2, r.height / 2);
    ctx.rotate((-this.rotation * Math.PI) / 180);
    ctx.translate(-r.width / 2, -r.height / 2);
    this.wanted = new Set();
    for (
      let y = Math.floor((top - margin) / tile);
      y <= Math.floor((top + r.height + margin) / tile);
      y++
    )
      for (
        let x = Math.floor((left - margin) / tile);
        x <= Math.floor((left + r.width + margin) / tile);
        x++
      ) {
        if (y < 0 || y >= n) continue;
        const xx = ((x % n) + n) % n,
          key = `${tileZoom}/${xx}/${y}`;
        this.wanted.add(key);
        const image = this.cache.get(key);
        if (image)
          ctx.drawImage(
            image,
            x * tile - left,
            y * tile - top,
            tile + 0.5,
            tile + 0.5,
          );
      }
    ctx.restore();
    const center = this.xy(this.area),
      mPerPx = (40075016 * Math.cos((this.area.lat * Math.PI) / 180)) / s;
    ctx.beginPath();
    ctx.arc(center.x, center.y, (this.radius * 1000) / mPerPx, 0, Math.PI * 2);
    ctx.strokeStyle = "#739780aa";
    ctx.lineWidth = 2;
    ctx.stroke();
    if (this.follow) {
      // Where you are facing: a wedge of ±28° from your spot toward the top.
      const w = (28 * Math.PI) / 180, reach = Math.hypot(r.width, r.height);
      ctx.fillStyle = "#5fd3a0";
      ctx.globalAlpha = 0.14;
      ctx.beginPath();
      ctx.moveTo(center.x, center.y);
      ctx.arc(center.x, center.y, reach, -Math.PI / 2 - w, -Math.PI / 2 + w);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = "#5fd3a0";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    this.hits = [];
    for (const a of this.aircraft) {
      const q = this.xy(a.point);
      if (q.x < -30 || q.y < -30 || q.x > r.width + 30 || q.y > r.height + 30)
        continue;
      this.hits.push({ ...q, key: a.key });
      const selected = a.key === this.selected,
        stale = Date.now() / 1000 - a.positionTime > 30;
      this.marker(q.x, q.y, a.track === null ? null : a.track - this.rotation, SkyData.kind(a), selected, stale);
      if (
        selected &&
        q.x >= 0 &&
        q.y >= 0 &&
        q.x <= r.width &&
        q.y <= r.height
      ) {
        const text = SkyData.label(a);
        ctx.font = "600 12px system-ui";
        let label = text;
        while (
          label.length > 1 &&
          ctx.measureText(label + "…").width > r.width - 26
        )
          label = label.slice(0, -1);
        if (label !== text) label += "…";
        const w = Math.min(r.width - 8, ctx.measureText(label).width + 14),
          x = Math.max(4, Math.min(r.width - w - 4, q.x - w / 2)),
          y = Math.max(4, Math.min(r.height - 27, q.y - 43));
        ctx.fillStyle = "#102a1fe8";
        ctx.fillRect(x, y, w, 24);
        ctx.strokeStyle = "#5fd3a0";
        ctx.strokeRect(x, y, w, 24);
        ctx.fillStyle = "#e6f0ea";
        ctx.fillText(label, x + 7, y + 16);
      }
    }
    ctx.beginPath();
    ctx.arc(center.x, center.y, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#11251a";
    ctx.fill();
    ctx.strokeStyle = "#e6f0ea";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(center.x, center.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#5fd3a0";
    ctx.fill();
    const bar = SkyData.scaleBar(
      (40075016 * Math.cos((this.center.lat * Math.PI) / 180)) / s,
      Math.min(140, r.width / 3),
    );
    if (bar) {
      // Sits above the attribution strip, bottom right.
      // Android text zoom can wrap that HTML strip onto multiple lines.
      const attribution = c.parentElement?.querySelector(".attribution"),
        bottomInset = attribution
          ? Math.max(34, r.top + r.height - attribution.getBoundingClientRect().top + 12)
          : 34;
      const x = r.width - bar.pixels - 10,
        y = r.height - bottomInset;
      ctx.font = "600 11px system-ui";
      const tw = ctx.measureText(bar.text).width;
      ctx.fillStyle = "#102a1fcc";
      ctx.fillRect(
        Math.min(x, r.width - tw - 18) - 6,
        y - 18,
        Math.max(bar.pixels, tw + 6) + 12,
        26,
      );
      ctx.strokeStyle = "#e6f0ea";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y - 4);
      ctx.lineTo(x, y);
      ctx.lineTo(x + bar.pixels, y);
      ctx.lineTo(x + bar.pixels, y - 4);
      ctx.stroke();
      ctx.fillStyle = "#e6f0ea";
      ctx.fillText(bar.text, Math.min(x, r.width - tw - 18), y - 7);
    }
    this.pump();
  }
  marker(x, y, track, kind, selected, stale) {
    const c = this.ctx;
    c.save();
    c.translate(x, y);
    if (selected) {
      c.beginPath();
      c.arc(0, 0, 19, 0, Math.PI * 2);
      c.strokeStyle = "#5fd3a0";
      c.lineWidth = 3;
      c.stroke();
    }
    c.rotate(((track || 0) * Math.PI) / 180);
    c.fillStyle = stale ? "#d3a455" : "#10251a";
    c.strokeStyle = "#edf5ed";
    c.lineWidth = 1.8;
    c.beginPath();
    if (track === null || kind === "balloon") {
      c.arc(0, 0, 6, 0, Math.PI * 2);
    } else if (kind === "rotorcraft") {
      c.moveTo(0, -13);
      c.lineTo(4, -4);
      c.lineTo(15, -3);
      c.lineTo(15, 0);
      c.lineTo(4, 1);
      c.lineTo(2, 13);
      c.lineTo(-2, 13);
      c.lineTo(-4, 1);
      c.lineTo(-15, 0);
      c.lineTo(-15, -3);
      c.lineTo(-4, -4);
      c.closePath();
    } else {
      const w = kind === "glider" ? 17 : 14;
      c.moveTo(0, -16);
      c.lineTo(3, -3);
      c.lineTo(w, 5);
      c.lineTo(w, 8);
      c.lineTo(3, 4);
      c.lineTo(2, 11);
      c.lineTo(6, 14);
      c.lineTo(6, 16);
      c.lineTo(0, 14);
      c.lineTo(-6, 16);
      c.lineTo(-6, 14);
      c.lineTo(-2, 11);
      c.lineTo(-3, 4);
      c.lineTo(-w, 8);
      c.lineTo(-w, 5);
      c.lineTo(-3, -3);
      c.closePath();
    }
    c.fill();
    c.stroke();
    c.restore();
  }
  pump() {
    if (!this.visible) return;
    for (const key of this.wanted) {
      if (this.pending.size >= 2) return;
      if (
        this.cache.has(key) ||
        this.pending.has(key) ||
        (this.failures.get(key) || 0) > Date.now()
      )
        continue;
      this.pending.add(key);
      this.getImage(`https://tile.openstreetmap.org/${key}.png`)
        .then(
          (data) =>
            new Promise((resolve, reject) => {
              const img = new Image();
              img.onload = () =>
                img.width === 256 && img.height === 256
                  ? resolve(img)
                  : reject(new Error("Invalid map tile dimensions"));
              img.onerror = () => reject(new Error("Map tile unavailable"));
              img.src = data;
            }),
        )
        .then((img) => {
          this.cache.set(key, img);
          while (this.cache.size > 64)
            this.cache.delete(this.cache.keys().next().value);
          this.onError(null);
        })
        .catch((e) => {
          // Menu cancellation is not a failed tile and must not impose a cooldown.
          if (!this.visible || e.code === "RUN_PAUSED" || e.code === "RUN_STALE") return;
          this.failures.set(key, Date.now() + 60000);
          while (this.failures.size > 128)
            this.failures.delete(this.failures.keys().next().value);
          this.onError(e);
        })
        .finally(() => {
          this.pending.delete(key);
          this.draw();
        });
    }
  }
  pause(value) {
    this.visible = !value;
    if (!value) this.draw();
  }
}
