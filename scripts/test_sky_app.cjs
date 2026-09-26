// Exercise the actual module controller with a bounded host/DOM double.
// Layout and real pointer/permission behavior remain Android acceptance work.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = 'examples/sky-watch-module/ui/';
const flush = () => new Promise(resolve => setImmediate(resolve));
function rig({saved = {}, pendingLocation = false, pendingHttp = false, error = null} = {}) {
  const elements = new Map(), events = {}, timers = [], calls = [], locations = [], requests = [];
  const storage = structuredClone(saved);
  let now = Date.now();
  class Element {
    constructor() { this.hidden = false; this.disabled = false; this.open = false; this.value = ''; this.textContent = ''; this.dataset = {}; this.children = []; this.listeners = {}; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute() {}
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
    Date: clock, setInterval: fn => timers.push(fn),
    SkyMap: class {setArea() {} update() {} pause() {} reset() {} shows() { return true; }},
    call: async (method, params) => {
      calls.push({method, params: JSON.parse(JSON.stringify(params))});
      if (method === 'storage.kv') {
        if (params.op === 'set') storage[params.key] = JSON.parse(JSON.stringify(params.value));
        return structuredClone(storage[params.key] ?? null);
      }
      if (method === 'location.read') {
        if (error) throw Object.assign(new Error(error), {code: error});
        if (pendingLocation) return new Promise(resolve => locations.push(resolve));
        return {latitude: 50.0379, longitude: 8.5622, accuracyM: 12};
      }
      if (method === 'net.http') {
        const result = {status: 200, text: JSON.stringify(params.url.includes('opensky') ? {time: now / 1000, states: []} : {now, ac: []})};
        if (pendingHttp) return new Promise(resolve => requests.push(() => resolve(result)));
        return result;
      }
    }});
  vm.runInContext(['models.js', 'sky-data.js', 'app.js'].map(f => fs.readFileSync(root + f, 'utf8')).join('\n'), context);
  return {el, calls, storage, fix: () => locations.shift()({latitude: 50.0379, longitude: 8.5622, accuracyM: 12}),
    finishHttp: () => requests.splice(0).forEach(f => f()),
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
  assert.match(r.el('status').textContent, /retrying/); assert.equal(r.calls.filter(c => c.method === 'net.http').length, 0);
  r.advance(16000); await flush(); assert.equal(r.calls.filter(c => c.method === 'net.http').length, 1);
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
  console.log('Sky app lifecycle checks passed: startup, settings/storage, gates, timeout, cooldown, manual escape, both cancel paths, stale location and interrupted refresh.');
})().catch(error => { console.error(error); process.exitCode = 1; });
