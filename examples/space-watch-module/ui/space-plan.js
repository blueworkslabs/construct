"use strict";
// Looking ahead and grouping: visible passes over the next hours, and trains of
// freshly launched constellation satellites. Pure; builds on SpaceOrbit.
const SpacePlan = (() => {
  const O =
    typeof SpaceOrbit !== "undefined" ? SpaceOrbit : require("./space-orbit.js");
  const MINUTE = 60000,
    TRAIN_MIN = 8,
    TRAIN_CLUSTER = 10,
    FAMILIES = {
      STARLINK: ["Starlink", "Starlink"],
      QIANFAN: ["Qianfan", "Qianfan"],
      GUOWANG: ["Guowang", "Guowang"],
      KUIPER: ["Kuiper", "Project Kuiper"],
      ONEWEB: ["OneWeb", "OneWeb"],
    };
  // Dark stretches (Sun below −6°) between from and to, sampled every 10 min and
  // widened by one sample so a pass at the edge of twilight is not missed.
  function darkRanges(from, to, sunAltAt, step = 10 * MINUTE) {
    const out = [];
    let start = null;
    for (let t = from; t <= to + step; t += step) {
      const dark = t <= to && sunAltAt(Math.min(t, to)) < O.DARK_SUN;
      if (dark && start === null) start = Math.max(from, t - step);
      if (!dark && start !== null) {
        out.push([start, Math.min(to, t)]);
        start = null;
      }
    }
    return out;
  }
  const visibleAt = (o, ob, t, sunAltAt) => {
    const l = O.look(o, ob, t);
    return { l, v: O.state(l, sunAltAt(t)) === "visible" };
  };
  // The visible stretch of one pass that is above 10° from a to b, sampled every 5 s.
  function examine(o, ob, a, b, sunAltAt) {
    let first = null,
      last = null,
      max = null,
      before = { ...visibleAt(o, ob, a - 5000, sunAltAt), t: a - 5000 },
      after = null;
    for (let t = a; t <= b; t += 5000) {
      const { l, v } = visibleAt(o, ob, t, sunAltAt);
      if (!l) break;
      if (v) {
        if (!first) first = { t, l };
        last = { t, l };
        if (!max || l.el > max.l.el) max = { t, l };
      } else if (!first) before = { t, l };
      else if (!after) {
        after = { t, l };
        break;
      }
    }
    if (!first) return null;
    const why = (x, edge) =>
      !x || !x.l ? edge : x.l.el < O.VISIBLE_EL ? edge : !x.l.sunlit ? "shadow" : "daylight";
    return {
      startMs: first.t,
      endMs: last.t,
      startAz: first.l.az,
      startEl: first.l.el,
      endAz: last.l.az,
      endEl: last.l.el,
      maxMs: max.t,
      maxAz: max.l.az,
      maxEl: max.l.el,
      startReason: before && before.v ? "ongoing" : why(before, "rises"),
      endReason: after ? why(after, "sets") : "window",
    };
  }
  // Visible passes of one object within the given dark ranges: coarse 60 s scan
  // for rises above 10°, refined to 5 s, then the visible stretch of each pass.
  function passes(o, ob, ranges, sunAltAt, step = 60000) {
    const out = [];
    for (const [from, to] of ranges) {
      let t = from,
        l = O.look(o, ob, t);
      if (!l) return out;
      let start = l.el >= O.VISIBLE_EL ? from : null;
      while (t < to) {
        const n = Math.min(to, t + step),
          q = O.look(o, ob, n);
        if (!q) return out;
        const up = q.el >= O.VISIBLE_EL;
        if (start === null && up) {
          start = n;
          for (let b = n - 5000; b > t; b -= 5000) {
            const r = O.look(o, ob, b);
            if (!r || r.el < O.VISIBLE_EL) break;
            start = b;
          }
        } else if (start !== null && !up) {
          const p = examine(o, ob, start, n, sunAltAt);
          if (p) out.push(p);
          start = null;
        }
        t = n;
      }
      if (start !== null) {
        const p = examine(o, ob, start, to, sunAltAt);
        if (p) out.push(p);
      }
    }
    return out;
  }
  // Launch families that fly as a line of lights for a few days after launch.
  function family(name) {
    const word = String(name || "").split(/[-\s]/)[0].toUpperCase();
    return FAMILIES[word] ? { key: word, name: FAMILIES[word][0], wiki: FAMILIES[word][1] } : null;
  }
  const centralAngle = (a, b) => {
    const d = (a.x * b.x + a.y * b.y + a.z * b.z) / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z));
    return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
  };
  // Trains: at least eight satellites of one family from one launch still
  // bunched within 10° (seen from Earth's centre) of one of them. Batches spread
  // around their orbit within weeks; stragglers and stale elements drop out.
  function trains(objects, launches, ms) {
    const groups = new Map();
    for (const o of objects) {
      const f = family(o.name);
      if (!f || !o.intdes) continue;
      const key = o.intdes.slice(0, 8);
      if (!groups.has(key)) groups.set(key, { key, f, members: [] });
      const g = groups.get(key);
      if (g.f.key === f.key) g.members.push(o);
    }
    const out = [];
    for (const g of groups.values()) {
      if (g.members.length < TRAIN_MIN) continue;
      const ps = g.members.filter((o) => Math.abs(ms - o.epoch) <= 3 * 86400000)
        .map((o) => ({ o, p: O.position(o, ms) })).filter((x) => x.p);
      let best = null;
      for (const a of ps) {
        const near = ps.filter((b) => centralAngle(a.p, b.p) <= TRAIN_CLUSTER);
        if (!best || near.length > best.near.length) best = { seed: a, near };
      }
      if (!best || best.near.length < TRAIN_MIN) continue;
      let spread = 0;
      for (const a of best.near)
        for (const b of best.near) spread = Math.max(spread, centralAngle(a.p, b.p));
      out.push({
        id: "train:" + g.key,
        intdes: g.key,
        family: g.f.name,
        wiki: g.f.wiki,
        launch: launches.get(g.key) || null,
        members: best.near.map((x) => x.o),
        centre: best.seed.o,
        batch: g.members.length,
        spread,
      });
    }
    out.sort((a, b) => (b.launch || "").localeCompare(a.launch || "") || a.intdes.localeCompare(b.intdes));
    return out;
  }
  // From the last-30-days list keep only rows that could form a train: a known
  // family with at least eight members from one launch (compact element rows).
  function trainRows(rows) {
    const count = new Map();
    for (const r of rows) {
      const f = family(r[1]);
      if (f && r[2]) count.set(r[2].slice(0, 8) + f.key, (count.get(r[2].slice(0, 8) + f.key) || 0) + 1);
    }
    return rows.filter((r) => {
      const f = family(r[1]);
      return f && r[2] && count.get(r[2].slice(0, 8) + f.key) >= TRAIN_MIN;
    });
  }
  // Launch dates by designator from SATCAT rows (compact form).
  function launchDates(rows) {
    const out = new Map();
    for (const r of rows) if (r && r[9] && r[3] && !out.has(r[9].slice(0, 8))) out.set(r[9].slice(0, 8), r[3]);
    return out;
  }
  const previewTime = (p, now) => Math.max(now, Math.min(p.startMs + 20000, (p.startMs + p.endMs) / 2));
  return { darkRanges, passes, examine, family, trains, trainRows, launchDates, previewTime, TRAIN_MIN, TRAIN_CLUSTER };
})();
if (typeof module !== "undefined") module.exports = SpacePlan;
