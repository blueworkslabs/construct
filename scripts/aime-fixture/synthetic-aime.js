"use strict";
// Synthetic Aimé: disposable acceptance fixture, never a product. Loaded after
// resection.js and bridge.js, before app.js. It replaces three host answers with
// a known scene so taps have known answers:
//   location.read  → a fixed viewpoint (clearly synthetic, 10 m accuracy)
//   net.http        → a fixed Overpass feature set (tile requests pass through)
//   photos.library open → the real host open (ref/grant checks unchanged), with
//                   the pixels replaced by a rendered view of the scene
// Capture, list, delete, storage and grants are the real host. Fixture-only
// buttons inject one Overpass 429 or offline answer and read the stored record
// count, so acceptance can see error handling and sidecar reconciliation.
const SyntheticAime = (() => {
  const R = typeof Resection !== "undefined" ? Resection : require("../../examples/aime-module/ui/resection.js");
  const viewer = { lat: 46.8, lon: 9.2 },
    width = 1024,
    height = 768,
    pose = { heading: 30, fov: 66, pitch: 4, roll: 1.5, aspect: height / width };
  // [letter, osm type, id, tags, bearing°, km]
  const defs = [
    ["A", "node", 9000000001, { name: "Synthetic Tower A", man_made: "tower", height: "80" }, 18, 6],
    ["B", "node", 9000000002, { name: "Synthetic Peak B", natural: "peak", ele: "2400" }, 42, 18],
    ["C", "way", 9000000003, { name: "Synthetic Church C", building: "church" }, 30, 3],
    ["D", "node", 9000000004, { name: "Synthetic Castle D", historic: "castle" }, 51, 11],
    ["E", "node", 9000000005, { name: "Synthetic Mast E", man_made: "mast" }, 45, 25],
    ["F", "node", 9000000006, { name: "Synthetic Viewpoint F", tourism: "viewpoint" }, 200, 4],
    ["G", "node", 9000000007, { name: "Synthetic Chapel G", building: "chapel" }, 9, 2],
    ["H", "relation", 9000000008, { name: "Synthetic Airfield H", aeroway: "aerodrome" }, 36, 28],
  ];
  const features = defs.map(([letter, type, id, tags, bearing, km]) => ({ letter, type, id, tags, bearing, km, ...R.destination(viewer, bearing, km) }));
  const horizonRow = (x) => R.horizonRow(pose, x);
  // Pixel (normalised) where a feature's base meets the level horizon, or null
  // when it is outside the frame.
  function project(f) {
    const b = R.bearing(viewer, f);
    let x = R.angleColumn(R.diff(b, pose.heading), pose.fov);
    for (let i = 0; i < 30 && Number.isFinite(x); i++) {
      const at = (u) => R.azimuthOf(pose, pose.aspect, u, horizonRow(u)),
        err = R.diff(b, at(x)),
        slope = R.diff(at(x + 1e-4), at(x - 1e-4)) / 2e-4;
      x += err / slope;
    }
    return x >= 0 && x <= 1 ? { x, y: horizonRow(x) } : null;
  }
  const at = Object.fromEntries(features.map((f) => [f.letter, project(f)]));
  // Suggested taps for acceptance: mark A, two horizon points, then ask about B and D.
  const taps = { markA: at.A, horizon: [{ x: 0.12, y: horizonRow(0.12) }, { x: 0.88, y: horizonRow(0.88) }], whatB: at.B, whatD: at.D };
  const overpass = () =>
    JSON.stringify({
      version: 0.6,
      generator: "Synthetic Aimé fixture",
      elements: features.map((f) => (f.type === "node" ? { type: f.type, id: f.id, lat: f.lat, lon: f.lon, tags: f.tags } : { type: f.type, id: f.id, center: { lat: f.lat, lon: f.lon }, tags: f.tags })),
    });
  function render() {
    const c = document.createElement("canvas");
    c.width = width;
    c.height = height;
    const g = c.getContext("2d"),
      line = [];
    for (let i = 0; i <= 64; i++) line.push([(i / 64) * width, horizonRow(i / 64) * height]);
    const sky = g.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#6f9fd8");
    sky.addColorStop(0.6, "#c9dcf0");
    g.fillStyle = sky;
    g.fillRect(0, 0, width, height);
    g.fillStyle = "#3d5a3a";
    g.beginPath();
    g.moveTo(0, height);
    for (const [x, y] of line) g.lineTo(x, y);
    g.lineTo(width, height);
    g.fill();
    g.strokeStyle = "#1d2a1c";
    g.lineWidth = 2;
    g.beginPath();
    line.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    g.font = "bold 22px sans-serif";
    g.textAlign = "center";
    for (const f of features) {
      const p = at[f.letter];
      if (!p) continue;
      const x = p.x * width,
        y = p.y * height,
        s = Math.max(0.5, 3 / f.km);
      g.fillStyle = "#2a2a2a";
      g.beginPath();
      if (f.tags.natural) {
        g.moveTo(x - 120 * Math.min(1, s * 4), y);
        g.lineTo(x, y - 110);
        g.lineTo(x + 120 * Math.min(1, s * 4), y);
      } else if (f.tags.man_made) {
        g.rect(x - 4, y - 90, 8, 90);
      } else {
        g.rect(x - 16 * s, y - 40 * s, 32 * s, 40 * s);
        g.moveTo(x - 6 * s, y - 40 * s);
        g.lineTo(x, y - 70 * s);
        g.lineTo(x + 6 * s, y - 40 * s);
      }
      g.fill();
      g.fillStyle = "#fff";
      g.fillText(f.letter, x, y - (f.tags.natural ? 120 : 100));
    }
    g.fillStyle = "#fff";
    g.font = "16px sans-serif";
    g.textAlign = "left";
    g.fillText("SYNTHETIC SCENE — acceptance fixture, not a real view", 12, 24);
    return c.toDataURL("image/jpeg", 0.85);
  }
  function install() {
    const real = call;
    // Fixture-only failure injection for the next Overpass answer: "429" or "offline".
    let inject = null;
    call = async function (method, params) {
      if (method === "location.read") return { latitude: viewer.lat, longitude: viewer.lon, accuracyM: 10, timestamp: Date.now() - 1500, approximate: false };
      if (method === "net.http" && typeof params.url === "string" && params.url.startsWith("https://overpass-api.de/")) {
        const once = inject;
        inject = null;
        if (once === "429") return { status: 429, headers: { "retry-after": "60" } };
        if (once === "offline") throw Object.assign(new Error("Synthetic offline"), { code: "HTTP_UNAVAILABLE" });
        return { status: 200, headers: {}, text: overpass() };
      }
      const result = await real(method, params);
      if (method === "photos.library" && params.op === "open") return { ...result, url: render(), width, height };
      return result;
    };
    document.addEventListener("DOMContentLoaded", () => {
      const pct = (p) => `${Math.round(p.x * 100)} % across, ${Math.round(p.y * 100)} % down`;
      const note = document.createElement("p");
      note.className = "note";
      note.id = "fixture-note";
      note.textContent = `Synthetic fixture. Mark Synthetic Tower A at ${pct(taps.markA)}; horizon at ${pct(taps.horizon[0])} and ${pct(taps.horizon[1])}; B at ${pct(taps.whatB)}.`;
      const tools = document.createElement("div");
      tools.className = "row";
      tools.id = "fixture-tools";
      const out = document.createElement("p");
      out.className = "note";
      out.id = "fixture-output";
      out.setAttribute("role", "status");
      const button = (label, fn) => {
        const b = document.createElement("button");
        b.textContent = label;
        b.onclick = fn;
        tools.append(b);
      };
      button("Fixture: next Overpass 429", () => ((inject = "429"), (out.textContent = "Next Overpass answer: 429.")));
      button("Fixture: next Overpass offline", () => ((inject = "offline"), (out.textContent = "Next Overpass answer: offline.")));
      // Read-only view of the real module storage, so acceptance can see sidecar reconciliation.
      button("Fixture: count stored records", async () => {
        try {
          const stored = await real("storage.kv", { op: "get", key: "photos" });
          out.textContent = "Stored photo records: " + Object.keys(stored || {}).length;
        } catch (error) {
          out.textContent = "Stored photo records unavailable: " + (error.code || "ERROR");
        }
      });
      document.getElementById("capture-note").after(note, tools, out);
    });
  }
  return { viewer, width, height, pose, features, at, taps, overpass, install };
})();
if (typeof module !== "undefined") module.exports = SyntheticAime;
else SyntheticAime.install();
