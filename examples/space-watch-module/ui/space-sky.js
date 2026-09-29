"use strict";
// Sky context for Space Watch: Sun, Moon, planets and bright stars for one
// observer, plus the plain-language pointing words ("EAST · 1½ fists up").
const SpaceSky = (() => {
  const A =
    typeof Astronomy !== "undefined"
      ? Astronomy
      : require("./vendor/astronomy.min.js");
  const Stars =
    typeof SpaceStars !== "undefined" ? SpaceStars : require("./space-stars.js");
  const rad = (x) => (x * Math.PI) / 180,
    deg = (x) => (x * 180) / Math.PI,
    wrap180 = (x) => ((((x + 180) % 360) + 360) % 360) - 180;
  const DIR8 = [
    "north",
    "north-east",
    "east",
    "south-east",
    "south",
    "south-west",
    "west",
    "north-west",
  ];
  const DIR16 = [
    "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
    "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
  ];
  const PLANETS = [
    ["Venus", "Venus"],
    ["Mars", "Mars"],
    ["Jupiter", "Jupiter"],
    ["Saturn", "Saturn"],
  ];
  const observer = (lat, lon, heightM = 0) => new A.Observer(lat, lon, heightM);
  function horizon(date, ob, body) {
    const e = A.Equator(body, date, ob, true, true),
      h = A.Horizon(date, ob, e.ra, e.dec, "normal");
    return { az: h.azimuth, el: h.altitude };
  }
  const sun = (ms, ob) => horizon(new Date(ms), ob, A.Body.Sun);
  function bodies(ms, ob) {
    const d = new Date(ms),
      moon = horizon(d, ob, A.Body.Moon),
      lit = A.Illumination(A.Body.Moon, d);
    const out = [
      {
        key: "moon",
        label: "Moon",
        name: "the Moon",
        az: moon.az,
        el: moon.el,
        mag: lit.mag,
        phase: lit.phase_fraction,
      },
    ];
    for (const [key, label] of PLANETS) {
      const h = horizon(d, ob, A.Body[key]);
      out.push({
        key: key.toLowerCase(),
        label,
        name: label,
        az: h.az,
        el: h.el,
        mag: A.Illumination(A.Body[key], d).mag,
        planet: true,
      });
    }
    return out;
  }
  // J2000 catalogue positions precessed to the date, then to the horizon.
  function stars(ms, ob) {
    const d = new Date(ms),
      time = A.MakeTime(d),
      rot = A.Rotation_EQJ_EQD(time);
    return Stars.stars.map(([ra, dec, mag, name], i) => {
      const v = A.RotateVector(
          rot,
          A.VectorFromSphere(new A.Spherical(dec, ra, 1), time),
        ),
        eq = A.EquatorFromVector(v),
        h = A.Horizon(d, ob, eq.ra, eq.dec, "normal");
      return { i, az: h.azimuth, el: h.altitude, mag, name: name || null };
    });
  }
  const dir8 = (az) => DIR8[Math.round((((az % 360) + 360) % 360) / 45) % 8];
  const dir16 = (az) => DIR16[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];
  // A fist at arm's length covers about 10°. Halves are as fine as a hand gets.
  function fists(angle) {
    const n = Math.max(0.5, Math.round(angle / 5) / 2),
      whole = Math.floor(n),
      half = n - whole >= 0.5 ? "½" : "";
    const count = whole ? String(whole) + half : "½";
    return count + (n > 1 ? " fists" : " fist");
  }
  function height(el) {
    if (el >= 84) return "straight overhead";
    if (el >= 75) return "almost straight up";
    if (el < 5) return "just above the horizon";
    return fists(el) + " up";
  }
  function headline(l) {
    if (l.el >= 75) return `${height(l.el).toUpperCase()} · a little ${dir8(l.az)}`;
    return `${dir8(l.az).toUpperCase()} · ${height(l.el)}`;
  }
  function separation(a, b) {
    const c =
      Math.sin(rad(a.el)) * Math.sin(rad(b.el)) +
      Math.cos(rad(a.el)) * Math.cos(rad(b.el)) * Math.cos(rad(a.az - b.az));
    return deg(Math.acos(Math.max(-1, Math.min(1, c))));
  }
  // Where the target sits relative to an anchor, as seen facing the anchor:
  // larger azimuth is to the right, larger elevation is up.
  function relation(t, a) {
    const dx = wrap180(t.az - a.az) * Math.cos(rad((t.el + a.el) / 2)),
      dy = t.el - a.el;
    if (Math.abs(dy) >= 2 * Math.abs(dx)) return dy > 0 ? "above" : "below";
    if (Math.abs(dx) >= 2 * Math.abs(dy))
      return dx > 0 ? "to the right of" : "to the left of";
    return `${dy > 0 ? "up" : "down"} and to the ${dx > 0 ? "right" : "left"} of`;
  }
  // Candidates: the Moon, bright planets and the brightest named stars that
  // are clearly above the horizon. Brighter anchors win over slightly nearer ones.
  function anchors(bodyList, starList, sunAlt) {
    const out = [];
    for (const b of bodyList)
      if (b.key === "moon" ? b.el > 3 : b.el > 5 && b.mag < 1.8) out.push(b);
    if (sunAlt < -8)
      for (const s of starList)
        if (s.el > 8 && s.name && (s.mag <= 1.5 || s.name === "Polaris"))
          out.push({ key: "star-" + s.i, name: s.name, label: s.name, az: s.az, el: s.el, mag: s.mag });
    return out;
  }
  function anchor(t, list, maxSep = 30) {
    let best = null;
    for (const a of list) {
      const sep = separation(t, a);
      if (sep > maxSep) continue;
      const score = sep - Math.min(8, Math.max(0, 2 - a.mag) * 2);
      if (!best || score < best.score) best = { a, sep, score };
    }
    if (!best) return null;
    const { a, sep } = best,
      text =
        sep < 2.5
          ? `Right next to ${a.name}.`
          : `${fists(sep).replace(/^./, (c) => c.toUpperCase())} ${relation(t, a)} ${a.name}.`;
    const moon = list.find((x) => x.key === "moon");
    const also =
      moon && moon !== a && separation(t, moon) <= 35
        ? `Also ${relation(t, moon)} the Moon.`
        : "";
    return { key: a.key, sep, text: also ? `${text} ${also}` : text };
  }
  // Direction of travel from where it will be a few minutes on (later), and
  // whether it is climbing, from one minute on (soon).
  function motion(now, soon, later) {
    if (!now || !soon) return "";
    const d = soon.el - now.el,
      climb = d > 0.3 ? "climbing" : d < -0.3 ? "sinking" : "staying at this height";
    if (!later || Math.abs(wrap180(later.az - now.az)) < 12)
      return d > 0.3 ? "Climbing higher." : d < -0.3 ? "Sinking toward the horizon." : "Barely moving from here.";
    return `Heading toward the ${dir8(later.az)}, ${climb}.`;
  }
  const STATE = {
    visible: "Sunlit · should be visible",
    low: "Sunlit but low · buildings or trees may hide it",
    shadow: "In Earth’s shadow · not visible now",
    daylight: "Sky too bright to see it now",
    below: "Below your horizon",
    faint: "Far too faint to see without a telescope",
  };
  // The geostationary belt as seen from here: where a satellite parked above
  // each longitude on the equator appears (spherical Earth; a fraction of a
  // degree is plenty for a guide line). Points below the horizon are dropped.
  function geoBelt(lat, lon) {
    const R = 6378.137, G = 42164.0, f = rad(lat), out = [];
    for (let d = -90; d <= 90; d += 2) {
      const dl = rad(d),
        // Satellite relative to the observer in local east/north/up.
        x = G * Math.sin(dl),
        yz = G * Math.cos(dl),
        e = x,
        n = -yz * Math.sin(f),
        u = yz * Math.cos(f) - R,
        el = deg(Math.atan2(u, Math.hypot(e, n)));
      if (el >= -1) out.push({ az: ((deg(Math.atan2(e, n)) % 360) + 360) % 360, el, lon: ((lon + d + 540) % 360) - 180 });
    }
    return out;
  }
  function clock(s) {
    s = Math.max(0, Math.round(s));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  function ending(end) {
    if (!end) return "";
    if (end.reason === "daylight") return `The sky becomes too bright in ${clock(end.inS)}.`;
    if (end.reason === "long") return "Visible for 20+ min.";
    return end.reason === "shadow"
      ? `Fades into Earth’s shadow in ${clock(end.inS)}, ${height(end.el)} in the ${dir8(end.az)}.`
      : `Gets too low to spot in ${clock(end.inS)}, in the ${dir8(end.az)}.`;
  }
  function ago(offsetS) {
    const s = Math.round(-offsetS);
    if (s <= 0) return "Now";
    const m = Math.floor(s / 60),
      r = s % 60;
    return `${m ? m + " min" : ""}${m && r ? " " : ""}${r ? r + " s" : ""} ago`;
  }
  return {
    DIR8,
    observer,
    sun,
    bodies,
    stars,
    asterisms: Stars.asterisms,
    dir8,
    dir16,
    fists,
    height,
    headline,
    separation,
    relation,
    anchors,
    anchor,
    motion,
    STATE,
    geoBelt,
    clock,
    ending,
    ago,
  };
})();
if (typeof module !== "undefined") module.exports = SpaceSky;
