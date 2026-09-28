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
    const out = [], points = [];
    for (let t = from; t < to; t += step) points.push({t, el: sunAltAt(t)});
    points.push({t: to, el: sunAltAt(to)});
    let start = null;
    for (const p of points) {
      const dark = p.el < O.DARK_SUN;
      if (dark && start === null) start = Math.max(from, p.t - step);
      if (!dark && start !== null) { out.push([start, p.t]); start = null; }
    }
    if (start !== null) out.push([start, to]);
    // Near polar twilight a whole dark interval can fit between bright samples.
    // Refine local solar minima and clipped first/last intervals to ~1 second.
    const brackets = [[from, Math.min(to, from + step)], [Math.max(from, to - step), to]];
    for (let i = 1; i + 1 < points.length; i++) {
      const p = points[i];
      if (p.el >= O.DARK_SUN && p.el <= points[i-1].el && p.el <= points[i+1].el)
        brackets.push([points[i-1].t, points[i+1].t]);
    }
    const g = (Math.sqrt(5)-1)/2;
    for (const [left,right] of brackets) {
      if (right <= left || out.some(([a,b])=>a<=left && b>=right)) continue;
      let a=left,b=right,c=b-g*(b-a),d=a+g*(b-a),fc=sunAltAt(c),fd=sunAltAt(d);
      while (b-a>1000) {
        if (fc<fd) { b=d;d=c;fd=fc;c=b-g*(b-a);fc=sunAltAt(c); }
        else { a=c;c=d;fc=fd;d=a+g*(b-a);fd=sunAltAt(d); }
      }
      if (sunAltAt((a+b)/2)<O.DARK_SUN) out.push([left,right]);
    }
    const merged=[];
    for (const r of out.sort((a,b)=>a[0]-b[0])) {
      const last=merged[merged.length-1];
      if (last && r[0]<=last[1]) last[1]=Math.max(last[1],r[1]);
      else merged.push(r);
    }
    return merged;
  }
  const visibleAt = (o, ob, t, sunAltAt) => {
    const l = O.look(o, ob, t);
    return { l, v: O.state(l, sunAltAt(t)) === "visible" };
  };
  // The visible stretch of one pass that is above 10° from a to b, sampled every
  // 5 s (1 s for grazing passes that are only seconds long).
  function examine(o, ob, a, b, sunAltAt, dt = 5000) {
    let first = null,
      last = null,
      max = null,
      before = { ...visibleAt(o, ob, a - dt, sunAltAt), t: a - dt },
      after = null;
    for (let t = a; t <= b; t += dt) {
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
  // Peak elevation between a and b (one hump), by golden-section search to ~1 s.
  function peak(o, ob, a, b) {
    const g = (Math.sqrt(5) - 1) / 2,
      el = (t) => {
        const l = O.look(o, ob, t);
        return l ? l.el : -90;
      };
    let c = b - g * (b - a),
      d = a + g * (b - a),
      fc = el(c),
      fd = el(d);
    while (b - a > 1000) {
      if (fc > fd) {
        b = d;
        d = c;
        fd = fc;
        c = b - g * (b - a);
        fc = el(c);
      } else {
        a = c;
        c = d;
        fc = fd;
        d = a + g * (b - a);
        fd = el(d);
      }
    }
    const t = Math.round((a + b) / 2);
    return { t, el: el(t) };
  }
  // A coarse sample this far below 10° at a local maximum may hide a grazing
  // pass between samples. Within 60 s of its peak a low pass drops about 1°.
  const GRAZE_MARGIN = 4;
  // Visible passes of one object within the given dark ranges: a coarse scan
  // (60 s) for rises above 10°, refined to 5 s, then the visible stretch of each
  // pass. Short passes that peak between two coarse samples are caught by
  // refining every coarse local maximum within GRAZE_MARGIN of 10°.
  function passes(o, ob, ranges, sunAltAt, step = 60000) {
    const out = [];
    const add = (p) => {
      // An edge bracket and the next local-maximum bracket can cover one peak.
      if (p && !out.some((q) => p.startMs <= q.endMs + 5000 && p.endMs >= q.startMs - 5000)) out.push(p);
    };
    for (const [from, to] of ranges) {
      let t = from,
        l = O.look(o, ob, t);
      if (!l) return out;
      let start = l.el >= O.VISIBLE_EL ? from : null,
        back = null,
        prev = { t, el: l.el };
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
          add(p);
          start = null;
        } else if (
          start === null &&
          ((back && prev.el >= O.VISIBLE_EL - GRAZE_MARGIN && prev.el >= back.el && prev.el >= q.el) ||
            ((t === from || n === to) && Math.max(prev.el, q.el) >= O.VISIBLE_EL - GRAZE_MARGIN))
        ) {
          // At a range boundary there may be no sample on the other side of
          // the peak. Refine that bounded interval too, never outside the range.
          const left = back && prev.el >= back.el && prev.el >= q.el ? back.t : t;
          const top = peak(o, ob, left, n);
          if (top.el >= O.VISIBLE_EL) {
            let a = top.t;
            while (a - 1000 > left) {
              const r = O.look(o, ob, a - 1000);
              if (!r || r.el < O.VISIBLE_EL) break;
              a -= 1000;
            }
            const p = examine(o, ob, a, n, sunAltAt, 1000);
            add(p);
          }
        }
        back = prev;
        prev = { t: n, el: q.el };
        t = n;
      }
      if (start !== null) {
        const p = examine(o, ob, start, to, sunAltAt);
        add(p);
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
  return { darkRanges, passes, examine, peak, GRAZE_MARGIN, family, trains, trainRows, launchDates, previewTime, TRAIN_MIN, TRAIN_CLUSTER };
})();
if (typeof module !== "undefined") module.exports = SpacePlan;
