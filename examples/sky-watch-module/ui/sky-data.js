"use strict";
const SkyData = (() => {
  const models =
    typeof module !== "undefined" ? require("./models.js") : SkyModels;
  const MAX_AGE = 120,
    STALE_AGE = 30,
    R = 6371.0088,
    rad = (x) => (x * Math.PI) / 180,
    deg = (x) => (x * 180) / Math.PI;
  const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const text = (x) =>
    typeof x === "string"
      ? x
          .replace(/[^\x20-\x7e]/g, "")
          .trim()
          .slice(0, 32) || null
      : null;
  const bound = (x, min, max) =>
    num(x) !== null && x >= min && x <= max ? x : null;
  const point = (lat, lon) =>
    bound(lat, -85, 85) !== null && bound(lon, -180, 180) !== null
      ? { lat, lon }
      : null;
  const category = (x) =>
    typeof x === "string" && /^[AB][0-7]$/.test(x) ? ({
      A1: "Light aircraft",
      A2: "Small aircraft",
      A3: "Large aircraft",
      A4: "High-vortex large aircraft",
      A5: "Heavy aircraft",
      A6: "High-performance aircraft",
      A7: "Rotorcraft",
      B1: "Glider / sailplane",
      B2: "Lighter-than-air",
      B3: "Parachutist / skydiver",
      B4: "Ultralight / hang-glider / paraglider",
      B6: "Unmanned aerial vehicle",
      B7: "Space / trans-atmospheric vehicle",
    })[x] || null : null;
  const osCategory = (x) =>
    Number.isInteger(x)
      ? category(
          {
            2: "A1",
            3: "A2",
            4: "A3",
            5: "A4",
            6: "A5",
            7: "A6",
            8: "A7",
            9: "B1",
            10: "B2",
            11: "B3",
            12: "B4",
            14: "B6",
            15: "B7",
          }[x],
        )
      : null;
  const key = (raw, source) =>
    typeof raw === "string" && /^[0-9a-f]{6}$/i.test(raw)
      ? "icao:" + raw.toLowerCase()
      : source === "adsb" &&
          typeof raw === "string" &&
          /^~[0-9a-f]{6}$/i.test(raw)
        ? "adsb:" + raw.toLowerCase()
        : null;
  const fresh = (t, now) =>
    num(t) !== null && t > 0 && t <= now + 10 && now - t <= MAX_AGE;
  function distance(a, b) {
    const h =
      Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
      Math.cos(rad(a.lat)) *
        Math.cos(rad(b.lat)) *
        Math.sin(rad(b.lon - a.lon) / 2) ** 2;
    return R * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
  }
  function bearing(a, b) {
    const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat)),
      x =
        Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) -
        Math.sin(rad(a.lat)) *
          Math.cos(rad(b.lat)) *
          Math.cos(rad(b.lon - a.lon));
    return (deg(Math.atan2(y, x)) + 360) % 360;
  }
  const compass = (x) =>
    ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][
      Math.floor(((((x % 360) + 360) % 360) + 22.5) / 45) % 8
    ];
  function record(
    id,
    callsign,
    registration,
    type,
    p,
    alt,
    speed,
    track,
    t,
    source,
    cat,
  ) {
    return {
      key: id,
      callsign: text(callsign),
      registration: text(registration),
      type: text(type),
      point: p,
      altitudeM: bound(alt, -1000, 30000),
      speedMps: bound(speed, 0, 1500),
      track: bound(track, 0, 360) === null ? null : track % 360,
      positionTime: t,
      source,
      sources: [source],
      category: cat,
      registrationSource: text(registration) ? source : null,
      typeSource: text(type) ? source : null,
      categorySource: cat ? source : null,
      identityConflict: false,
    };
  }
  function adsb(root, now) {
    if (
      !root ||
      !Array.isArray(root.ac) ||
      root.ac.length > 5000 ||
      !fresh(num(root.now) === null ? null : root.now / 1000, now)
    )
      throw new Error("ADSB.lol returned an invalid or outdated snapshot.");
    return root.ac.flatMap((a) => {
      if (!a || a.alt_baro === "ground") return [];
      const id = key(a.hex, "adsb"),
        p = point(a.lat, a.lon),
        seen = num(a.seen_pos),
        t = root.now / 1000 - seen;
      if (!id || !p || seen === null || seen < 0 || !fresh(t, now)) return [];
      return [
        record(
          id,
          a.flight,
          a.r,
          a.t,
          p,
          num(a.alt_baro) === null ? null : a.alt_baro * 0.3048,
          num(a.gs) === null ? null : a.gs * 0.514444,
          a.track,
          t,
          "adsb",
          category(a.category),
        ),
      ];
    });
  }
  function opensky(root, now) {
    if (!root || !fresh(root.time, now))
      throw new Error("OpenSky returned an outdated snapshot.");
    if (root.states === null) return [];
    if (!Array.isArray(root.states) || root.states.length > 5000)
      throw new Error("OpenSky returned an invalid snapshot.");
    return root.states.flatMap((a) => {
      if (!Array.isArray(a) || a.length < 17 || a[8] !== false) return [];
      const id = key(a[0], "opensky"),
        p = point(a[6], a[5]);
      if (!id || !p || !fresh(a[3], now)) return [];
      return [
        record(
          id,
          a[1],
          null,
          null,
          p,
          a[7],
          a[9],
          a[10],
          a[3],
          "opensky",
          osCategory(a[17]),
        ),
      ];
    });
  }
  const sources = (mode) =>
    mode === "combined" ? ["adsb", "opensky"] : [mode];
  const MODES = ["adsb", "opensky", "combined"],
    RADII = [10, 25, 50, 100],
    DEFAULTS = { mode: "adsb", radius: 50, auto: false, startWithLocation: true };
  // Saved settings never include coordinates or aircraft; unknown values fall back.
  function preferences(raw) {
    const p = { ...DEFAULTS };
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return p;
    if (MODES.includes(raw.mode)) p.mode = raw.mode;
    if (RADII.includes(raw.radius)) p.radius = raw.radius;
    if (typeof raw.auto === "boolean") p.auto = raw.auto;
    if (typeof raw.startWithLocation === "boolean")
      p.startWithLocation = raw.startWithLocation;
    return p;
  }
  // Round scale-bar length: metres per pixel in, {metres, pixels, text} out.
  function scaleBar(mPerPx, maxPx) {
    if (!(mPerPx > 0) || !(maxPx > 0)) return null;
    const steps = [1, 2, 5],
      target = mPerPx * maxPx;
    let best = 1;
    for (let e = 1; e <= 1e7; e *= 10)
      for (const s of steps) if (s * e <= target) best = s * e;
    return {
      metres: best,
      pixels: best / mPerPx,
      text: best >= 1000 ? best / 1000 + " km" : best + " m",
    };
  }
  function merge(feeds, mode, center, radius, now) {
    const groups = new Map();
    for (const source of sources(mode))
      for (const a of feeds[source]?.aircraft || []) {
        if (fresh(a.positionTime, now)) {
          if (!groups.has(a.key)) groups.set(a.key, []);
          groups.get(a.key).push(a);
        }
      }
    return [...groups.values()]
      .map((reports) => {
        reports.sort(
          (a, b) =>
            b.positionTime - a.positionTime || a.source.localeCompare(b.source),
        );
        const out = {
          ...reports[0],
          sources: [...new Set(reports.map((a) => a.source))],
        };
        out.identityConflict = false;
        for (const field of ["registration", "type", "category"]) {
          const valid = reports.filter((a) => a[field] != null);
          out[field] = valid[0]?.[field] ?? null;
          out[field + "Source"] = valid[0]?.[field + "Source"] ?? null;
          out.identityConflict ||= new Set(valid.map((a) => a[field])).size > 1;
        }
        return out;
      })
      .filter((a) => distance(center, a.point) <= radius)
      .sort(
        (a, b) =>
          distance(center, a.point) - distance(center, b.point) ||
          a.key.localeCompare(b.key),
      );
  }
  function update(feeds, result) {
    return {
      ...feeds,
      [result.source]: result.ok
        ? result
        : { ...result, aircraft: feeds[result.source]?.aircraft || [] },
    };
  }
  function boxes(c, radius) {
    if (
      !point(c.lat, c.lon) ||
      !Number.isFinite(radius) ||
      radius < 1 ||
      radius > 100
    )
      throw new Error("Invalid area");
    const dlat = deg(radius / R),
      dlon = deg(
        Math.asin(
          Math.max(
            -1,
            Math.min(1, Math.sin(radius / R) / Math.cos(rad(c.lat))),
          ),
        ),
      ),
      lo = Math.max(-90, c.lat - dlat),
      hi = Math.min(90, c.lat + dlat),
      left = c.lon - dlon,
      right = c.lon + dlon;
    return left < -180
      ? [
          [lo, left + 360, hi, 180],
          [lo, -180, hi, right],
        ]
      : right > 180
        ? [
            [lo, left, hi, 180],
            [lo, -180, hi, right - 360],
          ]
        : [[lo, left, hi, right]];
  }
  function urls(source, c, radius) {
    if (!point(c.lat, c.lon)) throw new Error("Invalid area");
    return source === "adsb"
      ? [
          `https://api.adsb.lol/v2/point/${c.lat.toFixed(6)}/${c.lon.toFixed(6)}/${Math.ceil(radius / 1.852)}`,
        ]
      : boxes(c, radius).map(
          (b) =>
            `https://opensky-network.org/api/states/all?lamin=${b[0].toFixed(6)}&lomin=${b[1].toFixed(6)}&lamax=${b[2].toFixed(6)}&lomax=${b[3].toFixed(6)}&extended=1`,
        );
  }
  const model = (code) => models[String(code || "").toUpperCase()] || null;
  const name = (code) =>
    model(code)?.name || (code ? "Aircraft type " + code : "Type unknown");
  const label = (a) =>
    a.callsign || a.registration || a.key.replace("icao:", "").toUpperCase();
  function kind(a) {
    if (a.identityConflict) return "unknown";
    const reported = {
        Rotorcraft: "rotorcraft",
        "Glider / sailplane": "glider",
        "Lighter-than-air": "balloon",
      }[a.category],
      known = model(a.type)?.kind;
    return reported && known && reported !== known
      ? "unknown"
      : reported || known || "unknown";
  }
  const projection = {
    x: (lon) => (lon + 180) / 360,
    y: (lat) => {
      const s = Math.sin(rad(Math.max(-85, Math.min(85, lat))));
      return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
    },
    point: (x, y) => ({
      lat: Math.max(
        -85,
        Math.min(
          85,
          deg(
            Math.atan(
              Math.sinh(
                Math.PI * (1 - 2 * Math.max(0.001638, Math.min(0.998362, y))),
              ),
            ),
          ),
        ),
      ),
      lon: (((x % 1) + 1) % 1) * 360 - 180,
    }),
    dx: (x, c) => {
      const d = x - c;
      return d - Math.round(d);
    },
  };
  const safe = (x) =>
    typeof x === "string"
      ? x
          .replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, "")
          .trim()
          .slice(0, 120) || null
      : null;
  function lookup(a) {
    if (!/^icao:[0-9a-f]{6}$/.test(a.key)) return null;
    const c = String(a.callsign || "").toUpperCase();
    return {
      icao: a.key.slice(5),
      airline: /^[A-Z]{3}[0-9][A-Z0-9]{0,4}$/.test(c) ? c.slice(0, 3) : null,
    };
  }
  function aircraftInfo(root, icao) {
    const a = root?.response?.aircraft;
    if (!a || typeof a.mode_s !== "string" || a.mode_s.toLowerCase() !== icao)
      throw new Error("Aircraft database identity did not match.");
    return {
      registration: safe(a.registration),
      typeCode: safe(a.icao_type),
      model: safe(a.type),
      manufacturer: safe(a.manufacturer),
      owner: safe(a.registered_owner),
      country: safe(a.registered_owner_country_name),
    };
  }
  function airlineInfo(root, code) {
    if (!Array.isArray(root?.response) || root.response.length > 20)
      throw new Error("Unexpected airline response.");
    const names = [
      ...new Set(
        root.response
          .filter((x) => x?.icao === code)
          .map((x) => safe(x.name))
          .filter(Boolean),
      ),
    ];
    return names.length === 1 ? names[0] : null;
  }
  return {
    MAX_AGE,
    STALE_AGE,
    num,
    point,
    category,
    osCategory,
    adsb,
    opensky,
    distance,
    bearing,
    compass,
    merge,
    update,
    boxes,
    urls,
    sources,
    MODES,
    RADII,
    preferences,
    scaleBar,
    model,
    name,
    label,
    kind,
    projection,
    lookup,
    aircraftInfo,
    airlineInfo,
  };
})();
if (typeof module !== "undefined") module.exports = SkyData;
