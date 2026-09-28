"use strict";
// Orbit maths for Space Watch: CelesTrak OMM records → bounded compact rows →
// SGP4 look angles, sunlight and visibility for one observer. Pure; no I/O.
const SpaceOrbit = (() => {
  const S =
    typeof satellite !== "undefined"
      ? satellite
      : require("./vendor/satellite.min.js");
  const RE = 6378.137,
    MAX_OBJECTS = 400,
    VISIBLE_EL = 10,
    DARK_SUN = -6,
    rad = (x) => (x * Math.PI) / 180,
    deg = (x) => (x * 180) / Math.PI,
    wrap = (x) => ((x % 360) + 360) % 360;
  const num = (x, min, max) =>
    typeof x === "number" && Number.isFinite(x) && x >= min && x <= max
      ? x
      : null;
  const text = (x, n = 40) =>
    typeof x === "string"
      ? x
          .replace(/[^\x20-\x7e]/g, "")
          .trim()
          .slice(0, n) || null
      : null;
  const EPOCH = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d{1,6})?Z?$/;
  const INTDES = /^\d{4}-\d{3}[A-Z]{1,3}$/;

  // Compact row: [id, name, intdes|null, epochMs, n, e, i, raan, argp, M, bstar, ndot, nddot]
  function compact(o) {
    if (!o || typeof o !== "object") return null;
    const id = o.NORAD_CAT_ID,
      name = text(o.OBJECT_NAME),
      epoch =
        typeof o.EPOCH === "string" && EPOCH.test(o.EPOCH)
          ? Date.parse(o.EPOCH.endsWith("Z") ? o.EPOCH : o.EPOCH + "Z")
          : NaN;
    const f = [
      num(o.MEAN_MOTION, 0.05, 20),
      num(o.ECCENTRICITY, 0, 0.99),
      num(o.INCLINATION, 0, 180),
      num(o.RA_OF_ASC_NODE, 0, 360),
      num(o.ARG_OF_PERICENTER, 0, 360),
      num(o.MEAN_ANOMALY, 0, 360),
      num(o.BSTAR, -1, 1),
      num(o.MEAN_MOTION_DOT, -1, 1),
      num(o.MEAN_MOTION_DDOT, -1, 1),
    ];
    if (
      !Number.isInteger(id) ||
      id < 1 ||
      id > 999999999 ||
      !name ||
      !Number.isFinite(epoch) ||
      f.some((v) => v === null)
    )
      return null;
    const intdes =
      typeof o.OBJECT_ID === "string" && INTDES.test(o.OBJECT_ID)
        ? o.OBJECT_ID
        : null;
    return [id, name, intdes, epoch, ...f];
  }
  // A cached row gets the same checks as a fresh record.
  function validRow(r) {
    if (!Array.isArray(r) || r.length !== 13) return null;
    const [id, name, intdes, epoch] = r;
    return compact({
      NORAD_CAT_ID: id,
      OBJECT_NAME: name,
      OBJECT_ID: intdes,
      EPOCH: Number.isFinite(epoch) && Math.abs(epoch) <= 8640000000000000
        ? new Date(epoch).toISOString() : null,
      MEAN_MOTION: r[4],
      ECCENTRICITY: r[5],
      INCLINATION: r[6],
      RA_OF_ASC_NODE: r[7],
      ARG_OF_PERICENTER: r[8],
      MEAN_ANOMALY: r[9],
      BSTAR: r[10],
      MEAN_MOTION_DOT: r[11],
      MEAN_MOTION_DDOT: r[12],
    });
  }
  function rows(list, check = compact) {
    if (!Array.isArray(list)) return [];
    const seen = new Set(),
      out = [];
    for (const o of list) {
      const r = check(o);
      if (!r || seen.has(r[0])) continue;
      seen.add(r[0]);
      out.push(r);
      if (out.length >= MAX_OBJECTS) break;
    }
    return out;
  }
  // CelesTrak answers JSON text; anything else (a notice, HTML) is not data.
  function parseElements(body) {
    let list;
    try {
      list = JSON.parse(body);
    } catch (_) {
      return [];
    }
    return rows(list);
  }
  function build(rowList) {
    const out = [];
    for (const r of rowList) {
      let rec;
      try {
        rec = S.json2satrec({
          NORAD_CAT_ID: r[0],
          EPOCH: new Date(r[3]).toISOString(),
          MEAN_MOTION: r[4],
          ECCENTRICITY: r[5],
          INCLINATION: r[6],
          RA_OF_ASC_NODE: r[7],
          ARG_OF_PERICENTER: r[8],
          MEAN_ANOMALY: r[9],
          BSTAR: r[10],
          MEAN_MOTION_DOT: r[11],
          MEAN_MOTION_DDOT: r[12],
        });
      } catch (_) {
        continue;
      }
      if (!rec || rec.error) continue;
      out.push({ id: r[0], name: r[1], intdes: r[2], epoch: r[3], rec, row: r });
    }
    return out;
  }
  function observer(lat, lon, heightKm = 0) {
    if (num(lat, -90, 90) === null || num(lon, -180, 180) === null) return null;
    return {
      lat,
      lon,
      gd: { latitude: rad(lat), longitude: rad(lon), height: heightKm },
    };
  }
  let sunCache = { t: NaN, v: null };
  // Unit vector to the Sun in the propagator's inertial frame, cached per second.
  function sunVector(ms) {
    const t = Math.floor(ms / 1000);
    if (t !== sunCache.t) {
      const r = S.sunPos(S.jday(new Date(t * 1000))).rsun,
        m = Math.hypot(r[0], r[1], r[2]);
      sunCache = { t, v: [r[0] / m, r[1] / m, r[2] / m] };
    }
    return sunCache.v;
  }
  // Cylindrical Earth shadow: good to a few seconds at shadow entry for LEO.
  function sunlit(p, ms) {
    const s = sunVector(ms),
      d = p.x * s[0] + p.y * s[1] + p.z * s[2];
    if (d > 0) return true;
    return (
      Math.hypot(p.x - d * s[0], p.y - d * s[1], p.z - d * s[2]) > RE
    );
  }
  function look(o, ob, ms) {
    let pv;
    try {
      pv = S.propagate(o.rec, new Date(ms));
    } catch (_) {
      return null;
    }
    const p = pv && pv.position,
      v = pv && pv.velocity;
    if (!p || typeof p !== "object" || !Number.isFinite(p.x)) return null;
    const altKm = Math.hypot(p.x, p.y, p.z) - RE;
    if (!(altKm > 80)) return null;
    const la = S.ecfToLookAngles(
      ob.gd,
      S.eciToEcf(p, S.gstime(new Date(ms))),
    );
    return {
      az: wrap(deg(la.azimuth)),
      el: deg(la.elevation),
      rangeKm: la.rangeSat,
      altKm,
      speedKms: Math.hypot(v.x, v.y, v.z),
      sunlit: sunlit(p, ms),
    };
  }
  // Inertial position in km, for comparing objects with each other (trains).
  function position(o, ms) {
    let pv;
    try {
      pv = S.propagate(o.rec, new Date(ms));
    } catch (_) {
      return null;
    }
    const p = pv && pv.position;
    return p && typeof p === "object" && Number.isFinite(p.x) ? p : null;
  }
  // visible: sunlit against a dark sky and high enough to clear most horizons.
  function state(l, sunAlt) {
    if (!l || l.el < 0) return "below";
    if (sunAlt >= DARK_SUN) return "daylight";
    if (!l.sunlit) return "shadow";
    return l.el >= VISIBLE_EL ? "visible" : "low";
  }
  function trail(o, ob, ms, from = -90, to = 90, step = 10) {
    const out = [];
    for (let k = from; k <= to; k += step) {
      const l = look(o, ob, ms + k * 1000);
      if (l) out.push({ t: k, az: l.az, el: l.el, sunlit: l.sunlit });
    }
    return out;
  }
  // When does the current visible stretch end, and why? Null when not visible now.
  function passEnd(o, ob, ms, sunAltAt, limitS = 1200) {
    const first = look(o, ob, ms);
    if (state(first, sunAltAt(ms)) !== "visible") return null;
    let last = first,
      lastT = 0;
    for (let s = 5; s <= limitS; s += 5) {
      const l = look(o, ob, ms + s * 1000);
      if (!l) return null;
      if (state(l, sunAltAt(ms + s * 1000)) !== "visible") {
        // Refine to the last whole second still visible: where it vanishes.
        let t = lastT;
        for (let u = lastT + 1; u < s; u++) {
          const q = look(o, ob, ms + u * 1000);
          if (state(q, sunAltAt(ms + u * 1000)) !== "visible") break;
          last = q;
          t = u;
        }
        return {
          atMs: ms + t * 1000,
          inS: t,
          reason: l.el < VISIBLE_EL ? "sets" : !l.sunlit ? "shadow" : "daylight",
          az: last.az,
          el: last.el,
        };
      }
      last = l;
      lastT = s;
    }
    return { atMs: ms + lastT * 1000, inS: lastT, reason: "long", az: last.az, el: last.el };
  }
  // Next rise above 10° after the current pass, with its highest point and
  // whether any part is visible. Coarse 30 s scan, refined to 5 s.
  function nextPass(o, ob, ms, sunAltAt, hours = 36) {
    const end = ms + hours * 3600000;
    let t = ms,
      l = look(o, ob, t);
    while (l && l.el >= VISIBLE_EL && t < end) {
      t += 30000;
      l = look(o, ob, t);
    }
    while (t < end) {
      t += 30000;
      l = look(o, ob, t);
      if (!l) return null;
      if (l.el < VISIBLE_EL) continue;
      let rise = t;
      for (let b = t - 5000; b > t - 30000; b -= 5000) {
        const q = look(o, ob, b);
        if (!q || q.el < VISIBLE_EL) break;
        rise = b;
      }
      let max = l,
        maxAt = t,
        visible = false;
      for (let u = rise; u < rise + 1800000; u += 10000) {
        const q = look(o, ob, u);
        if (!q || q.el < VISIBLE_EL) break;
        if (q.el > max.el) {
          max = q;
          maxAt = u;
        }
        if (!visible && q.sunlit && sunAltAt(u) < DARK_SUN) visible = true;
      }
      return { riseMs: rise, maxEl: max.el, maxAz: max.az, maxMs: maxAt, visible };
    }
    return null;
  }
  // storage.kv takes at most 8,192 characters per request: split rows by size.
  function chunks(list, maxChars = 6500) {
    const out = [];
    let cur = [],
      size = 2;
    for (const r of list) {
      const n = JSON.stringify(r).length + 1;
      if (cur.length && size + n > maxChars) {
        out.push(cur);
        cur = [];
        size = 2;
      }
      cur.push(r);
      size += n;
    }
    if (cur.length) out.push(cur);
    return out;
  }
  function ageHours(objects, ms) {
    if (!objects.length) return null;
    const ages = objects.map((o) => (ms - o.epoch) / 3600000).sort((a, b) => a - b);
    return ages[Math.floor(ages.length / 2)];
  }
  return {
    VISIBLE_EL,
    DARK_SUN,
    MAX_OBJECTS,
    compact,
    validRow,
    rows,
    parseElements,
    build,
    observer,
    look,
    position,
    state,
    trail,
    passEnd,
    nextPass,
    chunks,
    ageHours,
  };
})();
if (typeof module !== "undefined") module.exports = SpaceOrbit;
