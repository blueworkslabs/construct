"use strict";
// Synthetic Aimé: disposable acceptance fixture, never a product. Loaded after
// resection.js and bridge.js, before app.js. It replaces three host answers with
// a known scene so taps have known answers:
//   location.read  → a fixed viewpoint (clearly synthetic, 10 m accuracy)
//   net.http        → a synthetic aime-data index and landmark cells for a fixed
//                   feature set (tile requests pass through)
//   photos.library open → the real host open (ref/grant checks unchanged), with
//                   the pixels replaced by a rendered view of the scene
// camera.photo → the real host capture, with its API 0.13 capture metadata
//                   replaced by the scene's lens, tilt and magnetic heading
// List, delete, storage and grants are the real host. Fixture-only
// buttons inject one offline data request or one HTTP 503 cell, move the
// viewpoint outside the data coverage, cycle which capture metadata fields
// are returned, and read the stored record count, so acceptance can see error
// handling, measured-input fallbacks and sidecar reconciliation.
const SyntheticAime = (() => {
  const R = typeof Resection !== "undefined" ? Resection : require("../../examples/aime-module/ui/resection.js");
  const viewer = { lat: 46.8, lon: 9.2 },
    width = 1024,
    height = 768,
    pose = { heading: 30, fov: 66, pitch: 4, roll: 1.5, aspect: height / width };
  // Outside the synthetic coverage: an index with no cell there.
  const outside = { lat: 40.4168, lon: -3.7038 };
  // [letter, name, kind, e, w, p, bearing°, km]; weights follow the contract's
  // rule, p its provenance floors and footprints: 8 m OSM points, 16 m for a
  // church footprint, 10 m chapel, 60 m places-derived castle and monument,
  // 250 m places-only mountain. H lies in the next cell north; Z is beyond
  // every radius (distance filter).
  const defs = [
    ["A", "Synthetic Tower A", "tower", 80, 1.3, 8, 18, 6],
    ["B", "Synthetic Peak B", "peak", 2400, 1.5, 8, 42, 18],
    ["C", "Synthetic Church C", "church", 0, 1.1, 16, 30, 3],
    ["D", "Synthetic Castle D", "castle", 0, 1.1, 60, 51, 11],
    ["E", "Synthetic Mast E", "mast", 0, 1, 8, 45, 25],
    ["F", "Synthetic Monument F", "monument", 0, 1, 60, 200, 4],
    ["G", "Synthetic Chapel G", "chapel", 0, 0.6, 10, 9, 2],
    ["H", "Synthetic Transmitter H", "communication_tower", 160, 1.8, 8, 36, 28],
    ["Z", "Synthetic Far Peak Z", "peak", 1800, 1.5, 250, 235, 64],
  ];
  const round = (v) => Math.round(v * 1e5) / 1e5;
  const features = defs.map(([letter, name, kind, e, w, p, bearing, km]) => {
    const at = R.destination(viewer, bearing, km);
    return { letter, name, kind, e, w, p, bearing, km, lat: round(at.lat), lon: round(at.lon) };
  });
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
  // Synthetic aime-data (contract schema 1): index.json and the non-empty cells.
  const ORIGIN = "https://aime-data.pages.dev/",
    release = "synthetic-1",
    revision = 1,
    dataset = release + "-r" + revision,
    cellOf = (f) => Math.floor(f.lat) + "_" + Math.floor(f.lon),
    cells = [...new Set(features.map(cellOf))].sort();
  const index = () =>
    JSON.stringify({
      schema: 1,
      release,
      revision,
      dataset,
      built: "2026-09-27T00:00:00Z",
      cellDeg: 1,
      coverage: ["DE", "AT"],
      path: dataset + "/cells/",
      cells,
      license: "ODbL-1.0",
      attribution: "© OpenStreetMap contributors, Overture Maps Foundation",
      kinds: "peak hill volcano tower observation communication_tower mast bell_tower water_tower watchtower minaret lighthouse windmill chimney radar church cathedral chapel mosque synagogue temple monastery castle ruins fort tall_building gasometer cooling monument memorial bridge dam".split(" "),
    });
  // Additive field (degrees east, WMM at the cell centre): a plausible
  // synthetic value per cell, so the viewpoint cell's can be checked.
  const declinationOf = (name) => Math.round((3 + (Number(name.split("_")[0]) - 46) * 0.2 + (Number(name.split("_")[1]) - 9) * 0.3) * 10) / 10;
  const cell = (name) =>
    JSON.stringify({
      schema: 1,
      release,
      revision,
      cell: name.split("_").map(Number),
      declination: declinationOf(name),
      f: features
        .filter((f) => cellOf(f) === name)
        .sort((a, b) => b.w - a.w || a.name.localeCompare(b.name))
        .map((f) => [f.name, f.kind, f.lat, f.lon, f.e, f.w, f.p]),
    });
  // Data host answer for a URL, as net.http would return it.
  function answer(url) {
    if (url === ORIGIN + "v1/index.json") return { status: 200, headers: {}, text: index() };
    const m = url.match(/^https:\/\/aime-data\.pages\.dev\/v1\/synthetic-1-r1\/cells\/(-?\d+_-?\d+)\.json$/);
    return m && cells.includes(m[1]) ? { status: 200, headers: {}, text: cell(m[1]) } : { status: 404, headers: {} };
  }
  // API 0.13 capture metadata for the rendered view, in the host's shape: the
  // lens angle across the image as opened (h) and down it (v), the pose's tilt
  // in the solver's signs, and the heading as a magnetic reading that the
  // viewpoint cell's declination turns back into the true pose heading.
  // `mode` drops groups to exercise the fallbacks: "full", "no heading",
  // "no tilt", "no lens" or "none" (zoomRatio only).
  const CAPTURE_MODES = ["full", "no heading", "no tilt", "no lens", "none"];
  function capture(mode = "full") {
    const out = { zoomRatio: 1 },
      vfov = (2 * Math.atan(Math.tan((pose.fov * Math.PI) / 360) * pose.aspect) * 180) / Math.PI;
    if (mode === "full" || mode === "no heading" || mode === "no tilt") Object.assign(out, { fovDeg: { h: pose.fov, v: Math.round(vfov * 10) / 10 }, fovSigmaDeg: 1 });
    if (mode === "full" || mode === "no heading" || mode === "no lens") out.tilt = { pitchDeg: pose.pitch, rollDeg: pose.roll, sigmaDeg: 1, ageMs: 18 };
    if (mode === "full" || mode === "no tilt" || mode === "no lens")
      Object.assign(out, { headingDeg: Math.round((pose.heading - declinationOf(cellOf(viewer))) * 10) / 10, headingRef: "magnetic", headingAccuracyDeg: 10, headingAgeMs: 40 });
    return out;
  }
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
      if (f.kind === "peak") {
        g.moveTo(x - 120 * Math.min(1, s * 4), y);
        g.lineTo(x, y - 110);
        g.lineTo(x + 120 * Math.min(1, s * 4), y);
      } else if (["tower", "mast", "communication_tower"].includes(f.kind)) {
        g.rect(x - 4, y - 90, 8, 90);
      } else {
        g.rect(x - 16 * s, y - 40 * s, 32 * s, 40 * s);
        g.moveTo(x - 6 * s, y - 40 * s);
        g.lineTo(x, y - 70 * s);
        g.lineTo(x + 6 * s, y - 40 * s);
      }
      g.fill();
      g.fillStyle = "#fff";
      g.fillText(f.letter, x, y - (f.kind === "peak" ? 120 : 100));
    }
    g.fillStyle = "#fff";
    g.font = "16px sans-serif";
    g.textAlign = "left";
    g.fillText("SYNTHETIC SCENE — acceptance fixture, not a real view", 12, 24);
    return c.toDataURL("image/jpeg", 0.85);
  }
  function install() {
    const real = call;
    // Fixture-only failure injection: "offline" fails the next data request,
    // "503" the next cell request. Downloaded cells stay cached in the module,
    // so these apply to lookups not yet made in this session.
    let inject = null,
      away = false,
      metadata = 0;
    call = async function (method, params) {
      if (method === "location.read") {
        const at = away ? outside : viewer;
        return { latitude: at.lat, longitude: at.lon, accuracyM: 10, timestamp: Date.now() - 1500, approximate: false };
      }
      if (method === "net.http" && typeof params.url === "string" && params.url.startsWith(ORIGIN)) {
        const cellRequest = params.url.includes("/cells/");
        if (inject === "offline" || (inject === "503" && cellRequest)) {
          const once = inject;
          inject = null;
          if (once === "offline") throw Object.assign(new Error("Synthetic offline"), { code: "HTTP_UNAVAILABLE" });
          return { status: 503, headers: {} };
        }
        return answer(params.url);
      }
      const result = await real(method, params);
      if (method === "photos.library" && params.op === "open") return { ...result, url: render(), width, height };
      // The scene is fixed, so the real camera's zoom and sensors never apply.
      if (method === "camera.photo" && result && result.saved) return { ...result, capture: capture(CAPTURE_MODES[metadata]) };
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
      button("Fixture: next data offline", () => ((inject = "offline"), (out.textContent = "Next landmark data request: offline.")));
      button("Fixture: next cell 503", () => ((inject = "503"), (out.textContent = "Next landmark cell: HTTP 503.")));
      button("Fixture: next capture metadata", () => {
        metadata = (metadata + 1) % CAPTURE_MODES.length;
        out.textContent = "Capture metadata for new photos: " + CAPTURE_MODES[metadata] + ".";
      });
      button("Fixture: toggle outside coverage", () => {
        away = !away;
        out.textContent = away ? "Viewpoint: outside coverage for new photos." : "Viewpoint: synthetic scene for new photos.";
      });
      // Read-only view of the real module storage, so acceptance can see sidecar reconciliation.
      button("Fixture: count stored records", async () => {
        try {
          const index = await real("storage.kv", { op: "get", key: "photos.index" });
          out.textContent = "Stored photo records: " + ((index && index.slots) || []).filter(Boolean).length;
        } catch (error) {
          out.textContent = "Stored photo records unavailable: " + (error.code || "ERROR");
        }
      });
      document.getElementById("capture-note").after(note, tools, out);
    });
  }
  return { viewer, outside, width, height, pose, features, at, taps, release, revision, dataset, cells, index, cell, declinationOf, CAPTURE_MODES, capture, answer, install };
})();
if (typeof module !== "undefined") module.exports = SyntheticAime;
else SyntheticAime.install();
