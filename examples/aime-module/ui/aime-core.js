"use strict";
// Aimé module logic without DOM or host calls: per-photo sidecars keyed by the
// API 0.12 stable photo id, capture association, orphan reconciliation, the
// Overpass query and parser, local name search and the candidates shortlist.
// Global `AimeCore` in the module, CommonJS under Node for scripts/test_aime.cjs.
const AimeCore = (() => {
  const RADII = [10, 30, 60],
    DEFAULT_RADIUS = 30,
    MAX_MARKS = 6,
    MAX_HORIZON = 2,
    NAME_MAX = 80,
    OVERPASS_CAP = 400,
    OVERPASS_ORIGIN = "https://overpass-api.de",
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
  // the storage request when escaped.
  const text = (s, max = NAME_MAX) => (typeof s === "string" ? s.replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, "").trim().slice(0, max) : "");
  const inUnit = (v) => num(v) && v >= 0 && v <= 1;
  const latLon = (lat, lon) => num(lat) && num(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const OSM_TYPES = ["node", "way", "relation"];

  // ---- Sidecars -------------------------------------------------------------
  // Shape (brief): { viewer: {lat, lon, accuracyM, timestamp, approximate, corrected,
  // review}, radiusKm, marks: [{x, y, osmType, osmId, name, lat, lon, positionM}],
  // horizon: [{x, y}] }. `review` (not in the brief's list) marks a viewpoint that
  // must be confirmed or corrected before any feature query.
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
  function cleanMark(m) {
    if (!m || !inUnit(m.x) || !inUnit(m.y) || !OSM_TYPES.includes(m.osmType) || !Number.isSafeInteger(m.osmId) || !latLon(m.lat, m.lon)) return null;
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
  function cleanSidecar(raw) {
    if (!raw || typeof raw !== "object") return null;
    return {
      viewer: cleanViewer(raw.viewer),
      radiusKm: RADII.includes(raw.radiusKm) ? raw.radiusKm : DEFAULT_RADIUS,
      marks: (Array.isArray(raw.marks) ? raw.marks : []).map(cleanMark).filter(Boolean).slice(0, MAX_MARKS),
      horizon: (Array.isArray(raw.horizon) ? raw.horizon : [])
        .filter((h) => h && inUnit(h.x) && inUnit(h.y))
        .map((h) => ({ x: h.x, y: h.y }))
        .slice(0, MAX_HORIZON),
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
  function newSidecar(viewer, radiusKm = DEFAULT_RADIUS) {
    return cleanSidecar({ viewer, radiusKm, marks: [], horizon: [] });
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
  // Exactly one new id between two successful complete lists, else null.
  function associate(beforeIds, afterIds) {
    const before = new Set(beforeIds),
      fresh = afterIds.filter((id) => !before.has(id));
    return fresh.length === 1 ? fresh[0] : null;
  }

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
  // A viewpoint that may be sent to Overpass.
  const queryable = (viewer) => !!viewer && !viewer.review;

  // ---- Overpass -----------------------------------------------------------
  function overpassQuery(lat, lon, radiusKm) {
    if (!latLon(lat, lon) || !RADII.includes(radiusKm)) throw new Error("Viewpoint and a 10/30/60 km radius are required.");
    const a = `(around:${radiusKm * 1000},${lat.toFixed(5)},${lon.toFixed(5)})`;
    return [
      "[out:json][timeout:20];",
      "(",
      `  nwr${a}["name"]["natural"="peak"];`,
      `  nwr${a}["name"]["man_made"~"^(tower|mast|lighthouse|windmill|chimney|water_tower|communications_tower)$"];`,
      `  nwr${a}["name"]["building"~"^(cathedral|church|chapel|castle|tower|mosque|synagogue|temple)$"];`,
      `  nwr${a}["name"]["historic"~"^(castle|monument|tower|fort|ruins)$"];`,
      `  nwr${a}["name"]["tourism"~"^(attraction|viewpoint)$"];`,
      `  nwr${a}["name"]["aeroway"="aerodrome"];`,
      ");",
      `out tags center ${OVERPASS_CAP};`,
    ].join("\n");
  }
  const overpassUrl = (lat, lon, radiusKm) => OVERPASS_ORIGIN + "/api/interpreter?data=" + encodeURIComponent(overpassQuery(lat, lon, radiusKm));
  const featureKey = (f) => f.osmType + "/" + f.osmId;
  const cacheKey = (viewer, radiusKm) => viewer.lat.toFixed(5) + "," + viewer.lon.toFixed(5) + "," + radiusKm;
  // Matching kind tag, in query order; the first match names the kind.
  const KINDS = [
    ["natural", /^peak$/],
    ["man_made", /^(tower|mast|lighthouse|windmill|chimney|water_tower|communications_tower)$/],
    ["building", /^(cathedral|church|chapel|castle|tower|mosque|synagogue|temple)$/],
    ["historic", /^(castle|monument|tower|fort|ruins)$/],
    ["tourism", /^(attraction|viewpoint)$/],
    ["aeroway", /^aerodrome$/],
  ];
  const measure = (s) => {
    const m = typeof s === "string" && s.trim().match(/^(-?\d+(?:\.\d+)?)\s*(m)?$/);
    return m ? Number(m[1]) : null;
  };
  // Visibility prior (brief): peak with ele 1.5, tower/mast/cathedral 1.3,
  // castle/monument 1.1, viewpoint 0.8, other 1.0. Peaks may count beyond 40 km.
  function weightOf(f) {
    if (f.kindTag === "natural" && num(f.ele)) return 1.5;
    if (["tower", "mast", "communications_tower", "cathedral"].includes(f.kind)) return 1.3;
    if (["castle", "monument"].includes(f.kind)) return 1.1;
    if (f.kind === "viewpoint") return 0.8;
    return 1;
  }
  // Overpass JSON text → {features, incomplete}. Malformed data throws; it is
  // never an empty result.
  function parseOverpass(textBody) {
    let data;
    try {
      data = JSON.parse(textBody);
    } catch {
      throw Object.assign(new Error("Overpass returned unreadable data."), { code: "OVERPASS_DATA" });
    }
    if (!data || !Array.isArray(data.elements)) throw Object.assign(new Error("Overpass returned unexpected data."), { code: "OVERPASS_DATA" });
    // Runtime timeouts/resource failures can arrive as HTTP 200 with an empty
    // or partial elements array. Never cache these as a complete feature list.
    if (typeof data.remark === "string" && data.remark.trim())
      throw Object.assign(new Error("Overpass could not complete the lookup. Retry, or pick a smaller radius."), { code: "OVERPASS_INCOMPLETE" });
    const seen = new Set(),
      features = [];
    for (const e of data.elements) {
      if (!e || !OSM_TYPES.includes(e.type) || !Number.isSafeInteger(e.id) || !e.tags) continue;
      const name = text(e.tags.name);
      const at = e.type === "node" ? e : e.center;
      if (!name || !at || !latLon(at.lat, at.lon)) continue;
      const match = KINDS.find(([k, re]) => typeof e.tags[k] === "string" && re.test(e.tags[k]));
      if (!match) continue;
      const f = {
        osmType: e.type,
        osmId: e.id,
        name,
        lat: at.lat,
        lon: at.lon,
        kindTag: match[0],
        kind: e.tags[match[0]],
        ele: measure(e.tags.ele),
        height: measure(e.tags.height),
        positionM: e.type === "node" ? 8 : 30,
      };
      if (seen.has(featureKey(f))) continue;
      seen.add(featureKey(f));
      f.weight = weightOf(f);
      if (f.kindTag === "natural") f.maxKm = 100;
      features.push(f);
    }
    return { features, incomplete: data.elements.length >= OVERPASS_CAP };
  }
  // net.http failures and statuses → one message naming the gate.
  function httpProblem(error, status) {
    if (status === 429) return { code: "OVERPASS_BUSY", message: "Overpass is busy (429). Wait a minute, then retry.", retry: true };
    if (status === 504) return { code: "OVERPASS_BUSY", message: "Overpass timed out (504). Retry, or pick a smaller radius.", retry: true };
    if (num(status)) return { code: "OVERPASS_STATUS", message: `Overpass answered HTTP ${status}. Retry later.`, retry: true };
    const code = (error && error.code) || "HTTP_UNAVAILABLE";
    const messages = {
      CAPABILITY_DENIED: "Internet access is off for Aimé. Turn it on in Construct menu → Module access.",
      HTTP_SIZE: "The feature list was too large for one request. Pick a smaller radius.",
      SIZE_LIMIT: "The feature list was too large for one request. Pick a smaller radius.",
      HTTP_DATA: "Overpass sent data Construct could not accept (type or size). Pick a smaller radius or retry.",
      HTTP_RATE: "Too many requests from this module. Wait a minute, then retry.",
      HTTP_BUSY: "Other requests are still running. Retry in a moment.",
      HTTP_UNAVAILABLE: "Overpass could not be reached (offline or timed out). Retry when online.",
      TIMEOUT: "Overpass did not answer in time. Retry, or pick a smaller radius.",
    };
    return { code, message: messages[code] || (error && error.message) || "Feature lookup failed.", retry: code !== "CAPABILITY_DENIED" };
  }

  // ---- Local name search --------------------------------------------------
  const fold = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  // Typed OSM ids: "node/123", "way 45", "r678" or a bare number.
  function parseOsmId(q) {
    const m = q.trim().toLowerCase().match(/^(?:(node|way|relation|n|w|r)\s*[/ ]?\s*)?(\d{1,15})$/);
    if (!m) return null;
    const type = { n: "node", w: "way", r: "relation" }[m[1]] || m[1] || null;
    return { type, id: Number(m[2]) };
  }
  function search(features, query, viewer, limit = 30) {
    const q = fold(text(query, 120)),
      typed = parseOsmId(query || "");
    const withDistance = (f) => ({ feature: f, distanceM: viewer ? metres(viewer, f) : null });
    const hits = features.filter((f) =>
      typed ? f.osmId === typed.id && (!typed.type || f.osmType === typed.type) : !q || fold(f.name).includes(q),
    );
    return hits
      .map(withDistance)
      .sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0) || a.feature.name.localeCompare(b.feature.name))
      .slice(0, limit);
  }

  // ---- Calibration and shortlist ------------------------------------------
  function markFrom(feature, x, y) {
    return cleanMark({ x, y, osmType: feature.osmType, osmId: feature.osmId, name: feature.name, lat: feature.lat, lon: feature.lon, positionM: feature.positionM });
  }
  function calibrationInput(sidecar, width, height) {
    const v = sidecar.viewer;
    return {
      viewer: { lat: v.lat, lon: v.lon, accuracyM: v.accuracyM ?? undefined },
      marks: sidecar.marks.map((m) => ({ x: m.x, y: m.y, point: { lat: m.lat, lon: m.lon }, positionM: m.positionM })),
      horizon: sidecar.horizon.map((h) => ({ x: h.x, y: h.y })),
      width,
      height,
    };
  }
  const candidatesOf = (features) =>
    features.map((f) => ({ point: { lat: f.lat, lon: f.lon }, weight: f.weight, maxKm: f.maxKm, positionM: f.positionM, feature: f }));
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

  // ---- Formatting ---------------------------------------------------------
  const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
  const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
  const km = (d) => (d < 1 ? Math.round(d * 1000) + " m" : d < 10 ? d.toFixed(1) + " km" : Math.round(d) + " km");
  const signed = (d) => (d >= 0 ? "+" : "−") + Math.abs(d).toFixed(1) + "°";
  function age(ms) {
    if (!num(ms) || ms < 0) return "unknown age";
    const s = Math.round(ms / 1000);
    return s < 90 ? s + " s" : s < 5400 ? Math.round(s / 60) + " min" : s < 172800 ? Math.round(s / 3600) + " h" : Math.round(s / 86400) + " days";
  }
  const KIND_LABEL = { natural: "peak", aeroway: "airfield" };
  const kindLabel = (f) => (KIND_LABEL[f.kindTag] || String(f.kind || "feature")).replace(/_/g, " ");

  return {
    RADII,
    DEFAULT_RADIUS,
    MAX_MARKS,
    MAX_HORIZON,
    NAME_MAX,
    OVERPASS_CAP,
    OLD_FIX_MS,
    LONG_WAIT_MS,
    LOCATION_SPACING_MS,
    MAX_SLOTS,
    INDEX_KEY,
    MESSAGE_LIMIT,
    MESSAGE_BUDGET,
    cleanSidecar,
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
    associate,
    fixFrom,
    metres,
    chooseViewpoint,
    queryable,
    overpassQuery,
    overpassUrl,
    featureKey,
    cacheKey,
    parseOverpass,
    httpProblem,
    parseOsmId,
    search,
    markFrom,
    calibrationInput,
    candidatesOf,
    shortlist,
    positionMatters,
    compass,
    km,
    signed,
    age,
    kindLabel,
  };
})();
if (typeof module !== "undefined") module.exports = AimeCore;
