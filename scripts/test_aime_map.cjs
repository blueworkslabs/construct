// Aimé map class: projection, viewer drag/placement callbacks, pan vs. drag,
// wedge geometry, tile failure handling, the distance ruler and the long-press pin. Pixels/tiles
// remain Android work.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ui = "examples/aime-module/ui/";
const context = vm.createContext({ ResizeObserver: class { observe() {} }, Date, Map, Set, Promise, Math, Number, Image: class {}, devicePixelRatio: 2, setTimeout, clearTimeout });
vm.runInContext(fs.readFileSync(ui + "resection.js", "utf8") + fs.readFileSync(ui + "aime-map.js", "utf8") + "\nglobalThis.TestMap = AimeMap; globalThis.R = Resection;", context);
const { TestMap, R } = context;
const tick = () => new Promise((r) => setImmediate(r));
function rig(getImage = () => new Promise(() => {})) {
  const listeners = {},
    events = { viewer: [], pans: 0, errors: [], ruler: [], pins: [] };
  const canvas = {
    width: 0,
    height: 0,
    setPointerCapture() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 300, height: 300 }),
    addEventListener(type, fn) {
      listeners[type] = fn;
    },
    getContext: () => new Proxy({}, { get: (_, k) => (k === "measureText" ? () => ({ width: 40 }) : () => {}), set: () => true }),
  };
  const map = new TestMap(canvas, { getImage, onViewer: (p) => events.viewer.push(p), onPan: () => events.pans++, onError: (e) => events.errors.push(e), onRuler: (pts) => events.ruler.push(JSON.parse(JSON.stringify(pts))), onPin: (p, mPerPx) => events.pins.push({ ...JSON.parse(JSON.stringify(p)), mPerPx }) });
  const fire = (type, x, y, id = 1) => listeners[type]({ type, pointerId: id, clientX: x, clientY: y, preventDefault() {}, deltaY: 0 });
  map.setScene({ viewer: { lat: 46.8, lon: 9.2, accuracyM: 10 } }, false);
  map.center = { lat: 46.8, lon: 9.2 };
  map.zoom = 14;
  map.draw();
  return { map, fire, events };
}
let checks = 0;
const ok = (name) => {
  checks++;
  console.log("ok -", name);
};
(async () => {
  {
    const { map } = rig();
    for (const p of [{ lat: 46.8, lon: 9.2 }, { lat: -33.9, lon: 151.2 }, { lat: 60, lon: -179.99 }]) {
      map.center = p;
      map.draw();
      const q = map.xy(p),
        back = map.geoAt(q.x, q.y);
      assert.ok(Math.abs(back.lat - p.lat) < 1e-9 && Math.abs(back.lon - p.lon) < 1e-9);
      assert.ok(Math.abs(q.x - 150) < 1e-6 && Math.abs(q.y - 150) < 1e-6);
    }
    ok("projection round-trips at the centre, including near the dateline");
  }
  {
    const { map, fire, events } = rig();
    map.editable = true;
    fire("pointerdown", 150, 150);
    fire("pointermove", 170, 150);
    fire("pointermove", 190, 150);
    fire("pointerup", 190, 150);
    assert.equal(events.viewer.length, 1);
    assert.ok(events.viewer[0].lon > 9.2 && Math.abs(events.viewer[0].lat - 46.8) < 1e-6);
    assert.ok(events.viewer[0].mPerPx > 0);
    assert.equal(events.pans, 0, "dragging the viewer does not pan");
    assert.equal(map.scene.fitted, null, "a moved viewer invalidates the fitted dot and wedge");
    ok("editable viewer ring drags to a new point and reports it once on release");
  }
  {
    const { map, fire, events } = rig();
    map.editable = false;
    const before = { ...map.center };
    fire("pointerdown", 150, 150);
    fire("pointermove", 190, 150);
    fire("pointerup", 190, 150);
    assert.equal(events.viewer.length, 0);
    assert.ok(map.center.lon < before.lon, "the map panned instead");
    const e2 = rig();
    e2.map.editable = true;
    e2.fire("pointerdown", 40, 40);
    e2.fire("pointermove", 90, 40);
    e2.fire("pointerup", 90, 40);
    assert.equal(e2.events.viewer.length, 0, "a drag away from the ring pans");
    ok("non-editable map and drags away from the ring pan without touching the viewpoint");
  }
  {
    const { map, fire, events } = rig();
    map.setScene({ viewer: null }, false);
    map.placing = true;
    fire("pointerdown", 100, 200);
    fire("pointerup", 100, 200);
    assert.equal(events.viewer.length, 1);
    const q = map.xy(events.viewer[0]);
    assert.ok(Math.abs(q.x - 100) < 1e-6 && Math.abs(q.y - 200) < 1e-6);
    map.placing = false;
    fire("pointerdown", 100, 200);
    fire("pointerup", 100, 200);
    assert.equal(events.viewer.length, 1, "taps only place while placing");
    ok("placing mode sets the viewpoint where the map is tapped");
  }
  {
    const { map } = rig();
    const from = { lat: 46.8, lon: 9.2 },
      pts = map.wedgePoints(from, { bearing: 44, sigma: 3.8, lengthKm: 30 });
    assert.equal(pts.length, 18);
    assert.ok(Math.abs(R.diff(R.bearing(from, pts[1]), 40.2)) < 0.01);
    assert.ok(Math.abs(R.diff(R.bearing(from, pts[17]), 47.8)) < 0.01);
    assert.ok(Math.abs(R.distance(from, pts[9]) - 30) < 0.01);
    ok("wedge spans bearing ±1σ out to the requested length");
    const outer = map.wedgePoints(from, { bearing: 44, sigma: 3.8, lengthKm: 30 }, 2);
    assert.ok(Math.abs(R.diff(R.bearing(from, outer[1]), 36.4)) < 0.01);
    assert.ok(Math.abs(R.diff(R.bearing(from, outer[17]), 51.6)) < 0.01);
    const fills = [];
    map.ctx = new Proxy({}, { get: () => () => {}, set: (_, k, v) => (k === "fillStyle" && fills.push(v), true) });
    map.drawWedge(from, { bearing: 44, sigma: 3.8, lengthKm: 30 });
    assert.deepEqual(fills, ["#e9c46a14", "#e9c46a33"], "fainter outer band first, inner band on top");
    ok("outer wedge band spans bearing ±2σ, the sheet's could-be range");
  }
  {
    const { map } = rig();
    map.setScene({ viewer: { lat: 46.8, lon: 9.2 }, candidates: [{ lat: 46.9, lon: 9.4, n: 1 }, { lat: 47.2, lon: 9.9, n: 2 }], focus: 0 }, true);
    const v = map.xy({ lat: 46.8, lon: 9.2 }),
      c = map.xy({ lat: 46.9, lon: 9.4 });
    for (const q of [v, c]) assert.ok(q.x > 0 && q.x < 300 && q.y > 0 && q.y < 300, JSON.stringify(q));
    ok("fit frames the viewer and the focused candidate");
  }
  {
    let reject;
    const { map, events } = rig(() => new Promise((_, r) => (reject = r)));
    map.wanted = new Set(["14/8610/5774"]);
    map.pending.clear();
    map.pump();
    reject(Object.assign(new Error("Paused"), { code: "RUN_PAUSED" }));
    await tick();
    assert.equal(map.failures.size, 0);
    map.pump();
    reject(new Error("Offline"));
    await tick();
    assert.equal(map.failures.size, 1);
    assert.equal(events.errors.filter(Boolean).length, 1);
    ok("tile cancellation is not a failure; real failures cool down and report");
  }
  {
    const { map, fire, events } = rig();
    map.editable = true;
    const before = JSON.stringify(map.scene);
    fire("pointerdown", 150, 150);
    fire("pointermove", 190, 150);
    fire("pointercancel", 190, 150);
    assert.equal(JSON.stringify(map.scene), before);
    assert.equal(events.viewer.length, 0);
    fire("pointerdown", 150, 150);
    fire("pointermove", 190, 150);
    map.pause(true);
    assert.equal(JSON.stringify(map.scene), before);
    assert.equal(map.pointers.size, 0);
    ok("cancelled or paused viewer drags restore the saved scene");
  }
  {
    const { map } = rig();
    map.setScene({viewer: {lat: 0, lon: 179.99}, candidates: [{lat: 0, lon: -179.99}], focus: 0});
    assert.ok(map.zoom > 10, "nearby points across dateline must not fit the whole world");
    for (const p of [map.scene.viewer, map.scene.candidates[0]]) {
      const q = map.xy(p);
      assert.ok(q.x > 0 && q.x < 300);
    }
    ok("fit frames nearby viewer/candidate across the dateline");
  }
  {
    // Known pairs: along the equator 1° is 111.195 km due east; Paris → London
    // is 343.6 km with an initial bearing of 330.0° (and 148.1° back).
    const east = TestMap.measure({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    assert.ok(Math.abs(east.km - 111.195) < 0.001 && Math.abs(east.bearing - 90) < 1e-9, JSON.stringify(east));
    const paris = { lat: 48.8566, lon: 2.3522 },
      london = { lat: 51.5074, lon: -0.1278 },
      there = TestMap.measure(paris, london),
      back = TestMap.measure(london, paris);
    assert.ok(Math.abs(there.km - 343.56) < 0.05 && Math.abs(there.bearing - 330.02) < 0.05, JSON.stringify(there));
    assert.ok(Math.abs(back.km - there.km) < 1e-9 && Math.abs(back.bearing - 148.12) < 0.05, "initial bearing depends on the direction");
    const path = TestMap.rulerPath(paris, london);
    assert.deepEqual({ ...path[0] }, paris);
    assert.deepEqual({ ...path.at(-1) }, london);
    assert.ok(Math.abs(R.distance(paris, path[16]) - there.km / 2) < 1e-6 && Math.abs(R.distance(path[16], london) - there.km / 2) < 1e-3, "the line follows the great circle");
    ok("ruler: great-circle distance and initial bearing for known pairs, drawn along the great circle");
  }
  {
    const { map, fire, events } = rig();
    map.setScene({ viewer: null }, false);
    map.placing = true;
    map.setRuler(true);
    const zoom = map.zoom;
    fire("pointerdown", 100, 100);
    fire("pointerup", 100, 100);
    fire("pointerdown", 102, 101);
    fire("pointerup", 102, 101);
    assert.equal(events.viewer.length, 0, "ruler taps never place the viewpoint");
    assert.equal(map.zoom, zoom, "two quick ruler taps are not a double-tap zoom");
    assert.equal(events.ruler.length, 2);
    fire("pointerdown", 250, 40);
    fire("pointerup", 250, 40);
    assert.equal(map.ruler.points.length, 1, "a third tap starts a new measurement");
    fire("pointerdown", 40, 250);
    fire("pointerup", 40, 250);
    const [a, b] = events.ruler.at(-1);
    for (const [p, x, y] of [[a, 250, 40], [b, 40, 250]]) {
      const q = map.xy(p);
      assert.ok(Math.abs(q.x - x) < 1e-6 && Math.abs(q.y - y) < 1e-6);
    }
    assert.ok(TestMap.measure(a, b).bearing > 180 && TestMap.measure(a, b).bearing < 270, "north-east to south-west");
    const panned = { ...map.center };
    fire("pointerdown", 150, 150);
    fire("pointermove", 190, 150);
    fire("pointerup", 190, 150);
    assert.equal(map.ruler.points.length, 2, "a drag still pans and adds no point");
    assert.notDeepEqual(map.center, panned);
    map.clearRuler();
    assert.equal(map.ruler.points.length, 0);
    map.setRuler(false);
    assert.equal(map.ruler, null);
    fire("pointerdown", 100, 200);
    fire("pointerup", 100, 200);
    assert.equal(events.viewer.length, 1, "with the ruler off, placing works again");
    ok("ruler: taps add two points, a third restarts, drags pan; clearing and turning it off restore placing");
  }
  {
    const { map, fire, events } = rig();
    map.editable = true;
    map.setScene({ viewer: { lat: 46.8, lon: 9.2, accuracyM: 10 }, marks: [{ lat: 46.81, lon: 9.21, name: "Tower" }] }, false);
    map.setRuler(true);
    const v = map.xy({ lat: 46.8, lon: 9.2 }),
      m = map.xy({ lat: 46.81, lon: 9.21 });
    fire("pointerdown", v.x + 10, v.y - 8);
    fire("pointerup", v.x + 10, v.y - 8);
    fire("pointerdown", m.x + 5, m.y - 16);
    fire("pointerup", m.x + 5, m.y - 16);
    assert.deepEqual(events.ruler.at(-1), [{ lat: 46.8, lon: 9.2 }, { lat: 46.81, lon: 9.21 }], "taps near the viewer and a pin head snap to them");
    assert.equal(events.viewer.length, 0, "a tap on the ring measures; it does not move the viewpoint");
    const beforeViewer = { ...map.scene.viewer }, beforeCenter = { ...map.center };
    fire("pointerdown", v.x, v.y);
    fire("pointermove", v.x + 45, v.y + 20);
    fire("pointerup", v.x + 45, v.y + 20);
    assert.equal(events.viewer.length, 0, "ruler-mode drags on the ring must pan, never correct the viewpoint");
    assert.deepEqual(map.scene.viewer, beforeViewer);
    assert.notDeepEqual(map.center, beforeCenter);
    const labels = [];
    map.cb.rulerLabel = (r) => (labels.push(r), "label");
    map.draw();
    assert.equal(labels.length, 1);
    assert.ok(Math.abs(labels[0].km - R.distance({ lat: 46.8, lon: 9.2 }, { lat: 46.81, lon: 9.21 })) < 1e-9);
    map.setScene({ viewer: { lat: 46.8, lon: 9.2 } }, false);
    assert.equal(map.ruler.points.length, 2, "a new scene (after an edit) keeps the ruler");
    const dropped = { lat: 46.83, lon: 9.24, name: "Dropped pin" };
    map.setScene({ pin: dropped }, false);
    map.clearRuler();
    const head = map.xy(dropped);
    fire("pointerdown", head.x + 3, head.y - 16);
    fire("pointerup", head.x + 3, head.y - 16);
    assert.deepEqual(events.ruler.at(-1), [{ lat: dropped.lat, lon: dropped.lon }], "ruler snaps to the dropped pin head, not the ground above it");
    ok("ruler snaps to the viewer and pins, labels the line through the app's formatter and survives scene updates");
  }
  {
    TestMap.HOLD_MS = 30;
    const wait = () => new Promise((r) => setTimeout(r, 60));
    const { map, fire, events } = rig();
    map.editable = true;
    map.setScene({ viewer: { lat: 46.8, lon: 9.2, accuracyM: 10 }, marks: [{ lat: 46.81, lon: 9.21, name: "Tower", positionM: 16 }] }, false);
    const zoom = map.zoom;
    // Long-press on empty map: one pin there; the release neither zooms nor taps.
    fire("pointerdown", 60, 60);
    await wait();
    fire("pointerup", 60, 60);
    assert.equal(events.pins.length, 1);
    const q = map.xy(events.pins[0]);
    assert.ok(Math.abs(q.x - 60) < 1e-6 && Math.abs(q.y - 60) < 1e-6 && events.pins[0].mPerPx > 0);
    assert.deepEqual({ ...map.scene.pin }, { lat: events.pins[0].lat, lon: events.pins[0].lon });
    fire("pointerdown", 60, 60);
    fire("pointerup", 60, 60);
    assert.equal(map.zoom, zoom, "the held release did not count towards a double tap");
    // Near a mark pin: snaps to it with its name and position estimate.
    const m = map.xy({ lat: 46.81, lon: 9.21 });
    fire("pointerdown", m.x + 4, m.y - 14);
    await wait();
    fire("pointerup", m.x + 4, m.y - 14);
    assert.deepEqual(events.pins.at(-1), { lat: 46.81, lon: 9.21, name: "Tower", positionM: 16, mPerPx: events.pins.at(-1).mPerPx });
    // Held on the viewer ring: no pin; the ring still drags.
    const v = map.xy({ lat: 46.8, lon: 9.2 });
    fire("pointerdown", v.x, v.y);
    await wait();
    fire("pointermove", v.x + 30, v.y);
    fire("pointerup", v.x + 30, v.y);
    assert.equal(events.pins.length, 2);
    assert.equal(events.viewer.length, 1, "the ring drag corrects the viewpoint as before");
    // A drag or a second finger before the hold ends drops nothing.
    fire("pointerdown", 200, 200);
    fire("pointermove", 230, 200);
    await wait();
    fire("pointerup", 230, 200);
    fire("pointerdown", 200, 200, 1);
    fire("pointerdown", 240, 240, 2);
    await wait();
    fire("pointerup", 200, 200, 1);
    fire("pointerup", 240, 240, 2);
    assert.equal(events.pins.length, 2);
    // Ruler on: a long-press pins without adding a ruler point; taps still measure.
    map.setRuler(true);
    fire("pointerdown", 250, 250);
    await wait();
    fire("pointerup", 250, 250);
    assert.equal(events.pins.length, 3);
    assert.equal(map.ruler.points.length, 0);
    fire("pointerdown", 100, 250);
    fire("pointerup", 100, 250);
    assert.equal(map.ruler.points.length, 1);
    map.setRuler(false);
    // Placing an unlocated viewpoint: no pins; paused: pending hold dropped.
    map.placing = true;
    fire("pointerdown", 120, 120);
    await wait();
    fire("pointerup", 120, 120);
    assert.equal(events.pins.length, 3);
    map.placing = false;
    fire("pointerdown", 150, 60);
    map.pause(true);
    await wait();
    assert.equal(events.pins.length, 3);
    map.pause(false);
    map.clearPin();
    assert.equal(map.scene.pin, null);
    ok("long-press drops a pin (snapping to mark/candidate pins), never on the ring, in placing mode, after a drag or pinch; clearable");
  }
  console.log(`${checks} Aimé map checks passed.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
