// Exercise the actual module controller with a bounded host/DOM double.
// Layout and real pointer/permission behavior remain Android acceptance work.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = 'examples/sky-watch-module/ui/';
const flush = () => new Promise(resolve => setImmediate(resolve));
const hostSample = require('./space-fixture/orientation-sample.cjs');
// A fixture aircraft 18 km north of the rig's location, at 10,000 m, flying east.
const PLANE = {hex: 'abc123', flight: 'DLH123', r: 'D-AIXX', t: 'A320', category: 'A3', lat: 50.2, lon: 8.5622, alt_baro: 32808, gs: 486, track: 90, seen_pos: 0};
function rig({saved = {}, pendingLocation = false, pendingHttp = false, pendingStorage = false, error = null, aircraft = [], orientError = null} = {}) {
  const elements = new Map(), events = {}, timers = [], calls = [], locations = [], requests = [], reads = [], turns = [], expiryTimers = new Set(), follows = [];
  const storage = structuredClone(saved);
  let now = Date.now();
  class Element {
    constructor() { this.hidden = false; this.disabled = false; this.open = false; this.value = ''; this.textContent = ''; this.className = ''; this.dataset = {}; this.children = []; this.listeners = {}; this.attributes = {}; this.style = {}; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getBoundingClientRect() { return {width: 300, height: 300, left: 0, top: 0}; }
    getContext() { return null; }
    get text() { return [this.textContent, ...this.children.map(c => c.text)].join(' '); }
    get lastElementChild() { return this.children.at(-1); }
    scrollIntoView() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
    addEventListener(type, handler) { this.listeners[type] = handler; }
    click() { if (!this.disabled) this.onclick?.(); }
  }
  const el = id => elements.get(id);
  for (const match of fs.readFileSync(root + 'index.html', 'utf8').matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const e = new Element(); e.hidden = /\bhidden\b/.test(match[0]); elements.set(match[1], e);
  }
  const w = {addEventListener(type, handler) { events[type] = handler; }};
  const clock = class extends Date { static now() { return now; } };
  const context = vm.createContext({window: w, document: {getElementById: el, createElement: () => new Element(), querySelectorAll: () => []},
    Date: clock, setInterval: fn => timers.push(fn), Math, JSON, Number, Map, Set, Promise,
    setTimeout: (fn, delay) => delay === 100 ? follows.push(fn) : (() => { const t = {fn, at: now + delay}; expiryTimers.add(t); return t; })(),
    clearTimeout: t => expiryTimers.delete(t),
    SkyMap: class {setArea() {} update(rows, key) { this.rows = rows; this.key = key; } pause() {} reset() {} shows() { return true; } turn(h, follow) { this.rotation = h; this.following = follow; turns.push(h); }},
    call: async (method, params) => {
      calls.push({method, params: JSON.parse(JSON.stringify(params))});
      if (method === 'storage.kv') {
        if (params.op === 'set') storage[params.key] = JSON.parse(JSON.stringify(params.value));
        if (pendingStorage && params.op === 'get') return new Promise(resolve => reads.push(() => resolve(structuredClone(storage[params.key] ?? null))));
        return structuredClone(storage[params.key] ?? null);
      }
      if (method === 'location.read') {
        if (error) throw Object.assign(new Error(error), {code: error});
        if (pendingLocation) return new Promise(resolve => locations.push(resolve));
        return {latitude: 50.0379, longitude: 8.5622, accuracyM: 12};
      }
      if (method === 'orientation.read') {
        if (orientError) throw Object.assign(new Error(orientError), {code: orientError});
        return params.op === 'watch' ? {watching: true, rateHz: params.rateHz ?? 10} : {watching: false};
      }
      if (method === 'net.http') {
        const result = {status: 200, text: JSON.stringify(params.url.includes('opensky') ? {time: now / 1000, states: []} : {now, ac: aircraft})};
        if (pendingHttp) return new Promise(resolve => requests.push(() => resolve(result)));
        return result;
      }
    }});
  vm.runInContext(['models.js', 'sky-data.js', 'space-magnetic.js', 'space-pointer.js', 'app.js'].map(f => fs.readFileSync(root + f, 'utf8')).join('\n'), context);
  return {el, calls, storage, turns, fix: () => locations.shift()({latitude: 50.0379, longitude: 8.5622, accuracyM: 12}),
    orient: detail => events.constructorientation({detail: {timestamp: now, ...detail}}),
    expire: ms => { now += ms; for (const t of [...expiryTimers]) if (t.at <= now) { expiryTimers.delete(t); t.fn(); } },
    card: () => el('selected'),
    finishHttp: () => requests.splice(0).forEach(f => f()),
    finishStorage: () => reads.splice(0).forEach(f => f()),
    advance: ms => { now += ms; timers.forEach(f => f()); },
    visibility: visible => events.constructvisibilitychange({detail: {visible}}),
    submit: (lat, lon) => { el('latitude').value = lat; el('longitude').value = lon; el('area-form').onsubmit({preventDefault() {}}); }};
}
(async () => {
  let r = rig(); await flush();
  assert.match(r.el('area-label').textContent, /Your location/);
  assert.equal(r.calls.filter(c => c.method === 'location.read').length, 1);
  assert(r.el('welcome').hidden); assert(!r.el('area-dialog').open);
  for (const [id, value] of [['source', 'combined'], ['radius', '100']]) {
    r.el(id).value = value; r.el(id).onchange(); await flush(); r.advance(16000); await flush();
  }
  r.el('auto').checked = true; r.el('auto').onchange(); await flush();
  assert.deepEqual(r.storage.preferences, {mode: 'combined', radius: 100, auto: true, startWithLocation: true});
  assert.deepEqual(Object.keys(r.storage).sort(), ['preferences', 'provider-cooldowns']);
  r = rig({saved: r.storage}); await flush();
  assert.equal(r.el('source').value, 'combined'); assert.equal(r.el('radius').value, '100'); assert(r.el('auto').checked);
  r = rig({saved: {preferences: {startWithLocation: false}}}); await flush();
  assert.equal(r.calls.filter(c => c.method === 'location.read').length, 0);
  for (const code of ['CAPABILITY_DENIED', 'LOCATION_PERMISSION', 'LOCATION_TIMEOUT']) {
    r = rig({error: code}); await flush();
    assert(!r.el('welcome').hidden); assert(r.el('workspace').hidden);
    assert.equal(r.el('retry-location').hidden, code !== 'LOCATION_TIMEOUT');
  }
  r = rig({saved: {'provider-cooldowns': {adsb: {last: Date.now(), until: 0}}}}); await flush();
  assert.match(r.el('status').textContent, /Retrying/); assert.equal(r.calls.filter(c => c.method === 'net.http').length, 0);
  r.advance(16000); await flush(); assert.equal(r.calls.filter(c => c.method === 'net.http').length, 1);
  // Combined must not alternate provider-floor failures indefinitely when their
  // previous refresh times differ. Wait until both sources can be retried.
  r = rig({saved: {preferences: {mode: 'combined'}, 'provider-cooldowns': {adsb: {last: Date.now() - 10000, until: 0}}}}); await flush();
  assert.equal(r.calls.filter(c => c.method === 'net.http').length, 1);
  r.advance(6000); await flush(); assert.equal(r.calls.filter(c => c.method === 'net.http').length, 1, 'do not put the other provider back inside its floor');
  r.advance(10000); await flush(); assert.equal(r.calls.filter(c => c.method === 'net.http').length, 3);
  assert.equal(r.el('status').textContent, '');
  r.advance(16000); await flush(); assert.equal(r.calls.filter(c => c.method === 'net.http').length, 3, 'no retry loop when Auto is off');
  // The picker remains authoritative while startup location is pending.
  r = rig({pendingLocation: true}); await flush(); r.el('start').click();
  assert(!r.el('show-aircraft').disabled); r.submit('51', '9'); await flush();
  assert.match(r.el('area-label').textContent, /Chosen area · 51.000, 9.000/);
  r.fix(); await flush(); assert.match(r.el('area-label').textContent, /Chosen area · 51.000, 9.000/);
  // Both Cancel and platform dialog cancellation discard the pending result.
  for (const cancel of ['button', 'dialog']) {
    r = rig({pendingLocation: true, saved: {preferences: {startWithLocation: false}}}); await flush();
    r.el('start').click(); r.el('use-location').click(); await flush();
    if (cancel === 'button') r.el('cancel-area').click(); else { r.el('area-dialog').listeners.cancel(); r.el('area-dialog').close(); }
    r.fix(); await flush(); assert(r.el('workspace').hidden); assert(!r.el('area-dialog').open);
  }
  r = rig({pendingLocation: true}); await flush(); r.visibility(false); r.fix(); await flush(); assert(r.el('workspace').hidden);
  // A refresh interrupted by the native menu must not look permanently busy.
  r = rig({pendingHttp: true}); await flush(); assert.match(r.el('status').textContent, /Refreshing/);
  r.visibility(false); r.finishHttp(); await flush(); r.visibility(true);
  assert(!/Refreshing|Refresh paused/.test(r.el('status').textContent)); assert(!r.el('refresh').disabled);
  // Storage can finish after the user opens the native menu during startup.
  r = rig({pendingStorage: true}); r.visibility(false); r.finishStorage(); await flush();
  assert(r.el('welcome-progress').hidden, 'paused initialization must not restore a phantom locating spinner');
  assert.equal(r.calls.filter(c => c.method === 'location.read').length, 0);
  r.visibility(true); assert(r.el('welcome-progress').hidden);
  // ---- 0.4.0: Follow (heads-up map) and pointing (viewfinder) ----
  r = rig({aircraft: [PLANE]}); await flush(); await flush();
  assert.equal(r.el('count').textContent, '1 aircraft');
  assert(r.el('follow-status').hidden); assert(r.el('pointer-wrap').hidden);
  await r.el('follow').onclick(); await flush();
  assert.deepEqual(r.calls.filter(c => c.method === 'orientation.read').map(c => c.params), [{op: 'watch', rateHz: 10}]);
  assert.equal(r.el('follow').attributes['aria-pressed'], 'true');
  assert.equal(r.el('follow-status').textContent, 'Hold the phone flat for the map, or raise it like a camera to point.');
  // Flat, magnetic 90°: Frankfurt's ~3° east declination makes the map turn ~93°.
  r.orient({pose: 'flat', azimuthDeg: 90, pitchDeg: 88, rollDeg: 0, calibrate: false, accuracyDeg: 12});
  const heading = r.turns.at(-1), dec = heading - 90;
  assert.ok(dec > 2 && dec < 4.5, String(dec));
  assert.equal(r.el('follow-status').textContent, 'Facing E · compass ±12°');
  assert.equal(r.el('north').style.transform, `rotate(${-heading}deg)`);
  // Select the aircraft: it is north of us, so facing east it is on the left.
  r.el('aircraft-list').children[0].click(); await flush();
  const turn = r.card().children.find(c => c.className === 'selected-turn');
  assert(turn && !turn.hidden); assert.equal(turn.textContent, 'Turn left about 90°.');
  for (let i = 0; i < 40; i++) r.orient({pose: 'flat', azimuthDeg: 0 - dec, pitchDeg: 88, rollDeg: 0, calibrate: false, accuracyDeg: 12});
  assert.match(r.card().children.find(c => c.className === 'selected-turn').textContent, /^Ahead of you/);
  // Raise the phone: the viewfinder replaces the map and guides to the aircraft.
  const sample = (az, el, roll = 0) => hostSample(az, el, roll, {declination: dec});
  for (let i = 0; i < 25; i++) r.orient(sample(0, 29));
  assert(!r.el('pointer-wrap').hidden); assert.equal(r.turns.at(-1), 0, 'the map is north-up beneath the viewfinder');
  assert.equal(r.el('point-guide').textContent, 'On target. Look past the top of the phone.');
  assert.equal(r.el('point-guide').className, 'locked');
  assert.match(r.el('follow-status').textContent, /^Pointing N, 3 fists up · compass ±8°$/);
  assert(r.card().children.find(c => c.className === 'selected-turn').hidden, 'the viewfinder gives the guidance while pointing');
  for (let i = 0; i < 25; i++) r.orient(sample(20, 29));
  assert.equal(r.el('point-guide').textContent, 'Move the phone 2 fists to the left.');
  assert.equal(r.el('follow-announcement').textContent, 'Move the phone to the left.');
  // Nothing selected: name what sits in the middle.
  r.card().children.at(-1).children.find(c => c.textContent === 'Dismiss details').click(); await flush();
  for (let i = 0; i < 25; i++) r.orient(sample(0, 29));
  assert.equal(r.el('point-guide').textContent, 'In the middle: DLH123 · Airbus A320 · 32,800 ft.');
  for (let i = 0; i < 25; i++) r.orient(sample(180, 20));
  assert.equal(r.el('point-guide').textContent, 'Tap an aircraft in the list to be guided to it.');
  // Silence ends pointing and the heading; Follow off puts north up.
  r.expire(1501); assert(r.el('pointer-wrap').hidden); assert.equal(r.turns.at(-1), 0);
  r.el('follow').onclick(); await flush();
  assert.equal(r.calls.at(-1).params.op, 'stop'); assert.equal(r.el('follow').attributes['aria-pressed'], 'false');
  assert.equal(r.el('north').style.transform, '');
  assert(!Object.keys(r.storage).some(k => /follow|orient|heading/.test(k)));
  // Pause ends the stream; on return Sky Watch asks again. A terminal event turns Follow off.
  await r.el('follow').onclick(); await flush(); r.visibility(false); r.visibility(true); await flush();
  assert.equal(r.calls.filter(c => c.method === 'orientation.read' && c.params.op === 'watch').length, 3);
  r.orient({watching: false, reason: 'paused'});
  assert.equal(r.el('follow').attributes['aria-pressed'], 'false'); assert.match(r.el('follow-status').textContent, /lost the foreground/);
  // Denied or no compass: a clear note; the map keeps working.
  r = rig({aircraft: [PLANE], orientError: 'CAPABILITY_DENIED'}); await flush(); await flush();
  await r.el('follow').onclick(); await flush();
  assert.match(r.el('follow-status').textContent, /Allow reading compass and tilt/); assert.equal(r.el('count').textContent, '1 aircraft');
  console.log('Sky app lifecycle checks passed: startup, settings/storage, gates, timeout, cooldown, manual escape, both cancel paths, stale location and interrupted refresh, plus Follow (heads-up map, turn words) and pointing (viewfinder, lock, middle, silence, pause, denial).');
})().catch(error => { console.error(error); process.exitCode = 1; });
