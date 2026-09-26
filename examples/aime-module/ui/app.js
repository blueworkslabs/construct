"use strict";
// Aimé controller: library, capture with viewpoint fixes, photo view with taps,
// marks, horizon, bearing ruler and candidates. Maths lives in resection.js
// (unchanged reference solver), bookkeeping in aime-core.js.
const $ = (id) => document.getElementById(id);
const C = AimeCore,
  S = Resection;
const state = {
  items: [], // [{ref, id}] from the last successful list
  store: null, // {id: sidecar} or null when storage is unavailable
  storeError: null,
  thumbs: new Map(),
  thumbGeneration: 0,
  selectedId: null,
  image: null, // {url, width, height}
  cal: null,
  calError: null,
  mode: "mark",
  horizonExplained: false,
  pendingTap: null,
  lastTap: null,
  features: new Map(), // cacheKey → {features, incomplete}
  fetching: new Map(), // cacheKey → Promise
  fetchProblem: null,
  lastLocationAt: -Infinity,
  busy: false,
  photoGeneration: 0,
  refreshPending: false,
  view: { scale: 1, x: 0, y: 0 },
};

// ---- Host calls -------------------------------------------------------------
// One photos.library operation at a time: an open invalidates the previous
// raster and the host has a single photo worker.
let libraryQueue = Promise.resolve();
function library(params) {
  const run = libraryQueue.then(() => call("photos.library", params));
  libraryQueue = run.catch(() => {});
  return run;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function locate(respectSpacing) {
  const wait = state.lastLocationAt + C.LOCATION_SPACING_MS - Date.now();
  if (respectSpacing && wait > 0) await sleep(wait);
  state.lastLocationAt = Date.now();
  try {
    return { fix: C.fixFrom(await call("location.read", { op: "get" })), error: null };
  } catch (error) {
    return { fix: null, error };
  }
}
// Persistence: an index of up to 16 slots plus one bounded record per photo,
// each written in its own request (aime-core.js `persistence`).
const db = C.persistence({ get: (key) => call("storage.kv", { op: "get", key }), set: (key, value) => call("storage.kv", { op: "set", key, value }) });
async function loadStore() {
  state.storeError = await db.load();
  state.store = db.store;
}
async function putSidecar(id, sidecar) {
  await db.put(id, sidecar);
  state.store = db.store;
}
async function releaseExcept(keepIds) {
  try {
    await db.release(keepIds);
  } finally {
    state.store = db.store;
  }
}

// ---- Messages ---------------------------------------------------------------
const GATES = {
  CAPABILITY_DENIED: "Access is off for this action. Open Construct menu → Module access to check the grants.",
  ANDROID_PERMISSION_DENIED: "Android camera access is off. Allow it through Construct menu → Module access.",
  LOCATION_PERMISSION: "Location is denied, so this photo has no viewpoint.",
  LOCATION_UNAVAILABLE: "No location provider is available, so this photo has no viewpoint.",
  PHOTO_STALE: "The photo list changed. Reopen the photo from the list.",
  PHOTO_IDS: "This Construct version does not provide stable photo IDs. Update Construct to use Aimé.",
  STORAGE_UNAVAILABLE: "Storage access is off, so viewpoints and marks cannot be saved.",
};
function describe(error, gate) {
  const code = (error && error.code) || "ERROR";
  const base = code === "CAPABILITY_DENIED" && gate ? `${gate} access is off. Turn it on in Construct menu → Module access.` : GATES[code] || (error && error.message) || "Something went wrong.";
  return `[${code}] ${base}`;
}
function say(id, message, tone = "") {
  const el = $(id);
  el.textContent = message;
  el.className = tone;
}

// ---- Library ----------------------------------------------------------------
async function refresh() {
  const result = await library({ op: "list" });
  const ids = C.listIds(result);
  state.items = result.photos.map((p) => ({ ref: p.ref, id: p.id }));
  for (const id of [...state.thumbs.keys()]) if (!ids.includes(id)) state.thumbs.delete(id);
  // Reconcile only after this successful complete list; the write must succeed too.
  await releaseExcept(ids).catch(() => {});
  renderGrid();
  loadThumbs();
}
function caption(id, n) {
  const s = state.store && state.store[id];
  const where = !state.store ? "Viewpoint unknown (storage off)" : !s || !s.viewer ? "No viewpoint" : s.viewer.review ? "Viewpoint to confirm" : `Viewpoint ±${Math.round(s.viewer.accuracyM || 20)} m`;
  const marks = s && s.marks.length ? ` · ${s.marks.length} mark${s.marks.length > 1 ? "s" : ""}` : "";
  return { title: `Photo ${n}`, detail: where + marks };
}
function renderGrid() {
  const grid = $("grid");
  grid.replaceChildren();
  state.items.forEach((item, i) => {
    const li = document.createElement("li"),
      b = document.createElement("button"),
      img = document.createElement("img"),
      cap = document.createElement("span"),
      t = document.createElement("strong"),
      d = document.createElement("span"),
      text = caption(item.id, i + 1);
    img.className = "thumb";
    img.alt = "";
    if (state.thumbs.has(item.id)) img.src = state.thumbs.get(item.id);
    cap.className = "caption";
    t.textContent = text.title;
    d.textContent = text.detail;
    cap.append(t, d);
    b.append(img, cap);
    b.setAttribute("aria-label", `${text.title}. ${text.detail}`);
    b.onclick = () => task(() => openPhoto(item.id));
    li.append(b);
    grid.append(li);
  });
  $("empty").hidden = state.items.length > 0;
  $("take").disabled = state.busy;
}
async function thumbnail(url) {
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });
  try {
    const scale = 240 / Math.max(img.naturalWidth, img.naturalHeight),
      c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(img.naturalHeight * scale));
    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.8);
  } catch {
    return null;
  }
}
// Thumbnails load one by one while the grid is visible; opening a photo stops them.
async function loadThumbs() {
  const generation = ++state.thumbGeneration;
  for (const item of state.items) {
    if (generation !== state.thumbGeneration || !$("photo").hidden) return;
    if (state.thumbs.has(item.id)) continue;
    try {
      const data = await library({ op: "open", ref: item.ref });
      if (generation !== state.thumbGeneration) return;
      const thumb = await thumbnail(data.url);
      if (thumb) state.thumbs.set(item.id, thumb);
      renderGrid();
    } catch {
      return;
    }
  }
}
async function task(fn) {
  if (state.busy) return;
  state.busy = true;
  renderGrid();
  try {
    await fn();
  } catch (error) {
    const target = $("photo").hidden ? "status" : "photo-status";
    say(target, describe(error), "error");
  } finally {
    state.busy = false;
    renderGrid();
    if (state.refreshPending) {
      state.refreshPending = false;
      task(refresh);
    }
  }
}

// ---- Capture ----------------------------------------------------------------
async function takePhoto() {
  let before;
  try {
    before = C.listIds(await library({ op: "list" }));
  } catch (error) {
    say("status", describe(error, "Photo library"), "error");
    return;
  }
  say("status", "Getting your estimated viewpoint…");
  const first = await locate(false);
  const openedAt = Date.now();
  say("status", "Camera open. Use the main rear camera.");
  let saved;
  try {
    saved = (await call("camera.photo", { op: "capture" })).saved;
  } catch (error) {
    say("status", describe(error, "Camera"), "error");
    return;
  }
  if (!saved) {
    say("status", "Capture canceled. No photo saved; the location fix was discarded.");
    return;
  }
  const savedAt = Date.now();
  say("status", "Photo saved. Taking a second viewpoint fix…");
  const second = await locate(true);
  let after;
  try {
    const result = await library({ op: "list" });
    after = C.listIds(result);
    state.items = result.photos.map((p) => ({ ref: p.ref, id: p.id }));
  } catch (error) {
    say("status", "Photo saved, but the library could not be listed, so it stays without a viewpoint. " + describe(error, "Photo library"), "attention");
    return;
  }
  const id = C.associate(before, after),
    chosen = C.chooseViewpoint(first.fix, second.fix, openedAt, savedAt);
  let note = "";
  if (!id) note = "Photo saved, but it could not be matched to this capture, so it has no viewpoint.";
  else if (!state.store) note = "Photo saved. Storage access is off, so its viewpoint was not saved.";
  else {
    try {
      await releaseExcept(after).catch(() => {});
      await putSidecar(id, C.newSidecar(chosen ? chosen.viewer : null));
      if (!chosen) note = "Photo saved without a viewpoint: " + (second.error || first.error ? describe(second.error || first.error, "Location") : "no usable location fix.");
      else if (chosen.reasons.length) note = `Photo saved. Please confirm the viewpoint (${chosen.reasons.join(", ")}).`;
    } catch (error) {
      note = "Photo saved, but its viewpoint could not be stored. " + describe(error, "Storage");
    }
  }
  renderGrid();
  if (id) {
    say("status", "");
    await openPhoto(id);
    if (note) say("photo-status", note, "attention");
  } else say("status", note, "attention");
}

// ---- Photo view ---------------------------------------------------------------
const current = () => (state.store && state.store[state.selectedId]) || C.newSidecar(null);
async function openPhoto(id) {
  const generation = ++state.photoGeneration;
  state.thumbGeneration++;
  let item = state.items.find((p) => p.id === id);
  if (!item) throw Object.assign(new Error("That photo is no longer in the library."), { code: "PHOTO_STALE" });
  let data;
  try {
    data = await library({ op: "open", ref: item.ref });
  } catch (error) {
    if (error.code !== "PHOTO_STALE") throw error;
    await refresh();
    item = state.items.find((p) => p.id === id);
    if (!item) throw error;
    data = await library({ op: "open", ref: item.ref });
  }
  await new Promise((resolve, reject) => {
    const img = $("picture");
    img.onload = resolve;
    img.onerror = () => reject(new Error("Photo could not be displayed."));
    img.src = data.url;
  });
  if (generation !== state.photoGeneration) return;
  state.selectedId = id;
  state.image = { url: data.url, width: data.width, height: data.height };
  state.lastTap = null;
  state.pendingTap = null;
  state.view = { scale: 1, x: 0, y: 0 };
  $("library").hidden = true;
  $("photo").hidden = false;
  $("back").hidden = false;
  const s = current();
  $("radius").value = String(s.radiusKm);
  setMode(s.marks.length ? "what" : "mark");
  say("photo-status", "");
  recalibrate();
  layout();
  render();
}
function showLibrary() {
  state.photoGeneration++;
  $("photo").hidden = true;
  $("library").hidden = false;
  $("back").hidden = true;
  state.selectedId = null;
  if (state.busy) state.refreshPending = true;
  else task(refresh);
}
function recalibrate() {
  const s = current();
  state.cal = null;
  state.calError = null;
  if (!s.viewer || !s.marks.length || !state.image) return;
  try {
    state.cal = S.calibrate(C.calibrationInput(s, state.image.width, state.image.height));
  } catch (error) {
    state.calError = error.message;
  }
}
async function update(change) {
  const next = C.cleanSidecar(change(structuredClone(current())));
  await putSidecar(state.selectedId, next);
  recalibrate();
  render();
}
function setMode(mode) {
  state.mode = mode;
  for (const m of ["mark", "horizon", "what"]) $("mode-" + m).setAttribute("aria-pressed", String(m === mode));
  render();
}
function hint() {
  const s = current();
  if (!s.viewer) return "This photo has no usable viewpoint, so Aimé cannot look up landmarks yet. Setting the viewpoint on the map arrives with the map view.";
  if (s.viewer.review) return "Check the estimated viewpoint above before looking up landmarks.";
  if (state.mode === "mark") return s.marks.length ? `Tap another landmark you know to fit the lens (optional). ${s.marks.length}/${C.MAX_MARKS} marked.` : "Tap a landmark you know, like a church tower or summit, then pick it from the list.";
  if (state.mode === "horizon") return `Tap a true level horizon: ${s.horizon.length}/${C.MAX_HORIZON} points.`;
  return state.cal ? "Tap anything to see what it could be." : "Mark a landmark you know first.";
}
function render() {
  if ($("photo").hidden) return;
  const s = current(),
    v = s.viewer;
  const vp = $("viewpoint");
  if (!v) {
    vp.textContent = "No usable viewpoint for this photo.";
    vp.className = "attention";
  } else {
    const ageText = v.timestamp ? C.age(Date.now() - v.timestamp) + " old" : "age unknown";
    vp.textContent = `${v.corrected ? "Corrected" : "Estimated"} viewpoint · ±${Math.round(v.accuracyM || 20)} m · ${ageText}${v.approximate ? " · approximate location" : ""}${v.review ? " · please confirm" : ""}`;
    vp.className = v.review ? "attention" : "";
  }
  $("confirm-viewpoint").hidden = !(v && v.review);
  const chips = $("chips");
  chips.replaceChildren();
  const chip = (label, tone = "") => {
    const c = document.createElement("span");
    c.className = "chip " + tone;
    c.textContent = label;
    chips.append(c);
  };
  if (state.cal) {
    chip(`Calibrated · ${state.cal.marks} mark${state.cal.marks > 1 ? "s" : ""}`, "live");
    if (state.cal.lens === "fitted") chip("Lens fitted", "live");
    if (state.cal.level === "fitted") chip("Level estimated", "live");
    if (state.cal.viewpoint === "refined") chip("Viewpoint refined", "live");
    chip(`Centre ±${S.uncertainty(state.cal, 0.5, 0.5).toFixed(1)}°`);
  } else if (state.calError) chip(state.calError, "attention");
  else chip("Not calibrated");
  if (!state.cal && state.mode === "what") {
    // Removing the last mark ends calibration: fall back to marking.
    state.mode = "mark";
    for (const m of ["mark", "horizon", "what"]) $("mode-" + m).setAttribute("aria-pressed", String(m === "mark"));
  }
  $("hint").textContent = hint();
  $("mode-what").disabled = !state.cal;
  $("mode-mark").disabled = $("mode-horizon").disabled = !v;
  const list = (id, rows, empty) => {
    const ul = $(id);
    ul.replaceChildren();
    if (!rows.length) {
      const li = document.createElement("li"),
        span = document.createElement("span");
      span.textContent = empty;
      li.append(span);
      ul.append(li);
    }
    for (const [label, detail, remove] of rows) {
      const li = document.createElement("li"),
        span = document.createElement("span"),
        small = document.createElement("small"),
        b = document.createElement("button");
      span.textContent = label;
      small.textContent = detail;
      span.append(small);
      b.textContent = "Remove";
      b.className = "quiet";
      b.setAttribute("aria-label", "Remove " + label);
      b.onclick = () => task(() => update(remove));
      li.append(span, b);
      ul.append(li);
    }
  };
  list(
    "marks",
    s.marks.map((m, i) => [
      m.name,
      `${m.osmType}/${m.osmId}${v ? " · " + C.km(S.distance(v, m)) + " · " + Math.round(S.bearing(v, m)) + "°" : ""}${state.cal ? " · residual " + C.signed(S.diff(S.bearingAt(state.cal, m.x, m.y), S.bearing(state.cal.viewer, m))) : ""}`,
      (x) => ({ ...x, marks: x.marks.filter((_, j) => j !== i) }),
    ]),
    "None yet.",
  );
  list(
    "horizon-points",
    s.horizon.map((h, i) => [`Point ${i + 1}`, `at ${Math.round(h.x * 100)} % across, ${Math.round(h.y * 100)} % down`, (x) => ({ ...x, horizon: x.horizon.filter((_, j) => j !== i) })]),
    "None. Optional: levels tilted photos.",
  );
  drawOverlay();
  drawRuler();
}

// ---- Stage geometry, zoom and taps ---------------------------------------------
// The photo fits the column width, capped so it stays on screen in landscape.
function stageSize() {
  const aspect = state.image ? state.image.height / state.image.width : 0.75,
    available = $("photo").clientWidth || $("stage").clientWidth,
    w = Math.max(160, Math.min(available, Math.round((window.innerHeight * 0.8) / aspect)));
  return { w, h: Math.round(w * aspect) };
}
function layout() {
  if (!state.image) return;
  const { w, h } = stageSize();
  $("stage").style.width = $("ruler").style.width = w + "px";
  $("stage").style.height = h + "px";
  $("frame").style.width = w + "px";
  $("frame").style.height = h + "px";
  $("overlay").setAttribute("viewBox", `0 0 1000 ${Math.round(1000 * (h / w))}`);
  clampView();
  applyView();
}
function clampView() {
  const { w, h } = stageSize(),
    v = state.view;
  v.scale = Math.max(1, Math.min(8, v.scale));
  v.x = Math.min(0, Math.max(w - w * v.scale, v.x));
  v.y = Math.min(0, Math.max(h - h * v.scale, v.y));
}
function applyView() {
  const v = state.view;
  $("frame").style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.scale})`;
  drawOverlay();
  drawRuler();
}
function zoomAt(factor, cx, cy) {
  const v = state.view,
    next = Math.max(1, Math.min(8, v.scale * factor));
  v.x = cx - ((cx - v.x) * next) / v.scale;
  v.y = cy - ((cy - v.y) * next) / v.scale;
  v.scale = next;
  clampView();
  applyView();
}
function normalised(clientX, clientY) {
  const r = $("frame").getBoundingClientRect();
  return { x: (clientX - r.left) / r.width, y: (clientY - r.top) / r.height };
}
(() => {
  const stage = $("stage"),
    pointers = new Map();
  let drag = null,
    pinch = null;
  stage.addEventListener("pointerdown", (e) => {
    if (e.target.closest(".zoom")) return;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()],
        r = stage.getBoundingClientRect();
      const cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
      pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: state.view.scale,
        anchorX: (cx - state.view.x) / state.view.scale, anchorY: (cy - state.view.y) / state.view.scale };
      drag = null;
    } else if (pointers.size === 1) drag = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: state.view.x, vy: state.view.y, moved: false };
  });
  stage.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()],
        target = (pinch.scale * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.distance,
        r = stage.getBoundingClientRect();
      state.view.scale = Math.max(1, Math.min(8, target));
      state.view.x = (a.x + b.x) / 2 - r.left - pinch.anchorX * state.view.scale;
      state.view.y = (a.y + b.y) / 2 - r.top - pinch.anchorY * state.view.scale;
      clampView();
      applyView();
    } else if (drag && drag.id === e.pointerId) {
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y;
      if (Math.hypot(dx, dy) > 8) drag.moved = true;
      if (drag.moved && state.view.scale > 1) {
        state.view.x = drag.vx + dx;
        state.view.y = drag.vy + dy;
        clampView();
        applyView();
      }
    }
  });
  const release = (e) => {
    const wasPinch = !!pinch;
    pointers.delete(e.pointerId);
    if (pinch && pointers.size < 2) pinch = null;
    if (wasPinch) {
      drag = null;
      return;
    }
    if (!drag || drag.id !== e.pointerId) return;
    const tap = !drag.moved && e.type === "pointerup";
    drag = null;
    if (tap) {
      const p = normalised(e.clientX, e.clientY);
      if (p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1) onTap(p.x, p.y);
    }
  };
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);
  stage.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - r.left, e.clientY - r.top);
    },
    { passive: false },
  );
  const centre = () => stageSize();
  $("zoom-in").onclick = () => zoomAt(1.5, centre().w / 2, centre().h / 2);
  $("zoom-out").onclick = () => zoomAt(1 / 1.5, centre().w / 2, centre().h / 2);
  $("zoom-reset").onclick = () => {
    state.view = { scale: 1, x: 0, y: 0 };
    applyView();
  };
})();
function onTap(x, y) {
  if (state.busy) return;
  const s = current();
  if (!s.viewer) return say("photo-status", "This photo has no usable viewpoint yet.", "attention");
  if (s.viewer.review) return say("photo-status", "Confirm the estimated viewpoint first.", "attention");
  if (state.mode === "mark") {
    if (s.marks.length >= C.MAX_MARKS) return say("photo-status", `At most ${C.MAX_MARKS} marks per photo. Remove one first.`, "attention");
    state.pendingTap = { x, y };
    drawOverlay();
    openMarkDialog();
  } else if (state.mode === "horizon") {
    if (s.horizon.length >= C.MAX_HORIZON) return say("photo-status", "Two horizon points are set. Remove one to change it.", "attention");
    task(async () => {
      await update((x0) => ({ ...x0, horizon: [...x0.horizon, { x, y }] }));
      const n = current().horizon.length;
      say("photo-status", n < C.MAX_HORIZON ? "Horizon point saved. Tap a second point well apart from the first." : state.cal && state.cal.level === "fitted" ? "Horizon levelled. Level estimated." : "Horizon points saved.");
      if (n >= C.MAX_HORIZON) setMode(state.cal ? "what" : "mark");
    });
  } else {
    if (!state.cal) return say("photo-status", "Mark a landmark you know first.", "attention");
    state.lastTap = { x, y };
    drawOverlay();
    drawRuler();
    task(() => whatsThat(x, y));
  }
}

// ---- Overlay and ruler ---------------------------------------------------------
const SVG = "http://www.w3.org/2000/svg";
function svg(tag, attrs) {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}
function drawOverlay() {
  const o = $("overlay");
  if (!state.image || $("photo").hidden) return;
  o.replaceChildren();
  const { w, h } = stageSize(),
    unit = 1000 / (w * state.view.scale),
    H = 1000 * (h / w),
    px = (n) => n * unit,
    s = current();
  const dot = (x, y, fill, label, ring = false) => {
    o.append(svg("circle", { cx: x * 1000, cy: y * H, r: px(ring ? 11 : 7), fill: ring ? "none" : fill, stroke: ring ? fill : "#06110B", "stroke-width": px(ring ? 3 : 2) }));
    if (label) {
      const t = svg("text", { x: x * 1000 + px(12), y: y * H - px(10), fill: "#fff", stroke: "#000", "stroke-width": px(3), "paint-order": "stroke", "font-size": px(14), "font-family": "system-ui, sans-serif" });
      t.textContent = label;
      o.append(t);
    }
  };
  if (state.cal && s.horizon.length) {
    const pts = [];
    for (let i = 0; i <= 20; i++) {
      const x = i / 20;
      pts.push(`${x * 1000},${S.horizonRow(state.cal, x) * H}`);
    }
    o.append(svg("polyline", { points: pts.join(" "), fill: "none", stroke: state.cal.level === "fitted" ? "#5FD3A0" : "#E9C46A", "stroke-width": px(2), "stroke-dasharray": state.cal.level === "fitted" ? "none" : `${px(8)} ${px(6)}` }));
  }
  s.horizon.forEach((p) => dot(p.x, p.y, "#E9C46A", "", true));
  s.marks.forEach((m, i) => dot(m.x, m.y, "#5FD3A0", `${i + 1} ${m.name}`));
  if (state.pendingTap) dot(state.pendingTap.x, state.pendingTap.y, "#8CF0C4", "", true);
  if (state.lastTap) dot(state.lastTap.x, state.lastTap.y, "#F08A7E", "?", true);
}
function drawRuler() {
  const canvas = $("ruler-canvas"),
    label = $("ruler-label");
  if ($("photo").hidden) return;
  const dpr = window.devicePixelRatio || 1,
    W = stageSize().w,
    Hh = canvas.clientHeight || 30;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(Hh * dpr);
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, Hh);
  if (!state.cal) {
    label.textContent = "Mark a landmark you know to calibrate";
    return;
  }
  const row = state.lastTap ? state.lastTap.y : state.pendingTap ? state.pendingTap.y : 0.5;
  label.textContent = state.lastTap ? "Bearings along the row you tapped" : "Bearings along the middle row";
  const { w } = stageSize(),
    v = state.view,
    xAt = (cx) => (cx - v.x) / (w * v.scale);
  const span = Math.abs(S.diff(S.bearingAt(state.cal, xAt(W), row), S.bearingAt(state.cal, xAt(0), row))) || 1;
  const step = span / (W / 60) < 2 ? 2 : span / (W / 60) < 5 ? 5 : span / (W / 60) < 10 ? 10 : 30;
  g.strokeStyle = "#9DB3A6";
  g.fillStyle = "#E6F0EA";
  g.font = "11px system-ui, sans-serif";
  g.textAlign = "center";
  const labelStep = step >= 30 ? step : step * 2;
  // Unwrapped bearings across the visible columns; a tick wherever a multiple
  // of `step` is crossed between two samples.
  let prev = S.bearingAt(state.cal, xAt(0), row);
  for (let cx = 2; cx <= W; cx += 2) {
    const cur = prev + S.diff(S.bearingAt(state.cal, xAt(cx), row), prev),
      lo = Math.min(prev, cur),
      hi = Math.max(prev, cur);
    for (let t = Math.floor(lo / step) * step + step; t <= hi; t += step) {
      const b = Math.round(S.wrap(t)),
        major = b % labelStep === 0;
      g.beginPath();
      g.moveTo(cx, 0);
      g.lineTo(cx, major ? 12 : 6);
      g.stroke();
      if (major) g.fillText(b % 45 === 0 ? `${C.compass(b)} ${b}°` : b + "°", cx, 25);
    }
    prev = cur;
  }
}

// ---- Features and marks -----------------------------------------------------------
function currentKey() {
  const s = current();
  return C.cacheKey(s.viewer, s.radiusKm);
}
async function features() {
  const s = current();
  if (!C.queryable(s.viewer)) throw Object.assign(new Error("Confirm the viewpoint first."), { code: "VIEWPOINT" });
  const key = currentKey();
  if (state.features.has(key)) return state.features.get(key);
  if (!state.fetching.has(key)) {
    const job = (async () => {
      let response;
      try {
        response = await call("net.http", { op: "get", url: C.overpassUrl(s.viewer.lat, s.viewer.lon, s.radiusKm), format: "json" });
      } catch (error) {
        throw Object.assign(new Error(C.httpProblem(error).message), { problem: C.httpProblem(error) });
      }
      if (response.status !== 200) throw Object.assign(new Error(C.httpProblem(null, response.status).message), { problem: C.httpProblem(null, response.status) });
      const parsed = C.parseOverpass(response.text);
      state.features.set(key, parsed);
      return parsed;
    })();
    state.fetching.set(key, job);
    job.catch(() => {}).finally(() => state.fetching.delete(key));
  }
  return state.fetching.get(key);
}
let markRequest = 0;
async function openMarkDialog() {
  const request = ++markRequest, generation = state.photoGeneration;
  const dialog = $("mark-dialog");
  $("search").value = "";
  $("results").replaceChildren();
  $("incomplete").hidden = true;
  $("retry-fetch").hidden = true;
  if (!dialog.open) dialog.showModal();
  say("fetch-status", `Looking up named landmarks within ${current().radiusKm} km…`);
  try {
    const data = await features();
    if (!dialog.open || request !== markRequest || generation !== state.photoGeneration) return;
    say("fetch-status", data.features.length ? `${data.features.length} landmarks within ${current().radiusKm} km. Nearest first.` : `No named landmarks found within ${current().radiusKm} km. Try a larger radius.`);
    $("incomplete").hidden = !data.incomplete;
    $("smaller-radius").hidden = current().radiusKm === 10;
    renderResults();
  } catch (error) {
    if (!dialog.open || request !== markRequest || generation !== state.photoGeneration) return;
    say("fetch-status", `[${(error.problem && error.problem.code) || error.code || "ERROR"}] ${error.message}`, "error");
    $("retry-fetch").hidden = !(error.problem ? error.problem.retry : true);
  }
}
function renderResults() {
  const data = state.features.get(currentKey()),
    ul = $("results");
  ul.replaceChildren();
  if (!data) return;
  for (const { feature: f, distanceM } of C.search(data.features, $("search").value, current().viewer)) {
    const li = document.createElement("li"),
      b = document.createElement("button"),
      small = document.createElement("small");
    b.textContent = f.name;
    small.textContent = `${C.kindLabel(f)} · ${C.km(distanceM / 1000)} · ${f.osmType}/${f.osmId}`;
    b.append(small);
    b.onclick = () => pick(f);
    li.append(b);
    ul.append(li);
  }
  if (!ul.children.length) {
    const li = document.createElement("li"),
      span = document.createElement("span");
    span.textContent = "No match in the fetched landmarks.";
    li.append(span);
    ul.append(li);
  }
}
function pick(feature) {
  const tap = state.pendingTap;
  if (!tap) return;
  $("mark-dialog").close();
  state.pendingTap = null;
  task(async () => {
    const mark = C.markFrom(feature, tap.x, tap.y);
    await update((s) => ({ ...s, marks: [...s.marks.filter((m) => !(m.osmType === mark.osmType && m.osmId === mark.osmId)), mark] }));
    if (state.calError) say("photo-status", "Mark saved, but calibration failed: " + state.calError, "attention");
    else if (current().marks.length === 1) {
      say("photo-status", `Calibrated on ${mark.name}. Mark another to fit the lens, or tap What’s that?`);
      setMode("what");
    } else say("photo-status", `${mark.name} marked. ${state.cal.lens === "fitted" ? "Lens fitted." : "Lens still assumed; marks further apart help."}`);
  });
}

// ---- What's that? --------------------------------------------------------------
async function whatsThat(x, y) {
  const generation = state.photoGeneration;
  let data;
  try {
    data = await features();
  } catch (error) {
    if (generation !== state.photoGeneration) return;
    say("photo-status", `[${(error.problem && error.problem.code) || error.code || "ERROR"}] ${error.message}`, "error");
    return;
  }
  if (generation !== state.photoGeneration) return;
  const ranked = S.rank(state.cal, x, y, C.candidatesOf(data.features)),
    list = C.shortlist(ranked),
    ol = $("candidates");
  ol.replaceChildren();
  const wedge = ranked.length ? ranked[0].wedgeSigmaDeg : S.uncertainty(state.cal, x, y);
  $("candidates-title").textContent = list.anyClose ? "Could be" : "No close match";
  $("candidates-note").textContent = `Your tap points ${Math.round(S.bearingAt(state.cal, x, y))}° (${C.compass(S.bearingAt(state.cal, x, y))}), direction ±${wedge.toFixed(1)}°.` + (list.anyClose ? "" : " Nearest two shown greyed.");
  let positionNote = false;
  list.rows.forEach((r) => {
    const li = document.createElement("li"),
      small = document.createElement("small"),
      f = r.candidate.feature;
    li.className = r.greyed ? "greyed" : "";
    li.textContent = `${r.greyed ? "" : "Could be "}${f.name}`;
    small.textContent = `${C.kindLabel(f)} · ${C.km(r.distanceKm)} · ${C.signed(r.deltaDeg)} from your tap · ±${r.sigmaDeg.toFixed(1)}°${r.close ? "" : " · not close"}`;
    if (C.positionMatters(r)) positionNote = true;
    li.append(small);
    ol.append(li);
  });
  if (!list.rows.length) {
    const li = document.createElement("li");
    li.textContent = "No named landmarks fetched for this radius.";
    ol.append(li);
  }
  const extra = [];
  if (positionNote) extra.push("Some candidates are close by, so your position matters more: their ±σ is wider than the direction.");
  if (data.incomplete) extra.push("Incomplete: the 400-feature limit was reached. A smaller radius may show more nearby landmarks.");
  $("candidates-extra").textContent = extra.join(" ");
  $("candidates-dialog").showModal();
  say("photo-status", list.anyClose ? `Closest: ${list.rows[0].candidate.feature.name}, ±${list.rows[0].sigmaDeg.toFixed(1)}°.` : "No close match for that tap.");
}

// ---- Wiring ---------------------------------------------------------------------
$("take").onclick = () => task(takePhoto);
$("back").onclick = showLibrary;
$("mode-mark").onclick = () => setMode("mark");
$("mode-what").onclick = () => setMode("what");
$("mode-horizon").onclick = () => {
  if (state.horizonExplained) return setMode("horizon");
  $("horizon-dialog").showModal();
};
$("start-horizon").onclick = () => {
  state.horizonExplained = true;
  $("horizon-dialog").close();
  setMode("horizon");
};
$("skip-horizon").onclick = () => $("horizon-dialog").close();
$("confirm-viewpoint").onclick = () =>
  task(async () => {
    await update((s) => ({ ...s, viewer: { ...s.viewer, review: false } }));
    say("photo-status", "Viewpoint confirmed.");
  });
$("radius").onchange = () =>
  task(async () => {
    const radiusKm = Number($("radius").value);
    await update((s) => ({ ...s, radiusKm }));
    say("photo-status", `Radius ${radiusKm} km. Landmarks are looked up again when needed; your marks are kept.`);
  });
$("search").oninput = renderResults;
$("retry-fetch").onclick = openMarkDialog;
$("smaller-radius").onclick = () => {
  const smaller = C.RADII.filter((r) => r < current().radiusKm).pop();
  if (!smaller) return;
  $("radius").value = String(smaller);
  task(async () => {
    await update((s) => ({ ...s, radiusKm: smaller }));
    await openMarkDialog();
  });
};
$("cancel-mark").onclick = () => {
  $("mark-dialog").close();
};
$("mark-dialog").addEventListener("close", () => {
  markRequest++;
  state.pendingTap = null;
  drawOverlay();
});
$("close-candidates").onclick = () => $("candidates-dialog").close();
$("delete").onclick = () =>
  task(async () => {
    const id = state.selectedId,
      item = state.items.find((p) => p.id === id);
    if (!item) return;
    const r = await library({ op: "delete", ref: item.ref });
    if (!r.completed) return say("photo-status", "Delete canceled. Photo unchanged.");
    state.thumbs.delete(id);
    await releaseExcept(state.items.map((p) => p.id).filter((x) => x !== id)).catch(() => {});
    $("photo").hidden = true;
    $("library").hidden = false;
    $("back").hidden = true;
    state.selectedId = null;
    await refresh();
    say("status", "Photo deleted.");
  });
// Re-fit when the column width changes (rotation, text size, a scrollbar appearing).
let fittedWidth = 0;
new ResizeObserver(() => {
  const width = $("photo").clientWidth;
  if ($("photo").hidden || !width || width === fittedWidth) return;
  fittedWidth = width;
  layout();
  render();
}).observe($("photo"));
window.addEventListener("resize", () => {
  layout();
  render();
});
task(async () => {
  await loadStore();
  if (state.storeError) say("status", describe(state.storeError, "Storage") + " Viewpoints and marks cannot be saved.", "attention");
  try {
    await refresh();
  } catch (error) {
    say("status", describe(error, "Photo library"), "error");
  }
});
