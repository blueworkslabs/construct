"use strict";
const assert = require("node:assert/strict");
const D = require("../examples/sky-watch-module/ui/sky-data.js");
const fs = require("node:fs");
let count = 0;
function test(name, body) {
  body();
  count++;
  console.log("PASS " + name);
}
const now = 1700000000,
  center = { lat: 50, lon: 8 };
function adsb(row = {}, root = {}) {
  return {
    now: now * 1000,
    ac: [
      {
        hex: "abc123",
        flight: " TEST123 ",
        r: "D-TEST",
        t: "BE30",
        lat: 50.01,
        lon: 8.01,
        alt_baro: 10000,
        gs: 200,
        track: 90,
        seen_pos: 2,
        category: "A1",
        ...row,
      },
    ],
    ...root,
  };
}
function opensky(changes = {}) {
  const a = [
    "abc123",
    " TEST123 ",
    "Unknown",
    now - 1,
    now,
    8.01,
    50.01,
    3000,
    false,
    100,
    90,
    0,
    null,
    3050,
    "1234",
    false,
    0,
  ];
  for (const [key, val] of Object.entries(changes)) a[Number(key)] = val;
  return { time: now, states: [a] };
}
const feed = (source, aircraft) => ({
  source,
  aircraft,
  ok: true,
  received: now,
});
test("ADSB time/units and module-owned model identity", () => {
  const a = D.adsb(adsb(), now)[0];
  assert.equal(a.positionTime, now - 2);
  assert.equal(a.altitudeM, 3048);
  assert.ok(Math.abs(a.speedMps - 102.8888) < 0.001);
  assert.equal(a.callsign, "TEST123");
  assert.equal(a.registration, "D-TEST");
  assert.equal(D.name(a.type), "Beechcraft King Air 300");
  assert.equal(D.name("B350"), "Beechcraft King Air 350");
});
test("reject stale server snapshot", () =>
  assert.throws(() => D.adsb(adsb({}, { now: (now - 121) * 1000 }), now)));
test("position age not contact age", () =>
  assert.equal(D.opensky(opensky({ 3: now - 121, 4: now }), now).length, 0));
test("reject ground, invalid coords, ids and missing position age", () => {
  for (const x of [
    { alt_baro: "ground" },
    { lat: null },
    { lon: 181 },
    { seen_pos: null },
    { seen_pos: -1 },
    { seen_pos: 121 },
    { hex: "bogus" },
  ])
    assert.equal(D.adsb(adsb(x), now).length, 0);
});
test("numeric strings do not become coordinates or motion", () => {
  assert.equal(D.adsb(adsb({ lat: "50" }), now).length, 0);
  assert.equal(D.adsb(adsb({ gs: "200" }), now)[0].speedMps, null);
});
test("future timestamps rejected and small allowed skew retained", () => {
  assert.equal(D.opensky(opensky({ 3: now + 11 }), now).length, 0);
  assert.equal(D.opensky(opensky({ 3: now + 5 }), now).length, 1);
});
test("OpenSky optional category and null states", () => {
  assert.equal(D.opensky(opensky({ 17: 8 }), now)[0].category, "Rotorcraft");
  assert.deepEqual(D.opensky({ time: now, states: null }, now), []);
});
test("Combined uses coherent freshest motion with identity provenance", () => {
  const a = D.adsb(adsb(), now),
    o = D.opensky(opensky(), now);
  const m = D.merge(
    { adsb: feed("adsb", a), opensky: feed("opensky", o) },
    "combined",
    center,
    50,
    now,
  )[0];
  assert.equal(m.source, "opensky");
  assert.equal(m.altitudeM, 3000);
  assert.equal(m.registration, "D-TEST");
  assert.equal(m.registrationSource, "adsb");
  assert.equal(m.type, "BE30");
  assert.deepEqual(m.sources, ["opensky", "adsb"]);
  assert.equal(m.positionTime, now - 1);
});
test("single-source isolation", () => {
  const a = D.adsb(adsb(), now),
    o = D.opensky(opensky(), now);
  assert.equal(
    D.merge(
      { adsb: feed("adsb", a), opensky: feed("opensky", o) },
      "opensky",
      center,
      50,
      now,
    )[0].type,
    null,
  );
});
test("do not inherit identity from expired feed", () => {
  const a = D.adsb(adsb(), now).map((x) => ({ ...x, positionTime: now - 121 }));
  assert.equal(
    D.merge(
      {
        adsb: feed("adsb", a),
        opensky: feed("opensky", D.opensky(opensky(), now)),
      },
      "combined",
      center,
      50,
      now,
    )[0].type,
    null,
  );
});
test("source conflicts visible and symbols neutral", () => {
  const a = D.adsb(adsb(), now),
    o = D.opensky(opensky(), now).map((x) => ({ ...x, type: "A20N" }));
  const m = D.merge(
    { adsb: feed("adsb", a), opensky: feed("opensky", o) },
    "combined",
    center,
    50,
    now,
  )[0];
  assert.equal(m.identityConflict, true);
  assert.equal(D.kind(m), "unknown");
});
test("non-ICAO addresses remain separate", () => {
  const a = D.adsb(adsb({ hex: "~abc123" }), now),
    o = D.opensky(opensky(), now);
  assert.equal(
    D.merge(
      { adsb: feed("adsb", a), opensky: feed("opensky", o) },
      "combined",
      center,
      50,
      now,
    ).length,
    2,
  );
  assert.equal(D.lookup(a[0]), null);
});
test("failure retains cached aircraft but success empty clears", () => {
  const original = { adsb: feed("adsb", D.adsb(adsb(), now)) };
  assert.equal(
    D.update(original, {
      source: "adsb",
      ok: false,
      message: "quota",
      aircraft: [],
    }).adsb.aircraft.length,
    1,
  );
  assert.equal(
    D.update(original, { source: "adsb", ok: true, aircraft: [] }).adsb.aircraft
      .length,
    0,
  );
});
test("radius is applied after selection of newest observation", () => {
  const a = D.adsb(adsb(), now),
    o = D.opensky(opensky({ 5: 10 }), now);
  assert.equal(
    D.merge(
      { adsb: feed("adsb", a), opensky: feed("opensky", o) },
      "combined",
      center,
      10,
      now,
    ).length,
    0,
  );
});
test("bearings, compass and distance", () => {
  assert.ok(D.distance({ lat: 0, lon: 0 }, { lat: 0, lon: 1 }) > 111);
  assert.equal(D.bearing({ lat: 0, lon: 0 }, { lat: 1, lon: 0 }), 0);
  assert.equal(D.compass(89), "E");
  assert.equal(D.compass(-45), "NW");
});
test("antimeridian queries split and wrap", () => {
  const boxes = D.boxes({ lat: 50, lon: 179.99 }, 100);
  assert.equal(boxes.length, 2);
  for (const b of boxes) {
    assert.ok(b[1] >= -180 && b[3] <= 180);
    assert.ok(b[1] < b[3]);
  }
  assert.ok(
    Math.abs(D.projection.dx(D.projection.x(-179.9), D.projection.x(179.9))) <
      0.001,
  );
});
test("Mercator round trip", () => {
  for (const p of [
    { lat: 0, lon: 0 },
    { lat: 50, lon: 8 },
    { lat: -84, lon: 179 },
  ]) {
    const q = D.projection.point(D.projection.x(p.lon), D.projection.y(p.lat));
    assert.ok(Math.abs(q.lat - p.lat) < 1e-6);
    assert.ok(Math.abs(q.lon - p.lon) < 1e-6);
  }
});
test("no speed or altitude based aircraft classification", () => {
  const a = D.adsb(
    adsb({ t: null, category: null, gs: 5, alt_baro: 100 }),
    now,
  )[0];
  assert.equal(D.kind(a), "unknown");
  assert.equal(D.name("XXXX"), "Aircraft type XXXX");
});
test("known model versus reported category mismatch neutral", () => {
  const a = D.adsb(adsb({ t: "A320", category: "A7" }), now)[0];
  assert.equal(D.kind(a), "unknown");
  assert.equal(D.kind({ ...a, type: null }), "rotorcraft");
});
test("metadata ID and callsign validation", () => {
  const a = D.adsb(adsb({ flight: "DLH123" }), now)[0];
  assert.deepEqual(D.lookup(a), { icao: "abc123", airline: "DLH" });
  assert.equal(D.lookup({ ...a, callsign: "D-TEST" }).airline, null);
  assert.equal(D.lookup({ ...a, key: "icao:../../oops" }), null);
});
test("database identity checked; owner remains owner", () => {
  assert.throws(() =>
    D.aircraftInfo({ response: { aircraft: { mode_s: "ffffff" } } }, "abc123"),
  );
  const a = D.aircraftInfo(
    {
      response: {
        aircraft: {
          mode_s: "ABC123",
          registered_owner: "Lease Co",
          manufacturer: "Beech",
          type: "King Air",
          photo: "https://bad",
          flightroute: {},
        },
      },
    },
    "abc123",
  );
  assert.equal(a.owner, "Lease Co");
  assert.ok(!("photo" in a));
  assert.ok(!("flightroute" in a));
});
test("ambiguous airline record stays unknown", () => {
  assert.equal(
    D.airlineInfo({ response: [{ icao: "DLH", name: "Lufthansa" }] }, "DLH"),
    "Lufthansa",
  );
  assert.equal(
    D.airlineInfo(
      {
        response: [
          { icao: "DLH", name: "A" },
          { icao: "DLH", name: "B" },
        ],
      },
      "DLH",
    ),
    null,
  );
});
test("actual module has no native Sky launcher or direct network/geolocation", () => {
  const root = "examples/sky-watch-module/";
  const m = JSON.parse(fs.readFileSync(root + "manifest.json"));
  assert.equal(m.constructApi.min, "0.9.0");
  assert.ok(!m.capabilities.some((c) => c.id === "sky.watch"));
  const app = fs.readFileSync(root + "ui/app.js", "utf8");
  assert.ok(
    !/\bfetch\s*\(|XMLHttpRequest|navigator\.geolocation|call\(['"]sky\.watch/.test(
      app,
    ),
  );
  assert.match(app, /call\(['"]location\.read['"]/);
  assert.match(app, /call\(['"]net\.http['"]/);
});
test("saved preferences validate and never carry coordinates", () => {
  const d = D.preferences(null);
  assert.deepEqual(d, { mode: "adsb", radius: 50, auto: false, startWithLocation: true });
  assert.deepEqual(D.preferences("junk"), d);
  assert.deepEqual(D.preferences([1, 2]), d);
  assert.deepEqual(
    D.preferences({ mode: "combined", radius: 25, auto: true, startWithLocation: false, lat: 50, lon: 8 }),
    { mode: "combined", radius: 25, auto: true, startWithLocation: false },
  );
  assert.deepEqual(D.preferences({ mode: "evil", radius: 7, auto: "yes", startWithLocation: 1 }), d);
  assert.deepEqual(D.MODES, ["adsb", "opensky", "combined"]);
  assert.deepEqual(D.RADII, [10, 25, 50, 100]);
});
test("scale bar picks a round length that fits", () => {
  assert.deepEqual(D.scaleBar(10, 140), { metres: 1000, pixels: 100, text: "1 km" });
  assert.deepEqual(D.scaleBar(0.5, 140), { metres: 50, pixels: 100, text: "50 m" });
  assert.equal(D.scaleBar(2000, 140).text, "200 km");
  assert.equal(D.scaleBar(0, 140), null);
  assert.equal(D.scaleBar(10, NaN), null);
});
test("module start flow, storage keys and shared stylesheet", () => {
  const root = "examples/sky-watch-module/";
  const app = fs.readFileSync(root + "ui/app.js", "utf8"),
    html = fs.readFileSync(root + "ui/index.html", "utf8"),
    m = JSON.parse(fs.readFileSync(root + "manifest.json"));
  // Only these two keys may ever be written; neither holds an area or aircraft.
  const keys = [...app.matchAll(/key:\s*"([^"]+)"/g)].map((x) => x[1]);
  assert.ok(keys.length >= 2);
  for (const k of keys) assert.ok(["provider-cooldowns", "preferences"].includes(k), k);
  assert.match(app, /prefs\.startWithLocation/);
  assert.match(app, /D\.preferences\(/);
  assert.doesNotMatch(app, /key:\s*"(area|location|coordinates|fix)"/);
  assert.match(html, /href="construct-ui\.css"/);
  for (const label of [
    "Choose area",
    "Use my location",
    "Show aircraft",
    "Start with my location when opening",
    "Try location again",
    "Finding your location…",
    "What’s flying nearby?",
  ])
    assert.ok(html.includes(label), label);
  assert.equal(m.version, "0.3.3");
  assert.match(m.capabilities.find((c) => c.id === "storage.kv").reason, /not your location/);
  assert.equal(m.capabilities.find((c) => c.id === "location.read").optional, true);
  assert.match(fs.readFileSync("docs/sky-watch.md", "utf8"), /Sky Watch \*\*0\.3\.3\*\*/);
});
test("malformed categories and identity fields remain unknown", () => {
  for (const value of ["constructor", "__proto__", ["A7"], {}, 7, null]) assert.equal(D.category(value), null);
  const now = Date.now() / 1000;
  const a = D.adsb({now: now * 1000, ac:[{hex:"abc123",lat:50,lon:8,seen_pos:0,r:42,t:{},category:"constructor"}]}, now)[0];
  assert.equal(a.category, null); assert.equal(a.registrationSource, null); assert.equal(a.typeSource, null);
});
console.log(`${count} module Sky tests passed.`);
