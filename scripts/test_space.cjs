"use strict";
// Space Watch data/maths modules, package shape and privacy boundary.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const root = "examples/space-watch-module/";
const O = require("../" + root + "ui/space-orbit.js");
const K = require("../" + root + "ui/space-sky.js");
const C = require("../" + root + "ui/space-catalog.js");
const Stars = require("../" + root + "ui/space-stars.js");
const P = require("../" + root + "ui/space-plan.js");
const M = require("../" + root + "ui/space-magnetic.js");
const SP = require("../" + root + "ui/space-pointer.js");
const hostSample = require("./space-fixture/orientation-sample.cjs");
let count = 0;
function test(name, body) {
  body();
  count++;
  console.log("PASS " + name);
}
const elements = JSON.parse(fs.readFileSync("scripts/space-fixture/elements.json", "utf8")),
  satcat = JSON.parse(fs.readFileSync("scripts/space-fixture/satcat.json", "utf8"));
const objects = O.build(O.parseElements(JSON.stringify(elements))),
  ob = O.observer(52.52, 13.405, 0.04),
  aob = K.observer(52.52, 13.405, 40),
  sunAt = (ms) => K.sun(ms, aob).el,
  byId = (id) => objects.find((o) => o.id === id),
  at = (iso) => Date.parse(iso),
  near = (ms, iso, s) => assert.ok(Math.abs(ms - at(iso)) <= s * 1000, `${new Date(ms).toISOString()} vs ${iso}`);

test("orbit records are bounded, deduplicated and re-checked from the cache", () => {
  assert.equal(objects.length, elements.length);
  assert.deepEqual(O.parseElements("<html>GP data has not updated</html>"), []);
  assert.deepEqual(O.parseElements('{"not":"a list"}'), []);
  const good = elements[0];
  const bad = [
    { ...good, NORAD_CAT_ID: "25544" },
    { ...good, NORAD_CAT_ID: 1.5 },
    { ...good, EPOCH: "yesterday" },
    { ...good, MEAN_MOTION: 99 },
    { ...good, ECCENTRICITY: 1.2 },
    { ...good, OBJECT_NAME: "" },
    { ...good, BSTAR: "0.1" },
    null,
    7,
  ];
  assert.deepEqual(O.rows(bad), []);
  assert.equal(O.rows([good, good]).length, 1, "duplicates collapse");
  const many = Array.from({ length: 450 }, (_, i) => ({ ...good, NORAD_CAT_ID: i + 1 }));
  assert.equal(O.rows(many).length, O.MAX_OBJECTS);
  const row = O.compact({ ...good, OBJECT_NAME: "ISS\u0000 (ZARYA)\u202e" });
  assert.equal(row[1], "ISS (ZARYA)", "control and bidi characters are dropped");
  const rows = O.parseElements(JSON.stringify(elements));
  assert.deepEqual(rows.map(O.validRow), rows);
  assert.equal(O.validRow([1, 2, 3]), null);
  assert.equal(O.validRow("x"), null);
});
test("cache chunks fit one storage request each and reassemble exactly", () => {
  const rows = O.parseElements(JSON.stringify(elements));
  const big = Array.from({ length: 160 }, (_, i) => [i + 1, ...rows[0].slice(1)]);
  for (const list of [rows, big]) {
    const parts = O.chunks(list);
    for (const p of parts) assert.ok(JSON.stringify(p).length <= 6500);
    assert.deepEqual(parts.flat(), list);
  }
  assert.deepEqual(O.chunks([]), []);
});
test("ISS pass over Berlin on 28 Sep 2026 matches Heavens-Above", () => {
  // Heavens-Above, Berlin 52.52 N 13.405 E, elements of 27 Sep: visible pass
  // 17:49:57 (10°, WSW) → 17:51:33 (13°, SW) → 17:53:10 (10°, SSW) UTC.
  const iss = byId(25544);
  const p = O.nextPass(iss, ob, at("2026-09-28T17:30:00Z"), sunAt);
  near(p.riseMs, "2026-09-28T17:49:57Z", 15);
  near(p.maxMs, "2026-09-28T17:51:33Z", 20);
  assert.ok(Math.abs(p.maxEl - 13) < 1, String(p.maxEl));
  assert.equal(K.dir16(p.maxAz), "SW");
  assert.equal(p.visible, true);
  const end = O.passEnd(iss, ob, at("2026-09-28T17:51:00Z"), sunAt);
  assert.equal(end.reason, "sets");
  near(end.atMs, "2026-09-28T17:53:10Z", 15);
  assert.equal(K.dir16(end.az), "SSW");
  const l = O.look(iss, ob, at("2026-09-28T17:51:33Z"));
  assert.ok(l.altKm > 400 && l.altKm < 430 && l.speedKms > 7.6 && l.speedKms < 7.7);
});
test("pass countdown ends when morning twilight starts", () => {
  const t = at('2026-09-28T17:50:40Z');
  const end = O.passEnd(byId(25544), ob, t, ms => ms < t + 30000 ? -20 : -6);
  assert.equal(end.reason, 'daylight');
  assert.equal(end.inS, 29);
  assert.match(K.ending(end), /sky.*bright/i);
});
test("visibility needs sunlight on the object, a dark sky and height", () => {
  const iss = byId(25544);
  const twilight = at("2026-09-28T17:51:00Z");
  assert.equal(O.state(O.look(iss, ob, twilight), sunAt(twilight)), "visible");
  assert.equal(O.state({ el: 30, sunlit: true }, 5), "daylight");
  assert.equal(O.state({ el: 30, sunlit: false }, -20), "shadow");
  assert.equal(O.state({ el: 5, sunlit: true }, -20), "low");
  assert.equal(O.state({ el: -1, sunlit: true }, -20), "below");
  assert.equal(O.state(null, -20), "below");
  // Ajisai is up at the same moment but still in Earth's shadow.
  const t = at("2026-09-28T17:50:52Z");
  assert.equal(O.state(O.look(byId(16908), ob, t), sunAt(t)), "shadow");
  assert.equal(O.observer(91, 0), null);
  assert.equal(O.observer(0, "13"), null);
});
test("pointing words use compass directions, fists and halves", () => {
  assert.deepEqual([4, 10, 15, 22, 44].map(K.fists), ["½ fist", "1 fist", "1½ fists", "2 fists", "4½ fists"]);
  assert.equal(K.height(3), "just above the horizon");
  assert.equal(K.height(78), "almost straight up");
  assert.equal(K.height(88), "straight overhead");
  assert.equal(K.headline({ az: 94, el: 15.7 }), "EAST · 1½ fists up");
  assert.equal(K.headline({ az: 200, el: 80 }), "ALMOST STRAIGHT UP · a little south");
  assert.equal(K.dir8(359), "north");
  assert.equal(K.dir16(234), "SW");
  // Facing an anchor, larger azimuth is to the right.
  assert.equal(K.relation({ az: 100, el: 20 }, { az: 90, el: 20 }), "to the right of");
  assert.equal(K.relation({ az: 80, el: 20 }, { az: 90, el: 20 }), "to the left of");
  assert.equal(K.relation({ az: 90, el: 30 }, { az: 90, el: 20 }), "above");
  assert.equal(K.relation({ az: 96, el: 26 }, { az: 90, el: 20 }), "up and to the right of");
  assert.equal(K.relation({ az: 2, el: 20 }, { az: 358, el: 20 }), "to the right of", "wraps across north");
  assert.equal(K.ago(0), "Now");
  assert.equal(K.ago(-150), "2 min 30 s ago");
  assert.equal(K.ago(-40), "40 s ago");
  assert.equal(K.clock(95), "1:35");
  assert.match(K.ending({ reason: "shadow", inS: 100, el: 40, az: 90 }), /^Fades into Earth’s shadow in 1:40, 4 fists up in the east\.$/);
  assert.match(K.ending({ reason: "sets", inS: 130, el: 9, az: 180 }), /too low to spot in 2:10, in the south/);
  assert.equal(K.motion({ az: 90, el: 10 }, { az: 90, el: 12 }, { az: 92, el: 20 }), "Climbing higher.");
  assert.equal(K.motion({ az: 90, el: 10 }, { az: 80, el: 12 }, { az: 30, el: 20 }), "Heading toward the north-east, climbing.");
});
test("anchors point from the Moon, planets and bright stars", () => {
  const t = at("2026-09-28T17:50:52Z"),
    s = sunAt(t),
    list = K.anchors(K.bodies(t, aob), K.stars(t, aob), s),
    stage = O.look(byId(29507), ob, t);
  assert.ok(list.some((a) => a.key === "moon") && list.some((a) => a.key === "saturn"));
  assert.equal(K.anchor(stage, list).text, "1 fist above Saturn. Also to the right of the Moon.");
  assert.equal(K.anchor({ az: 180, el: -30 }, list), null, "nothing within 30°");
  // In daylight no stars are offered.
  assert.ok(K.anchors(K.bodies(t, aob), K.stars(t, aob), 10).every((a) => !a.key.startsWith("star-")));
  assert.equal(K.anchor({ az: 94.1, el: 6.3 }, [{ key: "saturn", name: "Saturn", az: 94, el: 6, mag: 0.6 }]).text, "Right next to Saturn.");
});
test("bundled star table covers the bright sky and the drawn asterisms", () => {
  assert.ok(Stars.stars.length >= 280 && Stars.stars.length <= 320);
  for (const [ra, dec, mag, name] of Stars.stars) {
    assert.ok(ra >= 0 && ra < 360 && dec >= -90 && dec <= 90 && mag <= 3.5);
    assert.ok(name === null || typeof name === "string");
  }
  const names = new Set(Stars.stars.map((s) => s[3]));
  for (const n of ["Sirius", "Vega", "Polaris", "Dubhe", "Betelgeuse", "Deneb"]) assert.ok(names.has(n), n);
  assert.deepEqual(Stars.asterisms.map((a) => a[0]), ["Big Dipper", "Cassiopeia", "Orion", "Northern Cross"]);
  for (const [, paths] of Stars.asterisms)
    for (const p of paths) for (const i of p) assert.ok(Number.isInteger(i) && Stars.stars[i]);
  const t = at("2026-09-28T17:50:52Z"),
    vega = K.stars(t, aob).find((s) => s.name === "Vega");
  assert.ok(Math.abs(vega.el - 75) < 1 && Math.abs(vega.az - 208) < 2, JSON.stringify(vega));
});
test("catalog rows are bounded and name objects in plain language", () => {
  const rows = C.parseSatcat(JSON.stringify(satcat)),
    idx = C.index(rows);
  assert.equal(rows.length, satcat.length);
  assert.deepEqual(rows.map(C.validRow), rows);
  assert.deepEqual(C.parseSatcat("nope"), []);
  const odd = C.compact({ NORAD_CAT_ID: 5, OBJECT_TYPE: "EVIL", OWNER: "<b>", LAUNCH_DATE: "soon", RCS: -3, OBJECT_NAME: 7 });
  assert.deepEqual(odd, [5, "UNK", null, null, null, null, null, null, null, null, null]);
  const d = (id) => C.describe(byId(id), idx.get(id));
  assert.deepEqual(d(25544), { title: "ISS (Zarya)", kind: "International Space Station · crewed", wiki: "International Space Station", major: true });
  assert.equal(d(29507).title, "Long March 4B rocket stage");
  assert.equal(d(29507).kind, "Spent upper stage · China");
  assert.equal(d(29507).wiki, "Long March 4B");
  const zenit = objects.find((o) => o.name.startsWith("SL-16"));
  assert.equal(d(zenit.id).title, "Zenit rocket stage");
  const kosmos = objects.find((o) => /^COSMOS \d+$/.test(o.name));
  assert.equal(d(kosmos.id).wiki, "Kosmos " + kosmos.name.slice(7));
  assert.equal(d(kosmos.id).search, kosmos.name);
  assert.equal(C.describe({ id: 1, name: "MYSTERY R/B" }, undefined).kind, "Spent upper stage");
  assert.equal(C.rcsWords(399), "Very large");
  assert.equal(C.rcsWords(null), "Unknown");
  assert.equal(C.period(92.98), "93 min");
  assert.equal(C.period(718), "11 h 58 min");
  assert.equal(C.years("2006-10-23", at("2026-09-28T00:00:00Z")), "19 years");
});
test("same-launch lookups and Wikipedia stay on fixed, encoded URLs", () => {
  assert.equal(C.launchUrl("2006-046C"), "https://celestrak.org/satcat/records.php?INTDES=2006-046&FORMAT=json");
  assert.equal(C.launchUrl("2006-046C&GROUP=active"), null);
  assert.equal(C.launchUrl(null), null);
  const launch = C.parseLaunch(
    JSON.stringify([
      { NORAD_CAT_ID: 29505, OBJECT_TYPE: "PAY", OBJECT_NAME: "SHIJIAN-6 02A (SJ-6 02A)", OBJECT_ID: "2006-046A" },
      { NORAD_CAT_ID: 29507, OBJECT_TYPE: "R/B", OBJECT_NAME: "CZ-4B R/B", OBJECT_ID: "2006-046C" },
      { NORAD_CAT_ID: 29508, OBJECT_TYPE: "DEB", OBJECT_NAME: "CZ-4B DEB", OBJECT_ID: "2006-046D", DECAY_DATE: "2017-04-20" },
    ]),
    29507,
  );
  assert.deepEqual([launch.total, launch.payloads.map((x) => x.name), launch.debris, launch.reentered, launch.stages], [2, ["SHIJIAN-6 02A (SJ-6 02A)"], 1, 1, 0]);
  const title = C.wikiUrl({ wiki: "Long March 4B & friends" });
  assert.ok(title.startsWith("https://en.wikipedia.org/w/api.php?action=query&"));
  assert.match(title, /&titles=Long%20March%204B%20%26%20friends$/);
  assert.match(title, /redirects=1/, "Construct never follows HTTP redirects");
  assert.match(C.wikiUrl({ wiki: "Kosmos 1", search: "COSMOS 1" }, true), /generator=search&gsrlimit=1&gsrsearch=COSMOS%201%20satellite$/);
  assert.equal(C.wikiUrl({ title: "x" }), null);
  const long = "Word ".repeat(400);
  const w = C.parseWiki(JSON.stringify({ query: { pages: [{ title: "T", extract: long, fullurl: "https://evil.example/" }] } }));
  assert.ok(w.extract.length <= 901 && w.extract.endsWith("…"));
  assert.equal(w.url, null);
  assert.equal(C.parseWiki(JSON.stringify({ query: { pages: [{ title: "T", missing: true }] } })), null);
  assert.equal(C.parseWiki("<html>"), null);
});
test("visible passes over the next hours reproduce the Heavens-Above ISS pass", () => {
  const from = at("2026-09-28T15:00:00Z"),
    ranges = P.darkRanges(from, from + 12 * 3600000, sunAt);
  assert.equal(ranges.length, 1);
  near(ranges[0][0], "2026-09-28T17:20:00Z", 600);
  const [iss] = P.passes(byId(25544), ob, ranges, sunAt);
  near(iss.startMs, "2026-09-28T17:49:57Z", 10);
  near(iss.endMs, "2026-09-28T17:53:10Z", 10);
  assert.ok(Math.abs(iss.maxEl - 13) < 1);
  assert.deepEqual([K.dir16(iss.startAz), K.dir16(iss.maxAz), K.dir16(iss.endAz)], ["WSW", "SW", "SSW"]);
  assert.deepEqual([iss.startReason, iss.endReason], ["rises", "sets"]);
  // Daylight has no dark range, so nothing is scanned.
  assert.deepEqual(P.darkRanges(at("2026-09-28T09:00:00Z"), at("2026-09-28T13:00:00Z"), sunAt), []);
  // A pass that ends in Earth's shadow says so.
  const all = objects.flatMap((o) => P.passes(o, ob, ranges, sunAt));
  assert.ok(all.some((p) => p.endReason === "shadow"));
  for (const p of all) assert.ok(p.startMs <= p.maxMs && p.maxMs <= p.endMs && p.maxEl >= 10);
});
test("brief high-latitude twilight between solar samples is retained", () => {
  const ob=K.observer(60.03,0,0), sun=t=>K.sun(t,ob).el;
  const from=at("2026-06-25T23:57:00Z"), to=at("2026-06-26T00:17:00Z");
  assert.ok(sun(from)>-6 && sun(from+600000)>-6);
  const ranges=P.darkRanges(from,to,sun), middle=at("2026-06-26T00:02:00Z");
  assert.ok(sun(middle)<-6);
  assert.ok(ranges.some(([a,b])=>a<=middle&&b>=middle),"short real twilight must not be reported as continuous daylight");
  for(const [a,b] of [[from,from+600000],[from-600000,from+600000]]) {
    assert.ok(P.darkRanges(a,b,sun).some(([x,y])=>x<=middle&&y>=middle),"range-edge twilight retained");
  }
});
test("grazing passes between coarse samples are refined, at almost no extra cost", () => {
  // Codex/Astra reproduction on #49: SL-14 R/B (16792) from 49.5 N 13.4 E peaks at
  // 10.01° for about 15 s at 00:42:2x UTC; a plain 60 s scan skipped it.
  const ob2 = O.observer(49.5, 13.4, 0),
    ab2 = K.observer(49.5, 13.4, 0),
    sun2 = (ms) => K.sun(ms, ab2).el,
    from = at("2026-09-28T17:50:40Z"),
    ranges = P.darkRanges(from, from + 12 * 3600000, sun2);
  const graze = P.passes(byId(16792), ob2, ranges, sun2).find((p) => p.maxEl < 10.1);
  assert.ok(graze, "grazing pass found");
  near(graze.startMs, "2026-09-29T00:42:20Z", 3);
  near(graze.endMs, "2026-09-29T00:42:35Z", 3);
  assert.ok(graze.maxEl >= 10);
  // A local maximum can sit inside the first/last coarse interval, with no
  // neighbouring sample available to establish a three-point maximum.
  for (const [a,b] of [["2026-09-29T00:42:00Z", "2026-09-29T00:45:00Z"],
    ["2026-09-29T00:39:00Z", "2026-09-29T00:42:50Z"]]) {
    const edge = P.passes(byId(16792), ob2, [[at(a),at(b)]], sun2);
    assert.equal(edge.length, 1, "one grazing pass at range edge, without duplicates");
    near(edge[0].startMs, "2026-09-29T00:42:20Z", 3);
  }

  // Same passes as a 5 s reference scan for every fixture object at three places,
  // for a small fraction of its propagations.
  // Every propagation counts, including those inside SpaceOrbit (peak search).
  let mark = O.stats.looks;
  const take = () => { const n = O.stats.looks - mark; mark = O.stats.looks; return n; };
  try {
    let adaptive = 0, reference = 0;
    for (const [lat, lon] of [[49.5, 13.4], [52.52, 13.405], [-33.9, 151.2]]) {
      const o3 = O.observer(lat, lon, 0), a3 = K.observer(lat, lon, 0), s3 = (ms) => K.sun(ms, a3).el,
        r3 = P.darkRanges(from, from + 12 * 3600000, s3);
      for (const o of objects) {
        take();
        const fast = P.passes(o, o3, r3, s3);
        adaptive += take();
        const slow = P.passes(o, o3, r3, s3, 5000);
        reference += take();
        assert.deepEqual(fast.map((p) => Math.round(p.maxMs / 120000)), slow.map((p) => Math.round(p.maxMs / 120000)), o.name);
      }
    }
    assert.ok(adaptive > 0 && adaptive < 0.2 * reference, `${adaptive} vs ${reference}`);
  } finally {
    mark = O.stats.looks;
  }
});
test("next-rise lookup finds the same grazing pass as the planner, cheaply", () => {
  // #49 review: from 49.5 N 13.4 E (40 m) at 00:39:10 UTC the old 30 s lookup
  // jumped to 02:16:35, skipping SL-14 R/B 16792's 10.01° pass at 00:42:19.
  const ob2 = O.observer(49.5, 13.4, 0.04),
    ab2 = K.observer(49.5, 13.4, 40),
    sun2 = (ms) => K.sun(ms, ab2).el,
    from = at("2026-09-29T00:39:10Z"),
    rise = O.nextPass(byId(16792), ob2, from, sun2),
    [planned] = P.passes(byId(16792), ob2, [[from, from + 3600000]], sun2);
  near(rise.riseMs, "2026-09-29T00:42:19Z", 2);
  assert.ok(Math.abs(rise.riseMs - planned.startMs) <= 2000, "lookup and planner agree");
  assert.ok(rise.maxEl >= 10 && rise.maxEl < 10.1 && rise.visible === true);
  // A lookup window can end inside the graze, before a following coarse sample.
  const clipped = O.nextPass(byId(16792), ob2, from, sun2, 195 / 3600);
  assert.ok(clipped, "grazing rise inside the final lookup interval must be found");
  near(clipped.riseMs, "2026-09-29T00:42:19Z", 2);
  assert.equal(O.nextPass(byId(16792), ob2, from, sun2, 185 / 3600), null,
    "a rise beyond the requested window must not leak into the result");
  // Against a plain 5 s scan (first sample at or above 10° after the current
  // pass) for every fixture object, and at a fraction of its propagations.
  const brute = (o, ob, ms, hours) => {
    let t = ms, l = O.look(o, ob, t);
    while (l && l.el >= 10) l = O.look(o, ob, (t += 5000));
    for (; t < ms + hours * 3600000; t += 5000) {
      l = O.look(o, ob, t);
      if (!l) return null;
      if (l.el >= 10) return t;
    }
    return null;
  };
  // Every propagation counts, including those inside SpaceOrbit (peak search).
  let mark = O.stats.looks;
  const take = () => { const n = O.stats.looks - mark; mark = O.stats.looks; return n; };
  try {
    let fast = 0, slow = 0;
    const start = at("2026-09-28T17:50:40Z");
    for (const o of objects) {
      take();
      const got = O.nextPass(o, ob, start, sunAt, 12);
      fast += take();
      const want = brute(o, ob, start, 12);
      slow += take();
      if (want === null) assert.equal(got, null, o.name);
      else assert.ok(got && Math.abs(got.riseMs - want) <= 5000, `${o.name}: ${got && new Date(got.riseMs).toISOString()} vs ${new Date(want).toISOString()}`);
    }
    assert.ok(fast > 0 && fast < 0.35 * slow, `${fast} vs ${slow}`);
    console.log(`  next-rise propagations: ${fast} adaptive vs ${slow} for a 5 s scan`);
  } finally {
    mark = O.stats.looks;
  }
  // A lookup that starts inside a pass still skips to the next one.
  const inside = O.nextPass(byId(25544), ob, at("2026-09-28T17:51:00Z"), sunAt);
  assert.ok(inside.riseMs > at("2026-09-28T17:53:10Z"));
});
test("train passes merge member intervals, one bounded scan per member", () => {
  const rows = O.parseElements(fs.readFileSync("scripts/space-fixture/recent.json", "utf8")),
    dates = P.launchDates(C.parseSatcat(fs.readFileSync("scripts/space-fixture/recent-satcat.json", "utf8"))),
    start = at("2026-09-28T17:50:40Z"),
    [train] = P.trains(O.build(rows), dates, start).filter((x) => x.id === "train:2026-221"),
    ranges = P.darkRanges(start, start + 12.5 * 3600000, sunAt);
  // Distinct element sets only, representative first.
  const members = P.planMembers(train);
  assert.equal(members[0], train.centre);
  assert.equal(members.length, 9);
  const shared = { ...train, members: train.members.map((m) => ({ ...m, id: m.id + 1e6 })) };
  assert.equal(P.planMembers({ ...shared, centre: train.centre }).length, 9, "same elements under other ids plan once");
  // Each member is one queue entry of roughly one object's cost, so the ~15 ms
  // slices stay as fine-grained as before.
  // Every propagation counts, including those inside SpaceOrbit (peak search).
  let mark = O.stats.looks;
  const take = () => { const n = O.stats.looks - mark; mark = O.stats.looks; return n; };
  const parts = [];
  let centreCost = 0;
  try {
    for (const m of members) {
      take();
      parts.push(...P.passes(m, ob, ranges, sunAt));
      const calls = take();
      if (m === train.centre) centreCost = calls;
      assert.ok(calls < 1.2 * centreCost, `${m.id}: ${calls} vs ${centreCost}`);
    }
  } finally {
    mark = O.stats.looks;
  }
  const [centrePass] = P.passes(train.centre, ob, ranges, sunAt),
    [merged] = P.mergePasses(parts);
  near(centrePass.startMs, "2026-09-28T18:26:50Z", 10);
  near(merged.startMs, "2026-09-28T18:23:55Z", 10);
  assert.ok(merged.endMs >= centrePass.endMs && merged.maxEl >= centrePass.maxEl);
  // Only overlaps/touching intervals join: a real gap is not a visible pass.
  const p = (a, b, el = 20) => ({ startMs: a * 1000, endMs: b * 1000, maxMs: a * 1000, maxEl: el, endReason: "sets", startReason: "rises" });
  assert.deepEqual(P.mergePasses([p(100, 200), p(150, 300, 40), p(350, 400), p(500, 600)]).map((x) => [x.startMs / 1000, x.endMs / 1000, x.maxEl]),
    [[100, 300, 40], [350, 400, 20], [500, 600, 20]]);
  assert.equal(P.mergePasses([p(0, 10), p(10, 20)]).length, 1, "touching visibility intervals merge");
  const short = P.mergePasses([p(0, 10), p(60, 70)]);
  assert.equal(short.length, 2, "an invisible 50-second gap must not be advertised as visible");
  assert.equal(P.previewTime(short[0], 0), 5000, "short preview remains in the first visible interval");
});
test("trains: fresh batches that still fly bunched, with launch dates", () => {
  const recent = JSON.parse(fs.readFileSync("scripts/space-fixture/recent.json", "utf8")),
    dates = P.launchDates(C.parseSatcat(fs.readFileSync("scripts/space-fixture/recent-satcat.json", "utf8"))),
    rows = O.parseElements(JSON.stringify(recent));
  assert.equal(P.trainRows(rows).length, rows.length);
  assert.deepEqual(P.trainRows(rows.slice(0, 5).concat(rows.filter((r) => r[1].startsWith("GUOWANG")))).length, 11, "a family needs eight from one launch");
  const trains = P.trains(O.build(rows), dates, at("2026-09-28T18:00:00Z"));
  assert.deepEqual(trains.map((t) => [t.id, t.family, t.launch, t.members.length, t.batch]), [
    ["train:2026-221", "Guowang", "2026-09-23", 9, 11],
  ]);
  for (const t of trains) assert.ok(t.spread <= 2 * P.TRAIN_CLUSTER && t.members.includes(t.centre));
  assert.equal(P.family("STARLINK-38381").wiki, "Starlink");
  assert.equal(P.family("KUIPER-P1").wiki, "Project Kuiper");
  assert.equal(P.family("COSMOS 2428"), null);
  const stale = O.build(rows).map(o => ({...o, epoch: at("2026-09-24T18:00:00Z")}));
  assert.equal(P.trains(stale, dates, at("2026-09-28T18:00:00Z")).length, 0, "stale elements must not advertise a fresh train");
});
test("planner distinguishes clipped windows and keeps short previews inside visibility", () => {
  const from = at("2026-09-28T17:51:00Z"), to = from + 10000;
  const p = P.examine(byId(25544), ob, from, to, sunAt);
  assert.equal(p.startReason, "ongoing");
  assert.equal(p.endReason, "window");
  assert(P.previewTime(p, from - 60000) >= p.startMs);
  assert(P.previewTime(p, from - 60000) < p.endMs);
});
test("WMM2025 declination matches NOAA's published test values", () => {
  const rows = fs.readFileSync("scripts/space-fixture/wmm2025-test-values.txt", "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#"));
  assert.equal(rows.length, 12);
  for (const row of rows) {
    const [year, h, lat, lon, X, Y, Z, , , , D] = row.trim().split(/\s+/).map(Number);
    const b = M.field(lat, lon, h, year);
    assert.ok(Math.abs(b.x - X) < 0.2 && Math.abs(b.y - Y) < 0.2 && Math.abs(b.z - Z) < 0.2, row);
    assert.ok(Math.abs((Math.atan2(b.y, b.x) * 180) / Math.PI - D) < 0.01, row);
  }
  // Berlin, autumn 2026: about 5° east.
  const berlin = M.declination(52.52, 13.405, at("2026-09-28T18:00:00Z"));
  assert.ok(berlin > 4.5 && berlin < 6, String(berlin));
  // Outside the model's use: no guess.
  assert.equal(M.declination(90, 0, at("2026-09-28T18:00:00Z")), null);
  const blackout = M.field(85,130,0,2026.75);
  assert(Math.hypot(blackout.x,blackout.y)<2000);
  assert.equal(M.declination(85,130,at("2026-09-28T18:00:00Z")),null,'magnetic blackout is distinct from geographic pole');
  assert.equal(M.declination(75,130,at("2026-09-28T18:00:00Z")),null,"caution zone also suspends precise pointing");
  assert(Number.isFinite(M.declination(70,130,at("2026-09-28T18:00:00Z"))));
  assert.equal(M.declination(52, 13, at("2033-01-01T00:00:00Z")), null);
  for (const date of ['2024-12-31T23:59:59.999Z','2030-01-01T00:00:00.001Z'])
    assert.equal(M.declination(52,13,at(date)),null,'outside documented WMM2025 validity: '+date);
  for (const date of ['2025-01-01T00:00:00Z','2030-01-01T00:00:00Z'])
    assert(Number.isFinite(M.declination(52,13,at(date))),'valid model boundary: '+date);

  assert.ok(Math.abs(M.decimalYear(at("2027-07-02T12:00:00Z")) - 2027.5) < 0.002);
});
test("pointing: host samples give the camera direction from horizon to zenith", () => {
  const frameOf = (s) => SP.orient({ pitchDeg: s.pitchDeg, rollDeg: s.rollDeg, bearingDeg: s.azimuthDeg, axis: s.pose === "upright" ? "camera" : "top" });
  let flat = 0, upright = 0;
  for (const rotation of [0, 1, 2, 3])
    for (const az of [0, 37, 123, 200, 315])
      for (const el of [-20, 0, 10, 30, 44, 46, 60, 75, 85, 89, 90])
        for (const roll of [-179, -90, -40, 0, 15, 60, 90, 179]) {
          const s = hostSample(az, el, roll, { rotation });
          assert.ok(Number.isFinite(s.azimuthDeg), `${az}/${el}/${roll}`);
          s.pose === "flat" ? flat++ : upright++;
          const f = frameOf(s), a = SP.aim(f);
          assert.ok(SP.separation(a, { az, el }) < 0.3, `aim ${az}/${el}/${roll}/${rotation}: ${JSON.stringify(a)}`);
          if (el < 80) assert.ok(Math.abs(a.roll - roll) < 0.5, `roll ${az}/${el}/${roll}`);
          // Unrolled, higher in the sky is up on the screen and clockwise is right.
          if (roll === 0 && el < 80) {
            const up = SP.toScreen(f, { az, el: el + 5 }), right = SP.toScreen(f, { az: az + 5, el });
            assert.ok(up.y > 0.08 && Math.abs(up.x) < 0.01 && right.x > 0.01, `${az}/${el}`);
          }
        }
  // Above 45° the host reports the flat pose and the top edge's bearing.
  assert.ok(flat > 100 && upright > 100);
  // Smoothing moves part of the way and keeps a proper frame, even across the zenith.
  const a = frameOf(hostSample(90, 20)), b = frameOf(hostSample(100, 30)), m = SP.smooth(a, b, 0.5);
  const mid = SP.aim(m);
  assert.ok(SP.separation(mid, SP.aim(a)) > 3 && SP.separation(mid, SP.aim(b)) > 3);
  const z = SP.smooth(frameOf(hostSample(0, 88)), frameOf(hostSample(180, 88)), 0.5);
  assert.ok(SP.aim(z).el > 85);
  for (const v of [z.E, z.N, z.U]) assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-9);
  assert.equal(SP.orient({ pitchDeg: 10, rollDeg: 0, axis: "camera" }), null, "no bearing, no frame");
});
test("pointing: a half-turn reacquires without seconds of stale aim", () => {
  const frame = (az, roll = 0) => {
    const s = hostSample(az, 0, roll);
    return SP.orient({...s, bearingDeg: s.azimuthDeg, axis: "camera"});
  };
  for (const target of [frame(180), frame(0, 180)]) {
    let f = frame(0);
    for (let i = 0; i < 10; i++) f = SP.smooth(f, target, .35);
    for (const axis of ["E", "N", "U"])
      assert(Math.hypot(...f[axis].map((v, i) => v - target[axis][i])) < .1, axis);
  }
});

test("pointing: plain words match the screen, the arrow and the lock ring", () => {
  const f = (az, el, roll = 0) => { const s = hostSample(az, el, roll); return SP.orient({ pitchDeg: s.pitchDeg, rollDeg: s.rollDeg, bearingDeg: s.azimuthDeg, axis: s.pose === "upright" ? "camera" : "top" }); };
  const g = (frame, az, el) => SP.guide(frame, { az, el });
  assert.equal(g(f(90, 20), 92, 21).text, "On target. Look past the top of the phone.");
  assert.equal(g(f(90, 20), 92, 21).locked, true);
  assert.equal(g(f(90, 20), 60, 20).text, "Move the phone 3 fists to the left.");
  assert.equal(g(f(90, 20), 100, 30).text, "Move the phone 1½ fists up and to the right.");
  assert.equal(g(f(90, 20), 90, 5).text, "Move the phone 1½ fists down.");
  assert.equal(g(f(90, 20), 270, 30).text, "Turn around: it is behind you, 3 fists up.");
  assert.equal(g(f(90, 20), 270, 30).turnAround, true);
  // Straight up, azimuth stops mattering: the words follow the screen.
  assert.match(g(f(90, 20), 180, 88).text, /^Move the phone 7 fists up/);
  assert.equal(g(f(0, 89), 180, 70).text, "Move the phone 2 fists up.", "tipped back past north, the top edge leans south");
  // Rolled a quarter turn right side down, "higher in the sky" is to the screen's left.
  assert.equal(g(f(90, 20, 90), 90, 35).text, "Move the phone 1½ fists to the left.");
  assert.equal(SP.guide(null, { az: 0, el: 0 }), null);
  assert.equal(SP.guide(f(90, 20), null), null);
});
test("mirror: index and files follow the space-data contract, fail closed otherwise", () => {
  const T = Date.parse("2026-09-29T21:00:00Z");
  const index = (over = {}) => JSON.stringify({
    schema: 1, dataset: "20260929T2053Z", built: "2026-09-29T20:53:36Z", path: "20260929T2053Z/",
    groups: {
      visual: { elements: [{ file: "visual/elements-1.json" }], satcat: [{ file: "visual/satcat-1.json" }] },
      starlink: { elements: [{ file: "starlink/elements-1.json" }, { file: "starlink/elements-2.json" }] },
    },
    ...over,
  });
  const idx = C.parseMirrorIndex(index(), T);
  assert.equal(idx.dataset, "20260929T2053Z");
  assert.deepEqual(idx.groups.visual.elements, ["https://space-data.pages.dev/v1/20260929T2053Z/visual/elements-1.json"]);
  assert.equal(idx.groups.starlink.elements.length, 2);
  assert.equal(idx.groups.starlink.satcat, undefined);
  // Stale, future, malformed or path-escaping indexes are not used.
  assert.equal(C.parseMirrorIndex(index(), T + 13 * 3600000), null, "older than 12 h");
  assert.equal(C.parseMirrorIndex(index({ built: "2026-09-29T23:30:00Z" }), T), null, "from the future");
  assert.equal(C.parseMirrorIndex(index({ schema: 2 }), T), null);
  assert.equal(C.parseMirrorIndex(index({ path: "../x/" }), T), null);
  for (const file of ["visual/elements-2.json", "../visual/elements-1.json", "geo/elements-1.json", "visual/elements-1.json?x", "https://evil.example/x.json"])
    assert.equal(C.parseMirrorIndex(index({ groups: { visual: { elements: [{ file }] } } }), T), null, file);
  assert.equal(C.parseMirrorIndex("<html>", T), null);
  assert.deepEqual(C.parseMirrorFile(JSON.stringify({ schema: 1, kind: "elements", rows: [[1]] }), "elements"), [[1]]);
  assert.equal(C.parseMirrorFile(JSON.stringify({ schema: 1, kind: "satcat", rows: [] }), "elements"), null);
  assert.equal(C.parseMirrorFile("nope", "elements"), null);
  // Rows from the mirror pass the same checks as cached rows.
  const row = O.compact(elements.find((x) => x.NORAD_CAT_ID === 25544));
  assert.deepEqual(O.validRow(JSON.parse(JSON.stringify(row))), row);
  assert.equal(O.rows(elements, O.compact, 5).length, 5);
});
test("layers: navigation families, geostationary belt and longitudes", () => {
  const gnss = JSON.parse(fs.readFileSync("scripts/space-fixture/gnss.json", "utf8")),
    geo = JSON.parse(fs.readFileSync("scripts/space-fixture/geo.json", "utf8"));
  const fam = (name) => C.navFamily(name).family;
  assert.equal(fam("GPS BIIF-1  (PRN 25)"), "GPS");
  assert.equal(fam("GSAT0202 (GALILEO 6)"), "Galileo");
  assert.equal(fam("COSMOS 2485 (747)"), "GLONASS");
  assert.equal(fam("BEIDOU-3 M2 (C20)"), "BeiDou");
  assert.equal(fam("QZS-6 (QZSS/PRN 200)"), "QZSS");
  assert.equal(fam("IRNSS-1B"), "NavIC");
  assert.equal(fam("SES-15 (WAAS/PRN 133)"), "augmentation (SBAS)");
  const unknown = gnss.filter((o) => fam(o.OBJECT_NAME) === "navigation").map((o) => o.OBJECT_NAME);
  assert.ok(unknown.length <= 3, "nearly every fixture navigation satellite has a family: " + unknown);
  const d = C.describeLayer({ name: "GPS BIII-1  (PRN 04)" }, null, "gnss");
  assert.equal(d.kind, "GPS navigation satellite · United States");
  assert.equal(d.wiki, "Global Positioning System");
  // The belt from Berlin: highest in the south, about 30° up; Astra 19.2°E
  // (SGP4, captured elements) sits on it within a degree.
  const belt = K.geoBelt(52.52, 13.405),
    top = belt.reduce((a, b) => (b.el > a.el ? b : a));
  assert.ok(Math.abs(top.az - 180) < 3 && top.el > 29 && top.el < 31, JSON.stringify(top));
  assert.ok(belt.every((p) => p.el >= -1));
  const astra = O.build(O.rows(geo.filter((o) => o.OBJECT_NAME === "ASTRA 1KR")))[0],
    t = Date.parse("2026-09-28T17:50:40Z"),
    l = O.look(astra, O.observer(52.52, 13.405, 0), t),
    lon = O.subLon(astra, t);
  assert.ok(Math.abs(lon - 19.2) < 0.5, String(lon));
  const near = belt.reduce((a, b) => (Math.hypot(b.az - l.az, b.el - l.el) < Math.hypot(a.az - l.az, a.el - l.el) ? b : a));
  assert.ok(Math.hypot(near.az - l.az, near.el - l.el) < 1.5, JSON.stringify([near, l.az, l.el]));
  assert.match(C.describeLayer(astra, null, "geo", lon).kind, /^Geostationary satellite · parked above 19\.\dE?°?/);
  // Only near-sidereal, low-inclination, low-eccentricity orbits are "parked"; the GEO group
  // also holds inclined geosynchronous objects that swing north and south.
  const geoObjects = O.build(O.rows(geo, O.compact, 1000)),
    classes = geoObjects.map((o) => C.geoClass(o));
  assert.deepEqual([classes.filter((x) => x === "parked").length, classes.filter((x) => x === "inclined").length, classes.filter((x) => x === "drifting").length], [119,63,8]);
  const igso = geoObjects.find((o) => o.id === 41434);
  assert.equal(C.geoClass(igso), "inclined");
  assert.equal(C.geoClass(geoObjects.find(o => o.id === 44903)), "drifting", "ELEKTRO-L 3 drifts over 3 degrees/day");
  assert.equal(C.geoClass(geoObjects.find(o => o.id === 56372)), "inclined", "GS-1 crosses the horizon despite inclination below 5 degrees");
  assert.notEqual(C.geoClass({row: [1, "x", null, 0, 1.0027379, 0.1, 0.1]}), "parked", "eccentric synchronous orbit is not stationary");
  const di = C.describeLayer(igso, null, "geo", O.subLon(igso, t));
  assert.equal(di.geo, "inclined");
  assert.match(di.kind, /^Geosynchronous satellite · inclined 60° · traces a daily figure-8, not parked$/);
  assert.equal(C.geoClass({ row: [1, "x", null, 0, 1.03, 0, 0.5, 0, 0, 0, 0, 0, 0] }), "drifting");
  assert.equal(C.geoClass({ row: [1, "x", null, 0, 1.0027379, 0, 1.0, 0, 0, 0, 0, 0, 0] }), "parked");
  assert.equal(C.geoClass({ row: [1, "x", null, 0, 1.0027379, 0, 1.1, 0, 0, 0, 0, 0, 0] }), "inclined");
  // Over six hours the inclined object moves through tens of degrees; Astra does not.
  const ob = O.observer(52.517834, 13.388761, 0), move = (o) => Math.abs(O.look(o, ob, t + 6 * 3600000).el - O.look(o, ob, t).el);
  assert.ok(move(igso) > 30 && move(astra) < 1, `${move(igso)} ${move(astra)}`);
  assert.equal(C.lonText(-8.04), "8.0°W");
  // From the southern hemisphere the belt is in the north.
  const south = K.geoBelt(-33.9, 18.4).reduce((a, b) => (b.el > a.el ? b : a));
  assert.ok(south.az < 3 || south.az > 357, JSON.stringify(south));
});
test("package: manifest, capabilities, scripts and no location in any URL", () => {
  const m = JSON.parse(fs.readFileSync(root + "manifest.json", "utf8"));
  assert.equal(m.id, "dev.construct.space-watch");
  assert.equal(m.version, "0.5.1");
  assert.deepEqual(m.constructApi, { min: "0.14.0", target: "0.14.0" });
  const caps = Object.fromEntries(m.capabilities.map((c) => [c.id, c]));
  assert.deepEqual(Object.keys(caps).sort(), ["location.read", "net.http", "orientation.read", "storage.kv"]);
  assert.equal(caps["orientation.read"].optional, true);
  assert.match(caps["orientation.read"].reason, /stay on this phone/);
  assert.deepEqual(caps["net.http"].origins, ["https://space-data.pages.dev", "https://celestrak.org", "https://en.wikipedia.org"]);
  assert.match(caps["net.http"].reason, /mirror.*CelesTrak directly/); assert.ok(caps["net.http"].reason.length <= 240);
  assert.equal(caps["location.read"].optional, true);
  assert.match(caps["storage.kv"].reason, /not your location/);
  const html = fs.readFileSync(root + "ui/index.html", "utf8"),
    app = fs.readFileSync(root + "ui/app.js", "utf8");
  // Module CSP: no inline script or style.
  assert.doesNotMatch(html, /\sstyle=|<style|<script(?![^>]*\ssrc=)/);
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((x) => x[1]);
  assert.deepEqual(scripts, ["bridge.js", "vendor/satellite.min.js", "vendor/astronomy.min.js", "space-stars.js", "space-orbit.js", "space-sky.js", "space-catalog.js", "space-plan.js", "space-magnetic.js", "space-dome.js", "space-pointer.js", "app.js"]);
  for (const s of scripts) assert.ok(fs.existsSync(root + "ui/" + s), s);
  assert.doesNotMatch(app, /\bfetch\s*\(|XMLHttpRequest|navigator\.geolocation|console\./);
  // Every URL the module can request is built from fixed strings plus a
  // catalogue designator or an object name; coordinates never enter one.
  const urls = [C.MIRROR_INDEX, C.ELEMENTS_URL, C.SATCAT_URL, C.RECENT_URL, C.RECENT_SATCAT_URL, C.launchUrl("1998-067A"), C.wikiUrl({ wiki: "International Space Station" }), C.wikiUrl({ search: "COSMOS 2428" }, true)];
  for (const u of urls) assert.match(u, /^https:\/\/(space-data\.pages\.dev|celestrak\.org|en\.wikipedia\.org)\//);
  assert.doesNotMatch(app, /MIRROR[^;]*(lat|lon)/, "mirror URLs never carry the place");
  const keys = [...app.matchAll(/kvSet\("([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual([...new Set(keys)].sort(), ["fetch-state", "preferences", "recent-launches"]);
  assert.doesNotMatch(app, /kvSet\(`?(place|location|coordinates|lat)/);
  for (const shared of ["construct-ui.css", "bridge.js"])
    assert.equal(fs.readFileSync(root + "ui/" + shared, "utf8"), fs.readFileSync("examples/sky-watch-module/ui/" + shared, "utf8"), shared);
  const docs = fs.readFileSync("docs/space-watch.md", "utf8");
  assert.ok(docs.includes(`Space Watch **${m.version}** (source candidate)`));
  // Vendored libraries are pinned by hash in the doc.
  for (const f of ["satellite.min.js", "astronomy.min.js"]) {
    const sha = crypto.createHash("sha256").update(fs.readFileSync(root + "ui/vendor/" + f)).digest("hex");
    assert.ok(docs.includes(sha), `${f} ${sha} recorded in docs/space-watch.md`);
    assert.ok(fs.existsSync(root + "ui/vendor/" + (f.startsWith("satellite") ? "satellite-js" : "astronomy-engine") + "-LICENSE.txt"));
  }
});
console.log(`${count} Space Watch tests passed.`);
