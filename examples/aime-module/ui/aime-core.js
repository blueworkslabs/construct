"use strict";
// Aimé module logic without DOM or host calls: per-photo sidecars keyed by the
// API 0.12 stable photo id, capture association, orphan reconciliation, the
// landmark cells (aime-data contract, schema 1), local name search, the
// candidates shortlist, point editing with one-step undo and the magnifier.
// Global `AimeCore` in the module, CommonJS under Node for scripts/test_aime.cjs.
const AimeCore = (() => {
  const RADII = [10, 30, 60],
    DEFAULT_RADIUS = 30,
    MAX_MARKS = 6,
    MAX_HORIZON = 2,
    NAME_MAX = 80,
    // Landmark cells: index once per session, then the 1° cells a radius touches.
    DATA_ORIGIN = "https://aime-data.pages.dev",
    INDEX_URL = DATA_ORIGIN + "/v1/index.json",
    // The host runs at most four requests per module; the map's tile loader
    // keeps up to two in flight, so landmark downloads use the other two.
    DATA_CONCURRENCY = 2,
    // A fix older than the host's own cache limit, or a viewfinder wait longer
    // than this, may no longer be where the photo was taken.
    OLD_FIX_MS = 120000,
    LONG_WAIT_MS = 60000,
    LOCATION_SPACING_MS = 15000,
    // Persistence: one bounded record per photo in a fixed pool of slots plus a
    // small index. Every storage.kv request must fit the host's 8,192-character
    // bridge message; the host also keeps keys set to null, so keys are reused
    // slots, never derived from ever-new photo ids.
    MAX_SLOTS = 16,
    INDEX_KEY = "photos.index",
    MESSAGE_LIMIT = 8192,
    MESSAGE_BUDGET = 7600;
  const num = (x) => typeof x === "number" && Number.isFinite(x);
  // Control/format characters are dropped: they carry no name and would expand
  // the storage request when escaped. `max` counts code points, as the data
  // contract does, so an astral character at the limit is never split.
  const text = (s, max = NAME_MAX) => (typeof s === "string" ? [...s.replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, "").trim()].slice(0, max).join("").trim() : "");
  const inUnit = (v) => num(v) && v >= 0 && v <= 1;
  const latLon = (lat, lon) => num(lat) && num(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const OSM_TYPES = ["node", "way", "relation"];
  const isKind = (k) => typeof k === "string" && /^[a-z][a-z_]{0,39}$/.test(k),
    isRelease = (r) => typeof r === "string" && /^[\w.-]{1,40}$/.test(r),
    // Position uncertainty per feature (contract `p`): integer metres, 5–1000.
    isP = (p) => Number.isInteger(p) && p >= 5 && p <= 1000;

  // ---- Sidecars -------------------------------------------------------------
  // Shape (brief): { viewer: {lat, lon, accuracyM, timestamp, approximate, corrected,
  // review}, radiusKm, marks: [{x, y, kind, name, lat, lon, positionM, dataset}],
  // horizon: [{x, y}], capture? }. `review` (not in the brief's list) marks a
  // viewpoint that must be confirmed or corrected before any feature query.
  // `capture` (Aimé ≥ 0.2.0, API 0.13) is the camera's metadata for the photo;
  // 0.1.x records and library photos have none.
  function cleanViewer(v) {
    if (!v || !latLon(v.lat, v.lon)) return null;
    return {
      lat: v.lat,
      lon: v.lon,
      accuracyM: num(v.accuracyM) && v.accuracyM > 0 ? Math.min(v.accuracyM, 50000) : null,
      timestamp: num(v.timestamp) ? v.timestamp : null,
      approximate: v.approximate === true,
      corrected: v.corrected === true,
      review: v.review === true,
    };
  }
  // Marks saved before landmark cells (Aimé ≤ 0.1.2) carry an OSM type and id
  // instead of kind and dataset. They keep that shape, name, position and
  // estimate, so they load, calibrate and round-trip unchanged.
  function cleanMark(m) {
    if (!m || !inUnit(m.x) || !inUnit(m.y) || !latLon(m.lat, m.lon)) return null;
    if (isKind(m.kind))
      return {
        x: m.x,
        y: m.y,
        kind: m.kind,
        name: text(m.name) || "Landmark",
        lat: m.lat,
        lon: m.lon,
        positionM: num(m.positionM) && m.positionM > 0 ? m.positionM : 30,
        dataset: isRelease(m.dataset) ? m.dataset : "",
      };
    if (!OSM_TYPES.includes(m.osmType) || !Number.isSafeInteger(m.osmId)) return null;
    return {
      x: m.x,
      y: m.y,
      osmType: m.osmType,
      osmId: m.osmId,
      name: text(m.name) || m.osmType + "/" + m.osmId,
      lat: m.lat,
      lon: m.lon,
      // Keep the stored estimate (30 m for way/relation centres) on reopen.
      positionM: num(m.positionM) && m.positionM > 0 ? m.positionM : m.osmType === "node" ? 8 : 30,
    };
  }
  // API 0.13 capture metadata, validated field group by field group: a group
  // with any invalid value is dropped whole (never repaired), since every
  // measured field is optional. Values are rounded so a record stays bounded.
  const round = (v, k = 100) => Math.round(v * k) / k,
    inRange = (v, lo, hi) => num(v) && v >= lo && v <= hi;
  function cleanCapture(c) {
    if (!c || typeof c !== "object") return null;
    const out = {};
    if (inRange(c.zoomRatio, 0.1, 10)) out.zoomRatio = c.zoomRatio;
    const f = c.fovDeg;
    if (f && inRange(f.h, 1, 179) && inRange(f.v, 1, 179) && inRange(c.fovSigmaDeg, 0.1, 30)) {
      out.fovDeg = { h: round(f.h), v: round(f.v) };
      out.fovSigmaDeg = round(c.fovSigmaDeg);
    }
    const t = c.tilt;
    if (t && inRange(t.pitchDeg, -180, 180) && inRange(t.rollDeg, -180, 180) && inRange(t.sigmaDeg, 0.1, 90) && inRange(t.ageMs, 0, 3600000))
      out.tilt = { pitchDeg: round(t.pitchDeg), rollDeg: round(t.rollDeg), sigmaDeg: round(t.sigmaDeg), ageMs: Math.round(t.ageMs) };
    if (inRange(c.headingDeg, 0, 360) && c.headingRef === "magnetic" && inRange(c.headingAccuracyDeg, 0, 180) && inRange(c.headingAgeMs, 0, 3600000))
      Object.assign(out, { headingDeg: round(c.headingDeg), headingRef: "magnetic", headingAccuracyDeg: round(c.headingAccuracyDeg), headingAgeMs: Math.round(c.headingAgeMs) });
    return Object.keys(out).length ? out : null;
  }
  function cleanSidecar(raw) {
    if (!raw || typeof raw !== "object") return null;
    const capture = cleanCapture(raw.capture);
    return {
      viewer: cleanViewer(raw.viewer),
      radiusKm: RADII.includes(raw.radiusKm) ? raw.radiusKm : DEFAULT_RADIUS,
      marks: (Array.isArray(raw.marks) ? raw.marks : []).map(cleanMark).filter(Boolean).slice(0, MAX_MARKS),
      horizon: (Array.isArray(raw.horizon) ? raw.horizon : [])
        .filter((h) => h && inUnit(h.x) && inUnit(h.y))
        .map((h) => ({ x: h.x, y: h.y }))
        .slice(0, MAX_HORIZON),
      ...(capture ? { capture } : {}),
    };
  }
  const validId = (id) => typeof id === "string" && /^[\x21-\x7e]{1,80}$/.test(id);
  // ---- Persistence plan (pure; the controller performs the storage calls) ----
  const recordKey = (slot) => "photo." + slot;
  // Index value → slots array (id or null). Invalid or duplicate ids are dropped.
  function loadIndex(raw) {
    const slots = Array(MAX_SLOTS).fill(null),
      seen = new Set();
    const list = raw && typeof raw === "object" && raw.v === 1 && Array.isArray(raw.slots) ? raw.slots : [];
    list.slice(0, MAX_SLOTS).forEach((id, i) => {
      if (validId(id) && !seen.has(id)) {
        seen.add(id);
        slots[i] = id;
      }
    });
    return slots;
  }
  const indexValue = (slots) => ({ v: 1, slots: slots.slice() });
  // A record counts only when it names the id its slot is claimed for.
  const recordValue = (id, sidecar) => ({ id, sidecar });
  const recordFor = (raw, id) => (raw && typeof raw === "object" && raw.id === id ? cleanSidecar(raw.sidecar) : null);
  // Where to write `id`: its slot, or the first free one (claim → index write).
  function planPut(slots, id) {
    const own = slots.indexOf(id);
    if (own >= 0) return { slot: own, claim: false, slots };
    const free = slots.indexOf(null);
    if (free < 0) throw Object.assign(new Error("Aimé's photo records are full. Delete a photo, then reopen Aimé."), { code: "STORAGE_FULL" });
    const next = slots.slice();
    next[free] = id;
    return { slot: free, claim: true, slots: next };
  }
  // Free every slot whose id is not in `keepIds` (one index write).
  function planRelease(slots, keepIds) {
    const keep = new Set(keepIds),
      freed = [],
      next = slots.map((id, i) => (id !== null && !keep.has(id) ? (freed.push({ slot: i, id }), null) : id));
    return { slots: next, freed };
  }
  // Length of the bridge message a set request produces (ids up to 8 digits).
  const envelopeLength = (key, value) => JSON.stringify({ id: "99999999", method: "storage.kv", params: { op: "set", key, value } }).length;
  function checkEnvelope(key, value) {
    if (envelopeLength(key, value) > MESSAGE_BUDGET)
      throw Object.assign(new Error("This photo's data is too large to save. Remove a mark and try again."), { code: "STORAGE_SIZE" });
  }
  // Persistence over storage.kv-like {get(key), set(key, value)} promises. The
  // in-memory copy changes only after the storage writes it depends on succeed.
  function persistence(kv) {
    let slots = null,
      store = null;
    const set = async (key, value) => {
      checkEnvelope(key, value);
      await kv.set(key, value);
    };
    const unavailable = () => Object.assign(new Error("Storage access is off, so viewpoints and marks cannot be saved."), { code: "STORAGE_UNAVAILABLE" });
    return {
      get store() {
        return store;
      },
      get slots() {
        return slots;
      },
      // Any failed read leaves storage unavailable: never an empty store that a
      // later write could overwrite.
      async load() {
        try {
          const nextSlots = loadIndex(await kv.get(INDEX_KEY)),
            next = {};
          for (let slot = 0; slot < nextSlots.length; slot++) {
            if (!nextSlots[slot]) continue;
            const sidecar = recordFor(await kv.get(recordKey(slot)), nextSlots[slot]);
            if (sidecar) next[nextSlots[slot]] = sidecar;
          }
          slots = nextSlots;
          store = next;
          return null;
        } catch (error) {
          slots = null;
          store = null;
          return error;
        }
      },
      // Record first, then claim the slot: an interrupted claim leaves the slot
      // free and the next attempt rewrites it.
      async put(id, sidecar) {
        if (!store) throw unavailable();
        const clean = cleanSidecar(sidecar),
          plan = planPut(slots, id);
        await set(recordKey(plan.slot), recordValue(id, clean));
        if (plan.claim) await set(INDEX_KEY, indexValue(plan.slots));
        slots = plan.slots;
        store = { ...store, [id]: clean };
      },
      // Only after a successful complete list or a confirmed delete: free the
      // slots of photos that are gone in one index write, then clear records.
      async release(keepIds) {
        if (!store) return [];
        const plan = planRelease(slots, keepIds);
        if (!plan.freed.length) return [];
        await set(INDEX_KEY, indexValue(plan.slots));
        slots = plan.slots;
        const next = { ...store };
        for (const { id } of plan.freed) delete next[id];
        store = next;
        // Unclaimed records are ignored on load; clearing them only returns bytes.
        for (const { slot } of plan.freed) await set(recordKey(slot), null).catch(() => {});
        return plan.freed.map((f) => f.id);
      },
    };
  }
  function newSidecar(viewer, radiusKm = DEFAULT_RADIUS, capture = null) {
    return cleanSidecar({ viewer, radiusKm, marks: [], horizon: [], capture });
  }
  // Library list → ids. Throws when the list is not the API 0.12 shape, so a
  // missing id is never treated as an empty or partial library.
  function listIds(result) {
    if (!result || !Array.isArray(result.photos)) throw Object.assign(new Error("Unexpected photo list."), { code: "PHOTO_LIST" });
    const ids = result.photos.map((p) => p && p.id);
    if (!ids.every(validId) || new Set(ids).size !== ids.length)
      throw Object.assign(new Error("This Construct version does not provide stable photo IDs. Update Construct."), { code: "PHOTO_IDS" });
    return ids;
  }
  // API 0.13 capture result → the new photo's stable id. The host fails a
  // capture it cannot identify, so a saved result without a valid id is a
  // contract error: the photo stays unassociated, never matched by guessing.
  const captureId = (result) => (result && result.saved === true && validId(result.id) ? result.id : null);


  // ---- Viewpoint from before/after fixes ----------------------------------
  // location.read result → viewer candidate, or null when unusable.
  function fixFrom(result) {
    if (!result || !latLon(result.latitude, result.longitude) || !num(result.timestamp)) return null;
    return {
      lat: result.latitude,
      lon: result.longitude,
      accuracyM: num(result.accuracyM) && result.accuracyM > 0 ? result.accuracyM : null,
      timestamp: result.timestamp,
      approximate: result.approximate === true,
    };
  }
  // Initial great-circle bearing a → b, degrees clockwise from true north.
  function bearing(a, b) {
    const rad = Math.PI / 180,
      y = Math.sin((b.lon - a.lon) * rad) * Math.cos(b.lat * rad),
      x = Math.cos(a.lat * rad) * Math.sin(b.lat * rad) - Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos((b.lon - a.lon) * rad);
    return (((Math.atan2(y, x) * 180) / Math.PI) % 360 + 360) % 360;
  }
  function metres(a, b) {
    const rad = Math.PI / 180,
      h = Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
    return 2 * 6371008.8 * Math.asin(Math.sqrt(Math.min(1, h)));
  }
  // Keep the later fix by its own timestamp (not request order). Flag review when
  // the fixes disagree beyond their combined accuracy, the kept fix is old at
  // capture, or the viewfinder stayed open long enough to walk somewhere else.
  function chooseViewpoint(before, after, openedAt, savedAt) {
    const fixes = [before, after].filter(Boolean);
    if (!fixes.length) return null;
    const kept = fixes.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
    const reasons = [];
    if (before && after) {
      const apart = metres(before, after),
        allowed = (before.accuracyM || 20) + (after.accuracyM || 20);
      if (apart > allowed) reasons.push("fixes disagree");
    }
    if (num(savedAt) && savedAt - kept.timestamp > OLD_FIX_MS) reasons.push("old fix");
    if (num(openedAt) && num(savedAt) && savedAt - openedAt > LONG_WAIT_MS) reasons.push("long viewfinder wait");
    return { viewer: cleanViewer({ ...kept, corrected: false, review: reasons.length > 0 }), reasons };
  }
  // A viewpoint that may be used for a landmark lookup.
  const queryable = (viewer) => !!viewer && !viewer.review;

  // ---- Landmark cells (aime-data contract, schema 1) -----------------------
  const dataError = (code, message, retry = true) => Object.assign(new Error(message), { code, retry });
  const unavailable = (reason) => dataError("DATA_INVALID", "Landmark data unavailable: " + reason + " Retry later.");
  const readJson = (body, what) => {
    try {
      return JSON.parse(body);
    } catch {
      throw unavailable(what + " is unreadable.");
    }
  };
  const CELL = /^(-?\d{1,2})_(-?\d{1,3})$/;
  const validCell = (value) => {
    const m = typeof value === "string" && value.match(CELL);
    return !!m && +m[1] >= -90 && +m[1] < 90 && +m[2] >= -180 && +m[2] < 180 && value === `${+m[1]}_${+m[2]}`;
  };
  // 1° cells (integer south-west corner) of the radius's bounding box. The
  // longitude half-width is the spherical cap's, asin(sin δ / cos φ); a cap
  // over a pole spans every longitude.
  function cellsAround(lat, lon, radiusKm) {
    if (!latLon(lat, lon) || !RADII.includes(radiusKm)) throw new Error("Viewpoint and a 10/30/60 km radius are required.");
    const deg = 180 / Math.PI,
      d = radiusKm / 6371.0088,
      dLat = d * deg,
      s = Math.sin(d) / Math.cos(lat / deg),
      dLon = lat + dLat >= 90 || lat - dLat <= -90 || s >= 1 ? 180 : Math.asin(s) * deg,
      lon0 = Math.floor(lon - dLon),
      lon1 = Math.min(Math.floor(lon + dLon), lon0 + 359),
      out = new Set();
    for (let a = Math.max(-90, Math.floor(lat - dLat)); a <= Math.min(89, Math.floor(lat + dLat)); a++)
      for (let o = lon0; o <= lon1; o++) out.add(a + "_" + ((((o + 180) % 360) + 360) % 360 - 180));
    return [...out];
  }
  // Licence and attribution exactly as published: a plain bounded string with
  // no control characters or padding, else null. Never a default: the module
  // shows only what the dataset states.
  const legal = (v, max) => (typeof v === "string" && v !== "" && text(v, max) === v ? v : null);
  // index.json text → {release, revision, dataset, path, cells (Set), kinds (Set),
  // coverage, license, attribution}. Anything but schema 1 in the expected shape
  // is unavailable. Kinds only validate records; they carry no position values.
  function parseIndex(body) {
    const x = readJson(body, "The landmark index");
    if (!x || x.schema !== 1 || x.cellDeg !== 1) throw unavailable("the landmark index has an unsupported schema.");
    if (!Array.isArray(x.kinds) || !x.kinds.length || !x.kinds.every(isKind))
      throw unavailable("the landmark index contains invalid kinds.");
    const kinds = new Set(x.kinds);
    // dataset = <release>-r<revision>; its cells live under <dataset>/cells/.
    const dataset = isRelease(x.release) && Number.isInteger(x.revision) && x.revision >= 1 ? `${x.release}-r${x.revision}` : null;
    if (!dataset || x.dataset !== dataset || !isRelease(x.dataset) || x.path !== dataset + "/cells/" || !Array.isArray(x.cells) || !x.cells.every(validCell) || !kinds.size)
      throw unavailable("the landmark index is incomplete.");
    const license = legal(x.license, 40),
      attribution = legal(x.attribution, 120);
    if (!license || !attribution) throw unavailable("the landmark index has no valid licence or attribution.");
    return {
      release: x.release,
      revision: x.revision,
      dataset,
      path: x.path,
      cells: new Set(x.cells),
      kinds,
      coverage: Array.isArray(x.coverage) ? x.coverage.filter((c) => typeof c === "string") : [],
      license,
      attribution,
    };
  }
  const cellUrl = (index, cell) => DATA_ORIGIN + "/v1/" + index.path + cell + ".json";
  // Session cache key: a revision of the same release is a different dataset.
  const cellKey = (index, cell) => index.dataset + "/" + cell;
  // Cells to download for a viewpoint and radius: only those the index lists.
  const cellPlan = (index, viewer, radiusKm) => cellsAround(viewer.lat, viewer.lon, radiusKm).filter((c) => index.cells.has(c));
  const TERRAIN = new Set(["peak", "hill", "volcano"]);
  // Cell text → features. A cell whose schema, release, revision or corner does
  // not match the index, or without a feature array, is unavailable (never
  // empty). Missing or invalid position uncertainty makes the entire cell
  // unavailable: never cache incomplete data as a successful empty lookup.
  // `p` is the feature's positionM, with no kind-level fallback. The optional,
  // additive `declination` (degrees east, WMM at the cell centre) is kept when
  // it is a finite number in [-180, 180], else treated as absent: never a cell
  // error, so older cells without it stay valid. → {features, declination|null}
  function readCell(index, cell, body) {
    const x = readJson(body, "Landmark cell " + cell),
      m = cell.match(CELL);
    if (!x || x.schema !== 1 || x.release !== index.release || x.revision !== index.revision) throw unavailable(`landmark cell ${cell} does not match the index dataset (release and revision).`);
    if (!m || !Array.isArray(x.cell) || x.cell.length !== 2 || x.cell[0] !== Number(m[1]) || x.cell[1] !== Number(m[2]) || !Array.isArray(x.f)) throw unavailable(`landmark cell ${cell} is malformed.`);
    const features = [];
    for (const r of x.f) {
      if (!Array.isArray(r) || !isP(r[6])) throw unavailable(`landmark cell ${cell} contains invalid position uncertainty.`);
      // Reject the whole response, not just the bad row: neither a partial
      // shortlist nor invented ranking metadata may be cached as success.
      if (r.length !== 7 || typeof r[0] !== "string" || !r[0].trim() || [...r[0]].length > NAME_MAX || r[0].normalize("NFC") !== r[0] ||
          !index.kinds.has(r[1]) || !latLon(r[2], r[3]) ||
          r[2] < x.cell[0] || r[2] >= x.cell[0] + 1 || r[3] < x.cell[1] || r[3] >= x.cell[1] + 1 ||
          [r[2], r[3]].some((v) => Math.abs(v * 1e5 - Math.round(v * 1e5)) > 1e-8) ||
          !Number.isInteger(r[4]) || !num(r[5]) || r[5] < 0.5 || r[5] > 2 || Math.abs(r[5] * 10 - Math.round(r[5] * 10)) > 1e-4)
        throw unavailable(`landmark cell ${cell} contains an invalid feature.`);
      // Keep the existing display/sidecar name policy consistent. Published
      // Overture names can contain harmless directional marks; strip controls
      // before either rendering or identity matching, never after selection.
      const name = text(r[0]);
      if (!name) throw unavailable(`landmark cell ${cell} contains an empty feature name.`);
      const f = { name, kind: r[1], lat: r[2], lon: r[3], e: r[4], w: r[5], p: r[6], positionM: r[6], dataset: index.dataset };
      // Peaks may count beyond the solver's default 40 km.
      if (TERRAIN.has(f.kind)) f.maxKm = 100;
      features.push(f);
    }
    return { features, declination: num(x.declination) && Math.abs(x.declination) <= 180 ? x.declination : null };
  }
  const parseCell = (index, cell, body) => readCell(index, cell, body).features;
  // Identity of a landmark: name, kind and position to 5 decimals (no OSM ids).
  const featureKey = (f) => [f.name, f.kind || "", f.lat.toFixed(5), f.lon.toFixed(5)].join("|");
  const sameFeature = (a, b) => {
    if (featureKey(a) === featureKey(b)) return true;
    // Old OSM marks have no kind. Reselecting the same named position replaces
    // its observation rather than giving the solver duplicate evidence.
    const legacy = (f) => !f.kind && ["node", "way", "relation"].includes(f.osmType) && Number.isInteger(f.osmId);
    return (legacy(a) || legacy(b)) && a.name === b.name && a.lat.toFixed(5) === b.lat.toFixed(5) && a.lon.toFixed(5) === b.lon.toFixed(5);
  };
  const coverageNote = (data) => data.partialCoverage ? "Partial coverage: some search-area cells are outside this dataset; landmarks may be missing." : "";
  // Features of the downloaded cells within the radius, deduplicated.
  function within(features, viewer, radiusKm) {
    const seen = new Set();
    return features.filter((f) => metres(viewer, f) <= radiusKm * 1000 && !seen.has(featureKey(f)) && seen.add(featureKey(f)));
  }
  const cacheKey = (viewer, radiusKm) => viewer.lat.toFixed(5) + "," + viewer.lon.toFixed(5) + "," + radiusKm;
  const COUNTRIES = { DE: "Germany", AT: "Austria" };
  function outsideMessage(coverage) {
    const names = coverage.map((c) => COUNTRIES[c] || c);
    const list = names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0];
    return "No landmark data here yet." + (list ? ` ${list} for now.` : "");
  }
  // net.http failures and statuses from the data host → one "unavailable" error
  // naming the gate. Only a denied grant has no retry.
  function httpProblem(error, status) {
    if (num(status)) return dataError("DATA_STATUS", `Landmark data unavailable: the data host answered HTTP ${status}. Retry later.`);
    const code = (error && error.code) || "HTTP_UNAVAILABLE";
    const messages = {
      CAPABILITY_DENIED: "Internet access is off for Aimé. Turn it on in Construct menu → Module access.",
      HTTP_SIZE: "the data host sent a file Construct could not accept (size).",
      SIZE_LIMIT: "the data host sent a file Construct could not accept (size).",
      HTTP_DATA: "the data host sent a file Construct could not accept (type or size).",
      HTTP_RATE: "too many requests from this module. Wait a minute, then retry.",
      HTTP_BUSY: "other requests are still running. Retry in a moment.",
      HTTP_UNAVAILABLE: "the data host could not be reached (offline or timed out). Retry when online.",
      TIMEOUT: "the data host did not answer in time. Retry.",
    };
    if (code === "CAPABILITY_DENIED") return dataError(code, messages[code], false);
    return dataError(code, "Landmark data unavailable: " + (messages[code] || (error && error.message) || "download failed."));
  }
  // At most `n` tasks at once, in call order.
  function limiter(n) {
    let active = 0;
    const queue = [];
    const next = () => {
      if (active >= n || !queue.length) return;
      active++;
      const { fn, resolve, reject } = queue.shift();
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => {
          active--;
          next();
        });
    };
    return (fn) => new Promise((resolve, reject) => (queue.push({ fn, resolve, reject }), next()));
  }
  // Landmark data over get(url) → Promise<JSON text> (throws the errors above).
  // The index is fetched once per session and cells once per dataset and cell;
  // only successes are kept, so a retry downloads just what failed.
  function landmarkData(get, concurrency = DATA_CONCURRENCY) {
    const limit = limiter(concurrency),
      cells = new Map(),
      jobs = new Map();
    let index = null,
      indexJob = null;
    function loadIndex() {
      if (index) return Promise.resolve(index);
      if (!indexJob)
        indexJob = limit(() => get(INDEX_URL))
          .then(parseIndex)
          .then((i) => (index = i))
          .finally(() => (indexJob = null));
      return indexJob;
    }
    // Cached per dataset and cell as {features, declination}.
    function cell(ix, name) {
      const key = cellKey(ix, name);
      if (cells.has(key)) return Promise.resolve(cells.get(key));
      if (!jobs.has(key))
        jobs.set(key, limit(() => get(cellUrl(ix, name)))
          .then((body) => {
            const c = readCell(ix, name, body);
            cells.set(key, c);
            return c;
          })
          .finally(() => jobs.delete(key)));
      return jobs.get(key);
    }
    // Declination of the downloaded cell containing the viewpoint, or null
    // (not downloaded, not listed, or the cell carries none).
    const declinationAt = (viewer) => {
      const c = index && viewer && latLon(viewer.lat, viewer.lon) && cells.get(cellKey(index, Math.floor(viewer.lat) + "_" + Math.floor(viewer.lon)));
      return c ? c.declination : null;
    };
    return {
      get index() {
        return index;
      },
      loadIndex,
      declinationAt,
      // → {features, dataset, cells, partialCoverage, declination (the
      // viewpoint cell's, or null)}; outside coverage throws OUTSIDE_COVERAGE.
      async features(viewer, radiusKm) {
        const ix = await loadIndex(),
          plan = cellPlan(ix, viewer, radiusKm);
        if (!plan.length) throw dataError("OUTSIDE_COVERAGE", outsideMessage(ix.coverage), false);
        const lists = await Promise.all(plan.map((c) => cell(ix, c)));
        return { features: within(lists.flatMap((c) => c.features), viewer, radiusKm), dataset: ix.dataset, cells: plan.length,
          partialCoverage: plan.length < cellsAround(viewer.lat, viewer.lon, radiusKm).length, declination: declinationAt(viewer) };
      },
    };
  }

  // ---- Local name search --------------------------------------------------
  const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  // Nearest first; with `toward` {bearing, stepDeg} (the tapped direction and
  // its uncertainty) by angular distance from that direction in steps of
  // `stepDeg`, then nearest first within a step. Rows carry `offDeg` then.
  function search(features, query, viewer, limit = 30, toward = null) {
    const q = fold(text(query, 120));
    const off = (f) => Math.abs(((((bearing(viewer, f) - toward.bearing) % 360) + 540) % 360) - 180);
    const row = (f) => ({ feature: f, distanceM: viewer ? metres(viewer, f) : null, ...(toward && viewer ? { offDeg: off(f) } : {}) });
    const step = toward ? Math.max(1, toward.stepDeg) : 1,
      bucket = (r) => (r.offDeg == null ? 0 : Math.floor(r.offDeg / step));
    const hits = features.filter((f) => !q || fold(f.name).includes(q));
    return hits
      .map(row)
      .sort((a, b) => bucket(a) - bucket(b) || (a.distanceM ?? 0) - (b.distanceM ?? 0) || a.feature.name.localeCompare(b.feature.name))
      .slice(0, limit);
  }

  // ---- Calibration and shortlist ------------------------------------------
  function markFrom(feature, x, y) {
    return cleanMark({ x, y, kind: feature.kind, name: feature.name, lat: feature.lat, lon: feature.lon, positionM: feature.positionM, dataset: feature.dataset });
  }
  // Stored capture → the solver's measured-pose arguments. Each group is used
  // only when present, fresh and meaningful for the image as opened; the
  // reason it was skipped is reported instead. Thresholds follow API 0.13:
  // tilt ≤ 250 ms old and within the solver's ±89°; a lens angle within the
  // solver's 20–120° whose h/v agree with the opened image's aspect (h runs
  // across the image, the solver's axis); a magnetic heading ≤ 1 s old, at
  // most ±45°, and only with the viewpoint cell's declination (true = magnetic
  // + declination east).
  const TILT_MAX_AGE_MS = 250,
    HEADING_MAX_AGE_MS = 1000;
  function measuredInputs(capture, width, height, declination = null) {
    const input = {},
      used = { level: false, lens: false, compass: false },
      skipped = {},
      c = capture || {};
    const t = c.tilt;
    if (t) {
      if (t.ageMs > TILT_MAX_AGE_MS) skipped.level = "old";
      else if (Math.abs(t.pitchDeg) > 89 || Math.abs(t.rollDeg) > 89) skipped.level = "sideways";
      else (input.tilt = { pitch: t.pitchDeg, roll: t.rollDeg, sigma: Math.max(1, t.sigmaDeg) }), (used.level = true);
    }
    const f = c.fovDeg;
    if (f) {
      const r = (d) => Math.tan((d * Math.PI) / 360),
        aspect = width > 0 && height > 0 ? height / width : NaN;
      if (f.h < 20 || f.h > 120) skipped.lens = "range";
      else if (!(Math.abs(r(f.v) / r(f.h) / aspect - 1) <= 0.03)) skipped.lens = "orientation";
      else (input.fov = f.h), (input.fovSigma = c.fovSigmaDeg), (used.lens = true);
    }
    if (num(c.headingDeg)) {
      if (c.headingAgeMs > HEADING_MAX_AGE_MS || c.headingAccuracyDeg > 45) skipped.compass = "unreliable";
      else if (!inRange(declination, -180, 180)) skipped.compass = "declination";
      else
        Object.assign(input, { heading: c.headingDeg, headingRef: "magnetic", declination, headingSigma: Math.max(12, c.headingAccuracyDeg) }), (used.compass = true);
    }
    return { input, used, skipped };
  }
  // True compass direction of the camera's axis, or null (see measuredInputs).
  const compassHeading = (capture, declination) => {
    const m = measuredInputs(capture ? { headingDeg: capture.headingDeg, headingAccuracyDeg: capture.headingAccuracyDeg, headingAgeMs: capture.headingAgeMs } : null, 1, 1, declination);
    return m.used.compass ? { bearing: (((m.input.heading + m.input.declination) % 360) + 360) % 360, sigmaDeg: Math.max(12, m.input.headingSigma) } : null;
  };
  function calibrationInput(sidecar, width, height, declination = null) {
    const v = sidecar.viewer;
    return {
      viewer: { lat: v.lat, lon: v.lon, accuracyM: v.accuracyM ?? undefined },
      marks: sidecar.marks.map((m) => ({ x: m.x, y: m.y, point: { lat: m.lat, lon: m.lon }, positionM: m.positionM })),
      horizon: sidecar.horizon.map((h) => ({ x: h.x, y: h.y })),
      width,
      height,
      ...measuredInputs(sidecar.capture, width, height, declination).input,
    };
  }
  const candidatesOf = (features) =>
    features.map((f) => ({ point: { lat: f.lat, lon: f.lon }, weight: f.w, maxKm: f.maxKm, positionM: f.positionM, feature: f }));
  // Ranked results → what the sheet shows. Up to five, best first. With no
  // `close` result: "no close match" and the two angularly nearest, greyed.
  function shortlist(ranked, max = 5) {
    const anyClose = ranked.some((r) => r.close);
    if (anyClose) return { anyClose, rows: ranked.slice(0, max).map((r) => ({ ...r, greyed: !r.close })) };
    const nearest = [...ranked].sort((a, b) => Math.abs(a.deltaDeg) - Math.abs(b.deltaDeg)).slice(0, 2);
    return { anyClose, rows: nearest.map((r) => ({ ...r, greyed: true })) };
  }
  // "close by, so your position matters more" when the comparison σ is much
  // wider than the direction σ.
  const positionMatters = (row) => row.sigmaDeg > 2 * row.wedgeSigmaDeg && row.sigmaDeg - row.wedgeSigmaDeg > 2;

  // ---- Point editing: hit test, drag, one-step undo --------------------------
  // Gesture thresholds in CSS pixels and milliseconds (Pocket Measure's values).
  const HIT_PX = 26,
    TAP_SLOP = 8,
    HOLD_MS = 350,
    LOUPE_MAGNIFICATION = 2.5;
  const unit = (v) => Math.max(0, Math.min(1, v));
  // Nearest mark or horizon point within `maxPx` of (x, y) on a photo shown
  // `w` × `h` pixels → {list: "marks"|"horizon", index}, or null. Marks win ties.
  function hitPoint(sidecar, x, y, w, h, maxPx = HIT_PX) {
    let best = null;
    for (const list of ["marks", "horizon"])
      sidecar[list].forEach((p, index) => {
        const d = Math.hypot((p.x - x) * w, (p.y - y) * h);
        if (d <= maxPx && (!best || d < best.d)) best = { list, index, d };
      });
    return best && { list: best.list, index: best.index };
  }
  // The sidecar with one point moved (clamped to the photo); nothing else changes.
  const movePoint = (sidecar, hit, x, y) => ({ ...sidecar, [hit.list]: sidecar[hit.list].map((p, i) => (i === hit.index ? { ...p, x: unit(x), y: unit(y) } : p)) });
  const pointName = (sidecar, hit) => (hit.list === "marks" ? sidecar.marks[hit.index].name : "horizon point " + (hit.index + 1));
  // A drag previews in memory only; `release(commit)` hands the moved sidecar
  // to `commit` once, and only when the point actually moved.
  function pointDrag(sidecar, hit) {
    let preview = sidecar,
      open = true;
    return {
      hit,
      get preview() {
        return preview;
      },
      get moved() {
        return preview !== sidecar;
      },
      move(x, y) {
        if (open) preview = movePoint(sidecar, hit, x, y);
        return preview;
      },
      cancel() {
        open = false;
        preview = sidecar;
      },
      async release(commit) {
        if (!open) return false;
        open = false;
        const p = preview[hit.list][hit.index],
          q = sidecar[hit.list][hit.index];
        if (p.x === q.x && p.y === q.y) return false;
        await commit(preview);
        return true;
      },
    };
  }
  // One undo step: the photo's marks and horizon before its last add, move or
  // delete. Undo restores both lists and leaves viewpoint and radius alone.
  const undoStep = (id, sidecar, label) => ({ id, label, marks: sidecar.marks.map((m) => ({ ...m })), horizon: sidecar.horizon.map((h) => ({ ...h })) });
  const undone = (sidecar, step) => cleanSidecar({ ...sidecar, marks: step.marks, horizon: step.horizon });

  // ---- Magnifier geometry (Pocket Measure's loupe) ----------------------------
  // Crop for a photo point: source rectangle in image pixels plus where it lands
  // inside the loupe, so edge crops stay centred on the point.
  function loupe(point, width, height, fitWidth, diameter, magnification = LOUPE_MAGNIFICATION) {
    if (!inUnit(point.x) || !inUnit(point.y) || !(width > 0 && height > 0 && fitWidth > 0 && diameter > 0 && magnification > 0)) throw new Error("Magnifier needs a photo point.");
    const half = (diameter / 2 / magnification) * (width / fitWidth),
      cx = point.x * width,
      cy = point.y * height,
      x = Math.max(0, cx - half),
      y = Math.max(0, cy - half),
      scale = diameter / (half * 2);
    return { x, y, w: Math.max(0, Math.min(width, cx + half) - x), h: Math.max(0, Math.min(height, cy + half) - y), scale, dx: (x - (cx - half)) * scale, dy: (y - (cy - half)) * scale };
  }
  // Loupe centre: lifted above the finger, flipped below near the top, clamped inside the view.
  function loupePlacement(finger, width, height, diameter, lift) {
    const r = diameter / 2,
      clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
    return { x: clamp(finger.x, r, Math.max(r, width - r)), y: clamp(finger.y - lift - r >= 0 ? finger.y - lift : finger.y + lift, r, Math.max(r, height - r)), r };
  }

  // ---- Map pin in the photo (Resection.locate) -------------------------------
  // locate result → what the photo overlay draws. In frame: the bearing line and
  // the ±2σ band as frame-clipped polygons from the reference solver. Out of frame: an arrow on the matching
  // edge, pointing out (degrees, 0 = right, 90 = down), kept off the corners.
  const ARROW = { left: 180, right: 0, above: -90, below: 90, "behind-left": 180, "behind-right": 0 };
  function pinOverlay(loc) {
    if (loc.inFrame) {
      return { line: loc.line, bands: loc.bandPolygons, anchor: loc.anchor, arrow: null };
    }
    const a = loc.anchor,
      inset = (v) => Math.max(0.06, Math.min(0.94, v)),
      vertical = loc.side === "above" || loc.side === "below";
    return { line: [], bands: [], anchor: a, arrow: { x: vertical ? inset(a.x) : a.x, y: vertical ? a.y : inset(a.y), angle: ARROW[loc.side] } };
  }
  const WHERE = { left: "out of frame to the left", right: "out of frame to the right", above: "above the photo", below: "below the photo", "behind-left": "behind you, to the left", "behind-right": "behind you, to the right" };
  // "Synthetic Peak B: in the photo · 18 km · 42° NE · band ±7.2° (2σ)".
  const pinText = (loc, name = "Pin") =>
    `${name}: ${loc.inFrame ? "in the photo" : WHERE[loc.side]} · ${range(loc.distanceKm, loc.bearing)}${loc.inFrame ? ` · band ±${(2 * loc.sigmaDeg).toFixed(1)}° (2σ)` : ""}`;

  // ---- Formatting ---------------------------------------------------------
  const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
  const km = (d) => (d < 1 ? Math.round(d * 1000) + " m" : d < 10 ? d.toFixed(1) + " km" : Math.round(d) + " km");
  const signed = (d) => (d >= 0 ? "+" : "−") + Math.abs(d).toFixed(1) + "°";
  // Distance and bearing as the photo, the sheets and the map show them: "12 km · 47° NE".
  const degrees = (b) => ((Math.round(b) % 360) + 360) % 360;
  const range = (distanceKm, bearingDeg) => km(distanceKm) + " · " + degrees(bearingDeg) + "° " + compass(bearingDeg);
  function age(ms) {
    if (!num(ms) || ms < 0) return "unknown age";
    const s = Math.round(ms / 1000);
    return s < 90 ? s + " s" : s < 5400 ? Math.round(s / 60) + " min" : s < 172800 ? Math.round(s / 3600) + " h" : Math.round(s / 86400) + " days";
  }
  // Every contract kind reads as words; unknown kinds fall back to their name.
  const KIND_LABEL = { observation: "observation tower", cooling: "cooling tower" };
  const kindLabel = (f) => (f && isKind(f.kind) ? KIND_LABEL[f.kind] || f.kind.replace(/_/g, " ") : "landmark");
  // "2400 m" for terrain, "80 m tall" for structures, "" when unknown.
  const sizeLabel = (f) => (num(f.e) && f.e > 0 ? Math.round(f.e) + (TERRAIN.has(f.kind) ? " m" : " m tall") : "");

  return {
    RADII,
    DEFAULT_RADIUS,
    MAX_MARKS,
    MAX_HORIZON,
    NAME_MAX,
    DATA_ORIGIN,
    INDEX_URL,
    DATA_CONCURRENCY,
    OLD_FIX_MS,
    LONG_WAIT_MS,
    LOCATION_SPACING_MS,
    MAX_SLOTS,
    INDEX_KEY,
    MESSAGE_LIMIT,
    MESSAGE_BUDGET,
    cleanSidecar,
    cleanCapture,
    newSidecar,
    recordKey,
    loadIndex,
    indexValue,
    recordValue,
    recordFor,
    planPut,
    planRelease,
    envelopeLength,
    checkEnvelope,
    persistence,
    listIds,
    captureId,
    fixFrom,
    metres,
    bearing,
    chooseViewpoint,
    queryable,
    cellsAround,
    parseIndex,
    cellUrl,
    cellKey,
    cellPlan,
    parseCell,
    readCell,
    featureKey,
    sameFeature,
    coverageNote,
    within,
    cacheKey,
    outsideMessage,
    httpProblem,
    limiter,
    landmarkData,
    search,
    markFrom,
    TILT_MAX_AGE_MS,
    HEADING_MAX_AGE_MS,
    measuredInputs,
    compassHeading,
    calibrationInput,
    candidatesOf,
    shortlist,
    positionMatters,
    HIT_PX,
    TAP_SLOP,
    HOLD_MS,
    LOUPE_MAGNIFICATION,
    hitPoint,
    movePoint,
    pointName,
    pointDrag,
    undoStep,
    undone,
    loupe,
    loupePlacement,
    pinOverlay,
    pinText,
    compass,
    km,
    signed,
    degrees,
    range,
    age,
    kindLabel,
    sizeLabel,
  };
})();
if (typeof module !== "undefined") module.exports = AimeCore;
