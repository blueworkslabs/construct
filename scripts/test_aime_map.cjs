// Aimé map class: projection, viewer drag/placement callbacks, pan vs. drag,
// wedge geometry and tile failure handling. Pixels/tiles remain Android work.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ui = "examples/aime-module/ui/";
const context = vm.createContext({ ResizeObserver: class { observe() {} }, Date, Map, Set, Promise, Math, Number, Image: class {}, devicePixelRatio: 2 });
vm.runInContext(fs.readFileSync(ui + "resection.js", "utf8") + fs.readFileSync(ui + "aime-map.js", "utf8") + "\nglobalThis.TestMap = AimeMap; globalThis.R = Resection;", context);
const { TestMap, R } = context;
const tick = () => new Promise((r) => setImmediate(r));
function rig(getImage = () => new Promise(() => {})) {
  const listeners = {},
    events = { viewer: [], pans: 0, errors: [] };
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
  const map = new TestMap(canvas, { getImage, onViewer: (p) => events.viewer.push(p), onPan: () => events.pans++, onError: (e) => events.errors.push(e) });
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
  console.log(`${checks} Aimé map checks passed.`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
