"use strict";
// Aimé controller: library, capture with viewpoint fixes, photo view with taps,
// a magnifier on hold, movable marks and horizon points with one-step undo,
// bearing ruler, candidates, the map with its distance ruler and a map pin (or
// a candidate) shown in the photo. Maths lives in
// resection.js (unchanged reference solver), bookkeeping in aime-core.js.
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
  preview: null, // sidecar with a point being dragged; stored only on release
  undo: null, // {id, label, marks, horizon} before the last point edit
  pin: null, // {point, name?, positionM?}: map long-press or a candidate's "Show in photo"
  pinLoc: null, // Resection.locate(cal, pin) for the current calibration
  lastList: null, // {rows, wedge, bearing} from the last What's that?
  pane: "photo",
  features: new Map(), // cacheKey → {features, dataset, cells}
  fetching: new Map(), // cacheKey → Promise
  data: null, // landmark index and cells for this session (aime-core.js `landmarkData`)
  lastLocationAt: -Infinity,
  busy: false,
  photoGeneration: 0,
  refreshPending: false,
  visible: true,
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
// Landmark data from the aime-data host: HTTP failures become "unavailable".
async function dataGet(url) {
  let response;
  try {
    response = await call("net.http", { op: "get", url, format: "json" });
  } catch (error) {
    throw C.httpProblem(error);
  }
  if (response.status !== 200) throw C.httpProblem(null, response.status);
  return response.text;
}
state.data = C.landmarkData(dataGet);
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
    renderUndo();
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
const saved = () => (state.store && state.store[state.selectedId]) || C.newSidecar(null),
  current = () => state.preview || saved();
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
  state.lastList = null;
  state.pendingTap = null;
  state.undo = null;
  state.pin = null;
  gestures.cancel();
  map.setRuler(false);
  renderRuler();
  state.view = { scale: 1, x: 0, y: 0 };
  $("library").hidden = true;
  $("photo").hidden = false;
  $("back").hidden = false;
  const s = current();
  $("radius").value = String(s.radiusKm);
  setMode(s.marks.length ? "what" : "mark");
  say("photo-status", "");
  recalibrate();
  showPane(s.viewer ? "photo" : "map", true);
}
function showLibrary() {
  gestures.cancel();
  map.pause(true);
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
  // A changed calibration/radius invalidates every previously ranked result.
  state.lastList = null;
  state.lastTap = null;
  recalibrate();
  render();
  if (state.pane === "map") renderMap(false);
}
// Point edits (add, move, remove) keep one undo step, recorded once the write succeeded.
async function edit(label, change) {
  const step = C.undoStep(state.selectedId, saved(), label);
  await update(change);
  state.undo = step;
  renderUndo();
}
function renderUndo() {
  const step = state.undo && state.undo.id === state.selectedId ? state.undo : null;
  $("undo").disabled = !step || state.busy;
  $("undo").textContent = step ? "Undo " + step.label : "Undo";
}
// Where distances and bearings are measured from: the viewpoint fitted from the
// marks, else the saved one.
function origin() {
  const v = current().viewer;
  if (!v) return null;
  const fitted = state.cal && S.distance(v, state.cal.viewer) * 1000 > 1;
  return { point: fitted ? state.cal.viewer : v, fitted };
}
// ---- Map pin in the photo -------------------------------------------------------
// Where the pin lies in the photo, or null without a pin or a calibration.
function pinLocation() {
  if (!state.pin || !state.cal) return null;
  try {
    return S.locate(state.cal, { point: state.pin.point, positionM: state.pin.positionM });
  } catch {
    return null;
  }
}
function pinStatus() {
  const p = state.pin,
    name = p.name || "Pin",
    o = origin();
  if (state.pinLoc) return C.pinText(state.pinLoc, name);
  const where = o ? ` · ${C.range(S.distance(o.point, p.point), S.bearing(o.point, p.point))}` : "";
  return `${name}${where}. Mark a landmark you know in the photo first; then the photo shows where it lies.`;
}
function renderPin() {
  $("pin-tools").hidden = !state.pin;
  if (!state.pin) return;
  $("pin-status").textContent = pinStatus();
  $("pin-show").hidden = state.pane === "photo";
}
function setPin(pin) {
  state.pin = pin;
  render();
  if (state.pane === "map") renderMap(false);
}
function setMode(mode) {
  state.mode = mode;
  for (const m of ["mark", "horizon", "what"]) $("mode-" + m).setAttribute("aria-pressed", String(m === mode));
  render();
}
function hint() {
  const s = current();
  if (!s.viewer) return "This photo has no usable viewpoint. Set where you stood on the map before marking landmarks.";
  if (s.viewer.review) return "Check the estimated viewpoint: confirm it, or drag it on the map to where you stood.";
  const precise = s.marks.length || s.horizon.length ? " Press and hold to magnify; drag a point to move it." : " Press and hold to magnify.";
  if (state.mode === "mark") return (s.marks.length ? `Tap another landmark you know to fit the lens (optional). ${s.marks.length}/${C.MAX_MARKS} marked.` : "Tap a landmark you know, like a church tower or summit, then pick it from the list.") + precise;
  if (state.mode === "horizon") return `Tap a true level horizon: ${s.horizon.length}/${C.MAX_HORIZON} points.` + precise;
  return state.cal ? "Tap anything to see what it could be." + precise : "Mark a landmark you know first.";
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
    for (const [label, detail, remove, name] of rows) {
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
      b.onclick = () => task(() => edit("removing " + name, remove));
      li.append(span, b);
      ul.append(li);
    }
  };
  const o = origin();
  $("range-note").textContent = o && s.marks.length ? `Distance and bearing from ${o.fitted ? "the viewpoint fitted from your marks" : "your viewpoint"}.` : "";
  list(
    "marks",
    s.marks.map((m, i) => [
      m.name,
      `${C.kindLabel(m)}${o ? " · " + C.range(S.distance(o.point, m), S.bearing(o.point, m)) : ""}${state.cal ? " · residual " + C.signed(S.diff(S.bearingAt(state.cal, m.x, m.y), S.bearing(state.cal.viewer, m))) : ""}`,
      (x) => ({ ...x, marks: x.marks.filter((_, j) => j !== i) }),
      m.name,
    ]),
    "None yet.",
  );
  list(
    "horizon-points",
    s.horizon.map((h, i) => [`Point ${i + 1}`, `at ${Math.round(h.x * 100)} % across, ${Math.round(h.y * 100)} % down`, (x) => ({ ...x, horizon: x.horizon.filter((_, j) => j !== i) }), `horizon point ${i + 1}`]),
    "None. Optional: levels tilted photos.",
  );
  renderUndo();
  state.pinLoc = pinLocation();
  renderPin();
  drawOverlay();
  drawRuler();
  $("mode-mark").title = $("mode-horizon").title = v ? "" : "Set the viewpoint on the map first";
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
// One finger: a short tap acts at once, as before. Press and hold (or slide at
// fit, as in Pocket Measure) shows the magnifier and release places the point
// under the finger. Pressing on a mark or horizon point and dragging moves it:
// the fit updates live, one frame at a time, and storage is written on release.
// Zoomed in, a drag from empty photo pans; two fingers pinch.
const gestures = (() => {
  const stage = $("stage"),
    pointers = new Map();
  let g = null, // {id, x, y, vx, vy, finger, moved, hold, pan, hit, drag}
    pinch = null,
    completedTap = null,
    holdTimer = 0,
    tapTimer = 0,
    frame = 0;
  const local = (e) => {
    const r = stage.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  // Pointer-driven redraws coalesce to one per frame: live fit, then the loupe.
  const paint = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (!g || !(g.drag || g.hold)) return;
      if (g.drag) {
        recalibrate();
        render();
      }
      drawLoupe(g.finger, g.drag ? g.drag.preview[g.hit.list][g.hit.index] : normalisedLocal(g.finger), g.drag ? g.hit : null);
    });
  };
  function cancel() {
    clearTimeout(holdTimer);
    clearTimeout(tapTimer);
    completedTap = null;
    if (g && g.drag) {
      g.drag.cancel();
      endPreview();
    }
    g = null;
    hideLoupe();
  }
  const fireTap = () => {
    clearTimeout(tapTimer);
    const p = completedTap;
    completedTap = null;
    if (p) onTap(p.x, p.y);
  };
  stage.addEventListener("pointerdown", (e) => {
    completedTap = null;
    clearTimeout(tapTimer);
    if (e.target.closest(".zoom")) return;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      cancel();
      const [a, b] = [...pointers.values()],
        r = stage.getBoundingClientRect();
      const cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
      pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: state.view.scale,
        anchorX: (cx - state.view.x) / state.view.scale, anchorY: (cy - state.view.y) / state.view.scale };
    } else if (pointers.size === 1) {
      const p = normalised(e.clientX, e.clientY),
        { w, h } = stageSize(),
        hit = !state.busy && state.image ? C.hitPoint(saved(), p.x, p.y, w * state.view.scale, h * state.view.scale) : null;
      g = { id: e.pointerId, x: e.clientX, y: e.clientY, vx: state.view.x, vy: state.view.y, finger: local(e), moved: false, hold: false, pan: false, hit, drag: null };
      holdTimer = setTimeout(() => {
        if (g && !g.moved) {
          g.hold = true;
          paint();
        }
      }, C.HOLD_MS);
    }
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
    } else if (g && g.id === e.pointerId) {
      const dx = e.clientX - g.x,
        dy = e.clientY - g.y;
      g.finger = local(e);
      if (!g.moved && Math.hypot(dx, dy) > C.TAP_SLOP) {
        g.moved = true;
        clearTimeout(holdTimer);
        if (g.hit && !state.busy) g.drag = C.pointDrag(saved(), g.hit);
        else if (!g.hold && state.view.scale > 1) g.pan = true;
        else g.hold = true;
      }
      if (g.drag) {
        const p = normalised(e.clientX, e.clientY);
        state.preview = g.drag.move(p.x, p.y);
        paint();
      } else if (g.pan) {
        state.view.x = g.vx + dx;
        state.view.y = g.vy + dy;
        clampView();
        applyView();
      } else if (g.hold) paint();
    }
  });
  const release = (e) => {
    const wasPinch = !!pinch;
    pointers.delete(e.pointerId);
    if (pinch && pointers.size < 2) pinch = null;
    if (wasPinch || !g || g.id !== e.pointerId) return;
    if (e.type !== "pointerup") return cancel();
    clearTimeout(holdTimer);
    const done = g;
    g = null;
    hideLoupe();
    if (done.drag) {
      // The moved point stays on screen until its single write settles.
      if (done.drag.moved && !state.busy) task(() => commitMove(done.drag));
      else endPreview();
      return;
    }
    if (done.pan || (done.moved && !done.hold)) return;
    const p = normalised(e.clientX, e.clientY),
      f = local(e),
      { w, h } = stageSize();
    if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 || f.x < 0 || f.y < 0 || f.x > w || f.y > h) return;
    completedTap = p;
    // A long press may end without a compatibility click; place the point anyway.
    if (done.hold) tapTimer = setTimeout(fireTap, 250);
  };
  stage.addEventListener("pointerup", release);
  stage.addEventListener("pointercancel", release);
  // Navigation, a hidden module or a touchcancel ends every touch. A WebView
  // may never send the matching pointer events, so pointers and pinch go too.
  function reset() {
    for (const id of pointers.keys())
      try {
        stage.releasePointerCapture(id);
      } catch {}
    pointers.clear();
    pinch = null;
    cancel();
  }
  // Some Android WebViews end a touch without pointercancel or drop capture.
  stage.addEventListener("touchcancel", reset);
  stage.addEventListener("lostpointercapture", (e) => {
    if (g && g.id === e.pointerId && pointers.has(e.pointerId)) {
      pointers.delete(e.pointerId);
      cancel();
    }
  });
  stage.addEventListener("contextmenu", (e) => e.preventDefault());
  // A modal opened on pointerup can receive the compatibility click from that
  // same touch. Activate only during click, whose target is now fixed.
  stage.addEventListener("click", fireTap);
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
  return { cancel: reset };
})();
// Stage pixel → photo point.
function normalisedLocal(f) {
  const r = $("stage").getBoundingClientRect();
  return normalised(r.left + f.x, r.top + f.y);
}
async function commitMove(drag) {
  const name = C.pointName(saved(), drag.hit);
  try {
    if (await drag.release((next) => edit("moving " + name, () => next))) say("photo-status", `${drag.hit.list === "horizon" ? "H" + name.slice(1) : name} moved.${state.calError ? " Calibration failed: " + state.calError : ""}`);
  } finally {
    endPreview();
  }
}
// Back to the stored sidecar: after a move is written, failed or cancelled.
function endPreview() {
  state.preview = null;
  recalibrate();
  render();
}
function onTap(x, y) {
  if (state.busy) return;
  const s = current();
  if (!s.viewer) return say("photo-status", "Set this photo’s viewpoint on the map first.", "attention");
  if (s.viewer.review) return say("photo-status", "Confirm the estimated viewpoint first.", "attention");
  if (state.mode === "mark") {
    if (s.marks.length >= C.MAX_MARKS) return say("photo-status", `At most ${C.MAX_MARKS} marks per photo. Remove one first.`, "attention");
    state.pendingTap = { x, y };
    drawOverlay();
    openMarkDialog();
  } else if (state.mode === "horizon") {
    if (s.horizon.length >= C.MAX_HORIZON) return say("photo-status", "Two horizon points are set. Remove one to change it.", "attention");
    task(async () => {
      await edit(`adding horizon point ${s.horizon.length + 1}`, (x0) => ({ ...x0, horizon: [...x0.horizon, { x, y }] }));
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
  drawPin(o, H, px);
  s.horizon.forEach((p) => dot(p.x, p.y, "#E9C46A", "", true));
  s.marks.forEach((m, i) => dot(m.x, m.y, "#5FD3A0", `${i + 1} ${m.name}`));
  if (state.pendingTap) dot(state.pendingTap.x, state.pendingTap.y, "#8CF0C4", "", true);
  if (state.lastTap) dot(state.lastTap.x, state.lastTap.y, "#F08A7E", "?", true);
}
// The pin's bearing line with its ±2σ band, or an arrow on the frame edge.
function drawPin(o, H, px) {
  const loc = state.pinLoc;
  if (!loc) return;
  const view = C.pinOverlay(loc),
    name = state.pin.name || "Pin",
    pts = (list) => list.map((q) => `${q.x * 1000},${q.y * H}`).join(" "),
    label = (x, y, t, anchor) => {
      const e = svg("text", { x, y, fill: "#8CF0C4", stroke: "#000", "stroke-width": px(3), "paint-order": "stroke", "font-size": px(14), "font-family": "system-ui, sans-serif", "text-anchor": anchor });
      e.textContent = t;
      o.append(e);
    };
  for (const band of view.bands) o.append(svg("polygon", { points: pts(band), fill: "#8CF0C42e", stroke: "#8CF0C480", "stroke-width": px(1) }));
  if (view.line.length) {
    o.append(svg("polyline", { points: pts(view.line), fill: "none", stroke: "#06110B99", "stroke-width": px(5) }));
    o.append(svg("polyline", { points: pts(view.line), fill: "none", stroke: "#8CF0C4", "stroke-width": px(2) }));
    // Labelled at the top of the line, clear of the mark labels near the horizon.
    const top = view.line[0],
      right = top.x > 0.5;
    label(top.x * 1000 + px(right ? -8 : 8), top.y * H + px(34), `${name} · ${C.km(loc.distanceKm)}`, right ? "end" : "start");
  }
  if (view.arrow) {
    const a = view.arrow,
      r = (a.angle * Math.PI) / 180,
      ux = Math.cos(r),
      uy = Math.sin(r),
      tx = a.x * 1000 - ux * px(3),
      ty = a.y * H - uy * px(3),
      bx = tx - ux * px(20),
      by = ty - uy * px(20),
      w = px(11);
    o.append(svg("polygon", { points: `${tx},${ty} ${bx - uy * w},${by + ux * w} ${bx + uy * w},${by - ux * w}`, fill: "#8CF0C4", stroke: "#06110B", "stroke-width": px(2) }));
    const text = loc.side.startsWith("behind") ? (loc.side === "behind-left" ? "Behind you, to the left" : "Behind you, to the right") : `${name} · ${C.km(loc.distanceKm)}`,
      anchor = Math.abs(ux) > 0.5 ? (ux < 0 ? "start" : "end") : a.x < 0.3 ? "start" : a.x > 0.7 ? "end" : "middle";
    label(bx - ux * px(6), by - uy * px(10) + (Math.abs(uy) > 0.5 ? 0 : px(5)) + (uy < -0.5 ? px(14) : 0), text, anchor);
  }
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

// ---- Magnifier ------------------------------------------------------------------
// Drawing only (Pocket Measure's loupe): a magnified circle lifted off the
// finger with a crosshair on the photo point under it, red off the photo.
// `skip` is the point being dragged: the crosshair stands for it.
function drawLoupe(finger, point, skip) {
  const canvas = $("loupe"),
    img = $("picture"),
    { w, h } = stageSize(),
    v = state.view,
    dpr = Math.min(window.devicePixelRatio || 1, 3);
  if (!img.naturalWidth || !img.naturalHeight) return;
  canvas.hidden = false;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const diameter = Math.max(72, Math.min(128, Math.floor(Math.min(w, h) * 0.42))),
    place = C.loupePlacement(finger, w, h, diameter, Math.round(diameter * 0.72)),
    valid = point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1 && finger.x >= 0 && finger.y >= 0 && finger.x <= w && finger.y <= h,
    at = { x: Math.max(0, Math.min(1, point.x)), y: Math.max(0, Math.min(1, point.y)) },
    crop = C.loupe(at, img.naturalWidth, img.naturalHeight, w * v.scale, diameter),
    k = w * v.scale * C.LOUPE_MAGNIFICATION,
    kh = h * v.scale * C.LOUPE_MAGNIFICATION,
    s = current();
  g.save();
  g.beginPath();
  g.arc(place.x, place.y, place.r, 0, Math.PI * 2);
  g.lineWidth = 6;
  g.strokeStyle = "rgba(6,17,11,.55)";
  g.stroke();
  g.clip();
  g.fillStyle = "#122019";
  g.fillRect(place.x - place.r, place.y - place.r, diameter, diameter);
  if (crop.w > 0 && crop.h > 0) g.drawImage(img, crop.x, crop.y, crop.w, crop.h, place.x - place.r + crop.dx, place.y - place.r + crop.dy, crop.w * crop.scale, crop.h * crop.scale);
  // Other points, magnified around the crosshair.
  const others = (list, colour, ring) =>
    s[list].forEach((p, i) => {
      if (skip && skip.list === list && skip.index === i) return;
      g.beginPath();
      g.arc(place.x + (p.x - at.x) * k, place.y + (p.y - at.y) * kh, ring ? 8 : 5, 0, Math.PI * 2);
      g.lineWidth = 2;
      if (ring) g.strokeStyle = colour;
      else (g.fillStyle = colour), g.fill(), (g.strokeStyle = "#06110B");
      g.stroke();
    });
  others("marks", "#5FD3A0", false);
  others("horizon", "#E9C46A", true);
  const arm = place.r * 0.7,
    tone = valid ? "#5FD3A0" : "#F08A7E";
  for (const [colour, width] of [["rgba(6,17,11,.65)", 3], [tone, 1]]) {
    g.strokeStyle = colour;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(place.x - arm, place.y);
    g.lineTo(place.x + arm, place.y);
    g.moveTo(place.x, place.y - arm);
    g.lineTo(place.x, place.y + arm);
    g.stroke();
  }
  g.beginPath();
  g.arc(place.x, place.y, 5, 0, Math.PI * 2);
  g.strokeStyle = tone;
  g.lineWidth = 1.5;
  g.stroke();
  g.restore();
  g.beginPath();
  g.arc(place.x, place.y, place.r, 0, Math.PI * 2);
  g.strokeStyle = "#E6F0EA";
  g.lineWidth = 2;
  g.stroke();
}
function hideLoupe() {
  const canvas = $("loupe");
  if (canvas.hidden) return;
  canvas.hidden = true;
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
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
      const found = await state.data.features(s.viewer, s.radiusKm);
      showAttribution(state.data.index);
      state.features.set(key, found);
      return found;
    })();
    state.fetching.set(key, job);
    job.catch(() => {}).finally(() => state.fetching.delete(key));
  }
  return state.fetching.get(key);
}
// Licence and attribution as the index states them, in the help and on the map.
function showAttribution(index) {
  if (!index) return;
  const licence = index.license.replace(/-/g, " ");
  $("data-attribution").textContent = `Landmark data ${index.attribution}, ${licence}.`;
  $("map-attribution").textContent = `${index.attribution} · ${licence} · openstreetmap.org/copyright`;
}
// Outside coverage is a state, not a failure; everything else names its gate.
const fetchMessage = (error) => (error.code === "OUTSIDE_COVERAGE" ? error.message : `[${error.code || "ERROR"}] ${error.message}`);
let markRequest = 0;
async function openMarkDialog() {
  const request = ++markRequest, generation = state.photoGeneration;
  const dialog = $("mark-dialog");
  $("search").value = "";
  $("results").replaceChildren();
  $("retry-fetch").hidden = true;
  if (!dialog.open) dialog.showModal();
  say("fetch-status", `Looking up named landmarks within ${current().radiusKm} km…`);
  try {
    const data = await features();
    if (!dialog.open || request !== markRequest || generation !== state.photoGeneration) return;
    const note = C.coverageNote(data);
    say("fetch-status", (data.features.length ? `${data.features.length} landmarks within ${current().radiusKm} km. Nearest first.` : `No named landmarks found within ${current().radiusKm} km. Try a larger radius.`) + (note ? " " + note : ""), note ? "attention" : undefined);
    renderResults();
  } catch (error) {
    if (!dialog.open || request !== markRequest || generation !== state.photoGeneration) return;
    say("fetch-status", fetchMessage(error), error.code === "OUTSIDE_COVERAGE" ? "attention" : "error");
    $("retry-fetch").hidden = error.retry === false;
  }
}
function renderResults() {
  const data = state.features.get(currentKey()),
    ul = $("results");
  ul.replaceChildren();
  if (!data) return;
  const from = origin().point;
  for (const { feature: f, distanceM } of C.search(data.features, $("search").value, from)) {
    const li = document.createElement("li"),
      b = document.createElement("button"),
      small = document.createElement("small");
    b.textContent = f.name;
    small.textContent = [C.kindLabel(f), C.range(distanceM / 1000, S.bearing(from, f)), C.sizeLabel(f)].filter(Boolean).join(" · ");
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
    await edit("adding " + mark.name, (s) => ({ ...s, marks: [...s.marks.filter((m) => !C.sameFeature(m, mark)), mark] }));
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
    say("photo-status", fetchMessage(error), error.code === "OUTSIDE_COVERAGE" ? "attention" : "error");
    return;
  }
  if (generation !== state.photoGeneration) return;
  const ranked = S.rank(state.cal, x, y, C.candidatesOf(data.features)),
    list = C.shortlist(ranked),
    ol = $("candidates");
  ol.replaceChildren();
  const wedge = ranked.length ? ranked[0].wedgeSigmaDeg : S.uncertainty(state.cal, x, y);
  state.lastList = { rows: list.rows, wedge, bearing: S.bearingAt(state.cal, x, y), partialCoverage: data.partialCoverage };
  $("candidates-title").textContent = list.anyClose ? "Could be" : "No close match";
  const o = origin();
  $("candidates-note").textContent = `Your tap points ${C.degrees(S.bearingAt(state.cal, x, y))}° (${C.compass(S.bearingAt(state.cal, x, y))}), direction ±${wedge.toFixed(1)}°. Distances and bearings from ${o.fitted ? "the fitted viewpoint" : "your viewpoint"}.` + (list.anyClose ? "" : " Nearest two shown greyed.") + (data.partialCoverage ? " " + C.coverageNote(data) : "");
  let positionNote = false;
  list.rows.forEach((r, i) => {
    const li = document.createElement("li"),
      b = document.createElement("button"),
      small = document.createElement("small"),
      f = r.candidate.feature;
    li.className = r.greyed ? "greyed" : "";
    b.textContent = `${r.greyed ? "" : "Could be "}${f.name}`;
    small.textContent = `${C.kindLabel(f)} · ${C.range(r.distanceKm, r.bearing)} · ${C.signed(r.deltaDeg)} from your tap · ±${r.sigmaDeg.toFixed(1)}°${r.close ? "" : " · not close"}`;
    if (C.positionMatters(r)) positionNote = true;
    b.append(small);
    b.onclick = () => {
      $("candidates-dialog").close();
      showPane("map", true, i);
    };
    const show = document.createElement("button");
    show.className = "show";
    show.textContent = "Show in photo";
    show.setAttribute("aria-label", `Show ${f.name} in the photo`);
    show.onclick = () => {
      $("candidates-dialog").close();
      showPane("photo");
      setPin({ point: r.candidate.point, name: f.name, positionM: f.positionM });
    };
    li.append(b, show);
    ol.append(li);
  });
  if (!list.rows.length) {
    const li = document.createElement("li");
    li.textContent = "No named landmarks fetched for this radius.";
    ol.append(li);
  }
  const extra = [];
  if (positionNote) extra.push("Some candidates are close by, so your position matters more: their ±σ is wider than the direction.");
  $("candidates-extra").textContent = extra.join(" ");
  $("candidates-dialog").showModal();
  say("photo-status", list.anyClose ? `Closest: ${list.rows[0].candidate.feature.name}, ±${list.rows[0].sigmaDeg.toFixed(1)}°.` : "No close match for that tap.");
}

// ---- Map view ------------------------------------------------------------------------
async function tileImage(url) {
  const r = await call("net.http", { op: "get", url, format: "image" });
  if (r.status !== 200 || typeof r.dataUrl !== "string") throw Object.assign(new Error("Map tile unavailable"), { code: "HTTP_STATUS" });
  return r.dataUrl;
}
const map = new AimeMap($("map"), {
  getImage: tileImage,
  onViewer: (point) => {
    if (state.busy) return renderMap(false);
    task(async () => {
      try { await setViewpoint(point); }
      finally { renderMap(false); } // Restore the saved ring if persistence failed.
    });
  },
  onError: (error) =>
    say("map-status", !error ? "" : error.code === "CAPABILITY_DENIED" ? "Map tiles need internet access for Aimé (Construct menu → Module access)." : "Map tiles unavailable. The list below still describes the map.", error ? "attention" : ""),
  onRuler: () => renderRuler(),
  // A dropped pin keeps a snapped landmark's estimate, else the placement
  // precision of the map scale (as for a placed viewpoint).
  onPin: (p, mPerPx) => setPin({ point: { lat: p.lat, lon: p.lon }, name: p.name, positionM: p.positionM || Math.max(5, Math.round(mPerPx * 12)) }),
  rulerLabel: (m) => C.range(m.km, m.bearing),
});
// Map ruler: two taps → great-circle distance and initial bearing from the first.
function renderRuler() {
  const r = map.ruler,
    n = r ? r.points.length : 0,
    m = n === 2 ? AimeMap.measure(r.points[0], r.points[1]) : null;
  $("map-ruler").setAttribute("aria-pressed", String(!!r));
  $("map-ruler-clear").disabled = !n;
  $("map-ruler-status").textContent = !r
    ? ""
    : m
      ? `Ruler: ${C.km(m.km)}, initial bearing ${C.degrees(m.bearing)}° (${C.compass(m.bearing)}) from the first point, along the great circle. Tap again to start a new measurement.`
      : n
        ? "Ruler: tap the second point."
        : "Ruler: tap two points on the map. A tap near your viewpoint or a pin measures from it exactly.";
}
map.pause(true);
window.addEventListener("constructvisibilitychange", (event) => {
  state.visible = event.detail?.visible !== false;
  if (!state.visible) gestures.cancel();
  map.pause(!state.visible || $("photo").hidden || state.pane !== "map");
});
// A dragged or placed viewpoint is the user's input: corrected, confirmed, with
// the placement precision of the current map scale as its accuracy.
async function setViewpoint(point) {
  const before = current().viewer;
  await update((s) => ({
    ...s,
    viewer: {
      lat: point.lat,
      lon: point.lon,
      accuracyM: Math.max(5, Math.round(point.mPerPx * 12)),
      timestamp: before ? before.timestamp : null,
      approximate: false,
      corrected: true,
      review: false,
    },
  }));
  state.lastTap = null;
  state.lastList = null;
  say("photo-status", `Viewpoint ${before ? "corrected" : "set"}. Landmarks are looked up around it when needed.`);
  renderMap(false);
}
function showPane(pane, fit = false, focus = null) {
  state.pane = pane;
  $("photo-pane").hidden = pane !== "photo";
  $("map-pane").hidden = pane !== "map";
  $("show-photo").setAttribute("aria-pressed", String(pane === "photo"));
  $("show-map").setAttribute("aria-pressed", String(pane === "map"));
  map.pause(!state.visible || pane !== "map");
  if (pane === "photo") {
    layout();
    render();
  } else {
    render();
    renderMap(fit, focus);
  }
}
// Other photos' viewpoints are a starting centre for placing an unlocated one.
function knownCentre() {
  const v = Object.values(state.store || {}).map((s) => s.viewer).filter(Boolean);
  return v.length ? v[v.length - 1] : null;
}
function renderMap(fit, focus = null) {
  if ($("map-pane").hidden) return;
  const s = current(),
    v = s.viewer,
    list = state.lastList,
    cal = state.cal,
    fitted = cal && v && S.distance(v, cal.viewer) * 1000 > 1 ? { lat: cal.viewer.lat, lon: cal.viewer.lon } : null;
  const candidates = list ? list.rows.map((r, i) => ({ lat: r.candidate.point.lat, lon: r.candidate.point.lon, n: i + 1, greyed: r.greyed, name: r.candidate.feature.name, positionM: r.candidate.positionM })) : [];
  const lengthKm = Math.max(s.radiusKm, ...candidates.map((c) => S.distance(fitted || v || c, c) * 1.1));
  map.placing = !v; // While the ruler is on, taps measure instead.
  map.editable = !!v;
  map.setScene(
    {
      viewer: v ? { lat: v.lat, lon: v.lon, accuracyM: v.accuracyM || 20 } : null,
      fitted,
      wedge: v && list ? { bearing: list.bearing, sigma: list.wedge, lengthKm } : null,
      marks: s.marks.map((m) => ({ lat: m.lat, lon: m.lon, name: m.name, positionM: m.positionM })),
      candidates,
      focus: focus !== null && candidates[focus] ? focus : null,
      pin: state.pin ? { ...state.pin.point, name: state.pin.name } : null,
    },
    false,
  );
  if (fit) {
    if (v) map.fit();
    else {
      const c = knownCentre();
      map.center = c ? { lat: c.lat, lon: c.lon } : { lat: 47, lon: 8 };
      map.zoom = c ? 13 : 4;
    }
    map.draw();
  }
  $("map-hint").textContent = !v
    ? map.ruler
      ? "Ruler on: taps measure. Turn the ruler off to set your viewpoint."
      : "Set your viewpoint: tap the map where you stood when taking this photo. Pan and zoom first to place it precisely."
    : v.review
      ? "Drag the ring to where you stood, or confirm the estimated viewpoint above."
      : "Drag the ring to correct where you stood. Long-press the map to drop a pin and see where it lies in the photo. The wedge shows your last tap’s direction: ±1σ, fainter out to ±2σ.";
  $("locate-start").hidden = !!v;
  const legend = $("map-legend");
  legend.replaceChildren();
  const item = (label, detail) => {
    const li = document.createElement("li"),
      span = document.createElement("span"),
      small = document.createElement("small");
    span.textContent = label;
    small.textContent = detail;
    span.append(small);
    li.append(span);
    legend.append(li);
  };
  if (!v) item("No viewpoint yet", "Tap the map to set where you stood.");
  else {
    item(`Ring: ${v.corrected ? "your corrected" : v.review ? "estimated (please confirm)" : "your estimated"} viewpoint`, `±${Math.round(v.accuracyM || 20)} m accuracy, shown as the shaded circle`);
    if (fitted) item("Dot: viewpoint fitted from your marks", `${Math.round(S.distance(v, fitted) * 1000)} m from the ring; your saved viewpoint is unchanged`);
  }
  if (list && list.partialCoverage) item("Partial landmark coverage", C.coverageNote(list));
  if (v && list) item(`Wedge: your tap points ${C.degrees(list.bearing)}° (${C.compass(list.bearing)})`, `±${list.wedge.toFixed(1)}° (1σ), fainter band to ±${(2 * list.wedge).toFixed(1)}° (2σ); nearby candidates can have a wider ±σ of their own`);
  const from = origin();
  s.marks.forEach((m) => item(`Green pin: ${m.name}`, from ? `landmark you marked · ${C.range(S.distance(from.point, m), S.bearing(from.point, m))}` : "landmark you marked"));
  candidates.forEach((c, i) => {
    const r = list.rows[i];
    item(`Pin ${c.n}: ${c.name}${i === focus ? " (selected)" : ""}`, `${r.greyed ? "not close · " : "could be · "}${C.range(r.distanceKm, r.bearing)} · ${C.signed(r.deltaDeg)} ±${r.sigmaDeg.toFixed(1)}°`);
  });
  if (state.pin) item(`Light pin: ${state.pin.name || "your dropped pin"}`, pinStatus());
  if (v && (s.marks.length || candidates.length)) item("Distances and bearings", `from ${from.fitted ? "the fitted viewpoint (dot)" : "your viewpoint (ring)"}`);
}

// ---- Wiring ---------------------------------------------------------------------
$("take").onclick = () => task(takePhoto);
$("show-photo").onclick = () => showPane("photo");
$("show-map").onclick = () => showPane("map", true);
$("map-zoom-in").onclick = () => map.zoomBy(1);
$("map-zoom-out").onclick = () => map.zoomBy(-1);
$("map-fit").onclick = () => renderMap(true);
$("map-ruler").onclick = () => {
  map.setRuler(!map.ruler);
  renderRuler();
  renderMap(false);
};
$("map-ruler-clear").onclick = () => {
  map.clearRuler();
  renderRuler();
};
$("pin-show").onclick = () => showPane("photo");
$("pin-clear").onclick = () => {
  map.clearPin();
  setPin(null);
};
$("undo").onclick = () =>
  task(async () => {
    const step = state.undo;
    if (!step || step.id !== state.selectedId) return;
    await update((s) => C.undone(s, step));
    state.undo = null;
    renderUndo();
    say("photo-status", `Undone: ${step.label}.${state.calError ? " Calibration failed: " + state.calError : ""}`);
  });
$("locate-start").onclick = () =>
  task(async () => {
    say("map-status", "Reading your current location to centre the map…");
    const { fix, error } = await locate(true);
    if (!fix) return say("map-status", describe(error || { code: "LOCATION_DATA" }, "Location"), "error");
    map.center = { lat: fix.lat, lon: fix.lon };
    map.zoom = 15;
    map.draw();
    say("map-status", "Centred on where you are now. Tap where you stood when you took the photo.");
  });
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
