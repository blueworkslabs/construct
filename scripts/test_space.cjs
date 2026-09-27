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
test("package: manifest, capabilities, scripts and no location in any URL", () => {
  const m = JSON.parse(fs.readFileSync(root + "manifest.json", "utf8"));
  assert.equal(m.id, "dev.construct.space-watch");
  assert.equal(m.version, "0.1.4");
  assert.deepEqual(m.constructApi, { min: "0.9.0", target: "0.9.0" });
  const caps = Object.fromEntries(m.capabilities.map((c) => [c.id, c]));
  assert.deepEqual(Object.keys(caps).sort(), ["location.read", "net.http", "storage.kv"]);
  assert.deepEqual(caps["net.http"].origins, ["https://celestrak.org", "https://en.wikipedia.org"]);
  assert.equal(caps["location.read"].optional, true);
  assert.match(caps["storage.kv"].reason, /not your location/);
  const html = fs.readFileSync(root + "ui/index.html", "utf8"),
    app = fs.readFileSync(root + "ui/app.js", "utf8");
  // Module CSP: no inline script or style.
  assert.doesNotMatch(html, /\sstyle=|<style|<script(?![^>]*\ssrc=)/);
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((x) => x[1]);
  assert.deepEqual(scripts, ["bridge.js", "vendor/satellite.min.js", "vendor/astronomy.min.js", "space-stars.js", "space-orbit.js", "space-sky.js", "space-catalog.js", "space-dome.js", "app.js"]);
  for (const s of scripts) assert.ok(fs.existsSync(root + "ui/" + s), s);
  assert.doesNotMatch(app, /\bfetch\s*\(|XMLHttpRequest|navigator\.geolocation|console\./);
  // Every URL the module can request is built from fixed strings plus a
  // catalogue designator or an object name; coordinates never enter one.
  const urls = [C.ELEMENTS_URL, C.SATCAT_URL, C.launchUrl("1998-067A"), C.wikiUrl({ wiki: "International Space Station" }), C.wikiUrl({ search: "COSMOS 2428" }, true)];
  for (const u of urls) assert.match(u, /^https:\/\/(celestrak\.org|en\.wikipedia\.org)\//);
  const keys = [...app.matchAll(/kvSet\("([^"]+)"/g)].map((x) => x[1]);
  assert.deepEqual([...new Set(keys)].sort(), ["fetch-state", "preferences"]);
  assert.doesNotMatch(app, /kvSet\(`?(place|location|coordinates|lat)/);
  for (const shared of ["construct-ui.css", "bridge.js"])
    assert.equal(fs.readFileSync(root + "ui/" + shared, "utf8"), fs.readFileSync("examples/sky-watch-module/ui/" + shared, "utf8"), shared);
  const docs = fs.readFileSync("docs/space-watch.md", "utf8");
  assert.match(docs, /Space Watch \*\*0\.1\.4\*\*/);
  // Vendored libraries are pinned by hash in the doc.
  for (const f of ["satellite.min.js", "astronomy.min.js"]) {
    const sha = crypto.createHash("sha256").update(fs.readFileSync(root + "ui/vendor/" + f)).digest("hex");
    assert.ok(docs.includes(sha), `${f} ${sha} recorded in docs/space-watch.md`);
    assert.ok(fs.existsSync(root + "ui/vendor/" + (f.startsWith("satellite") ? "satellite-js" : "astronomy-engine") + "-LICENSE.txt"));
  }
});
console.log(`${count} Space Watch tests passed.`);
