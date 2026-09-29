// Exercise the actual Space Watch controller with a bounded host/DOM double.
// Canvas drawing, layout and real permission UI remain Android acceptance work.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const hostSample = require('./space-fixture/orientation-sample.cjs');
const root = 'examples/space-watch-module/ui/';
const flush = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise(resolve => setImmediate(resolve)); };
const HOUR = 3600000, START = Date.parse('2026-09-28T17:50:40Z');
const ELEMENTS = fs.readFileSync('scripts/space-fixture/elements.json', 'utf8');
const SATCAT = fs.readFileSync('scripts/space-fixture/satcat.json', 'utf8');
const RECENT = fs.readFileSync('scripts/space-fixture/recent.json', 'utf8');
const RECENT_SATCAT = fs.readFileSync('scripts/space-fixture/recent-satcat.json', 'utf8');
const GP = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=json',
  SC = 'https://celestrak.org/satcat/records.php?GROUP=visual&FORMAT=json',
  RGP = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=last-30-days&FORMAT=json',
  RSC = 'https://celestrak.org/satcat/records.php?GROUP=last-30-days&FORMAT=json';
const LAUNCH = JSON.stringify([
  {NORAD_CAT_ID: 29505, OBJECT_TYPE: 'PAY', OBJECT_NAME: 'SHIJIAN-6 02A (SJ-6 02A)', OBJECT_ID: '2006-046A'},
  {NORAD_CAT_ID: 29507, OBJECT_TYPE: 'R/B', OBJECT_NAME: 'CZ-4B R/B', OBJECT_ID: '2006-046C'},
]);
// A space-data mirror built from the same fixtures (data contract schema 1),
// plus navigation and geostationary layers.
const MIRROR = 'https://space-data.pages.dev/v1/';
const MirrorOrbit = require('../' + root + 'space-orbit.js'), MirrorCatalog = require('../' + root + 'space-catalog.js');
function mirrorFiles({built = '2026-09-28T17:00:00Z', dataset = '20260928T1700Z', tamper = null} = {}) {
  const read = (f) => JSON.parse(fs.readFileSync('scripts/space-fixture/' + f, 'utf8'));
  const files = {}, groups = {};
  for (const [group, el, sc] of [['visual', 'elements.json', 'satcat.json'], ['last-30-days', 'recent.json', 'recent-satcat.json'],
    ['gnss', 'gnss.json', 'gnss-satcat.json'], ['geo', 'geo.json', 'geo-satcat.json']]) {
    groups[group] = {};
    for (const [kind, f, compact] of [['elements', el, MirrorOrbit.compact], ['satcat', sc, MirrorCatalog.compact]]) {
      const rows = [...new Map(read(f).map(compact).filter(Boolean).map((r) => [r[0], r])).values()],
        file = `${group}/${kind}-1.json`;
      files[`${MIRROR}${dataset}/${file}`] = {schema: 1, kind, rows};
      groups[group][kind] = [{file, rows: rows.length}];
    }
  }
  files[MIRROR + 'index.json'] = {schema: 1, dataset, built, path: dataset + '/', groups};
  if (tamper) tamper(files, dataset);
  return files;
}
const WIKI = JSON.stringify({query: {pages: [{title: 'Long March 4B', extract: 'The Long March 4B is a Chinese launch vehicle.', fullurl: 'https://en.wikipedia.org/wiki/Long_March_4B'}]}});
function rig({saved = {}, error = null, gpStatus = 200, satcatStatus = 200, recentStatus = 200, recentBody = RECENT, recentSatcatBody = RECENT_SATCAT, netError = null, pendingHttp = false, clock = START, launchBody = LAUNCH, elementsBody = ELEMENTS, pendingLocation = false, planScenario = false, orientError = null, pendingOrientation = false, orientationErrors = [], mirror = null, mirrorError = null} = {}) {
  const elements = new Map(), events = {}, timers = [], calls = [], held = [], heldLocation = [], heldOrientation = [], followRetries = [], expiryTimers = new Set();
  const storage = structuredClone(saved);
  let now = clock;
  class Element {
    constructor(tag = 'div') { this.tag = tag; this.hidden = false; this.disabled = false; this.open = false; this.value = ''; this.checked = false; this.textContent = ''; this.className = ''; this.dataset = {}; this.children = []; this.listeners = {}; this.attributes = {}; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    scrollIntoView() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
    addEventListener(type, handler) { this.listeners[type] = handler; }
    getBoundingClientRect() { return {width: 360, height: 360, left: 0, top: 0}; }
    getContext() { return null; }
    click() { if (!this.disabled) this.onclick?.(); }
    get text() { return [this.textContent, ...this.children.map(c => c.text)].join(' '); }
  }
  const el = id => elements.get(id);
  for (const match of fs.readFileSync(root + 'index.html', 'utf8').matchAll(/<([a-z]+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const e = new Element(match[1]); e.hidden = /\bhidden\b/.test(match[0]); elements.set(match[2], e);
  }
  const classes = new Set();
  const Clock = class extends Date { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } };
  const sandbox = {
    document: {getElementById: el, createElement: tag => new Element(tag), body: {classList: {toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)), contains: c => classes.has(c)}}},
    Date: Clock, setInterval: fn => timers.push(fn), setTimeout: (fn, delay) => delay === 0 ? setImmediate(fn) : delay === 100 ? followRetries.push(fn) : (()=>{const t={fn,at:now+delay};expiryTimers.add(t);return t;})(), clearTimeout: t => expiryTimers.delete(t), Math, JSON, Promise, Map, Set, URLSearchParams,
    addEventListener(type, handler) { events[type] = handler; },
    call: async (method, params) => {
      calls.push({method, params: JSON.parse(JSON.stringify(params))});
      if (method === 'storage.kv') {
        if (params.op === 'set') storage[params.key] = JSON.parse(JSON.stringify(params.value));
        return structuredClone(storage[params.key] ?? null);
      }
      if (method === 'orientation.read') {
        if (pendingOrientation && params.op === 'watch') return new Promise(resolve => heldOrientation.push(() => resolve({watching: true, rateHz: 10})));
        const denied = params.op === 'watch' ? orientationErrors.shift() : null;
        if (denied) throw Object.assign(new Error(denied), {code: denied});
        if (orientError) throw Object.assign(new Error(orientError), {code: orientError});
        return params.op === 'watch' ? {watching: true, rateHz: params.rateHz ?? 10} : {watching: false};
      }
      if (method === 'location.read') {
        if (error) throw Object.assign(new Error(error), {code: error});
        const result = {latitude: 52.517834, longitude: 13.388761, accuracyM: 12};
        if (pendingLocation) return new Promise(resolve => heldLocation.push(() => resolve(result)));
        return result;
      }
      if (method === 'net.http') {
        const u = params.url;
        if (netError) throw Object.assign(new Error(netError), {code: netError});
        if (u.startsWith(MIRROR)) {
          if (mirrorError) throw Object.assign(new Error(mirrorError), {code: mirrorError});
          const body = mirror && mirror[u], result = body ? {status: 200, text: JSON.stringify(body)} : {status: 404};
          if (typeof pendingHttp === 'function' && pendingHttp(u)) return new Promise(resolve => held.push(() => resolve(result)));
          return result;
        }
        const result = u === GP ? (gpStatus === 200 ? {status: 200, text: elementsBody} : {status: gpStatus})
          : u === SC ? (satcatStatus === 200 ? {status: 200, text: SATCAT} : {status: satcatStatus})
          : u === RGP ? (recentStatus === 200 ? {status: 200, text: recentBody} : {status: recentStatus})
          : u === RSC ? {status: 200, text: recentSatcatBody}
          : u.includes('INTDES=') ? {status: 200, text: launchBody}
          : u.startsWith('https://en.wikipedia.org/') ? {status: 200, text: WIKI} : {status: 404};
        if (typeof pendingHttp === "function" ? pendingHttp(u) : pendingHttp) return new Promise(resolve => held.push(() => resolve(result)));
        return result;
      }
      throw Object.assign(new Error(method), {code: 'UNSUPPORTED'});
    }};
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  const scripts = ['vendor/satellite.min.js', 'vendor/astronomy.min.js', 'space-stars.js', 'space-orbit.js', 'space-sky.js', 'space-catalog.js', 'space-plan.js', 'space-magnetic.js', 'space-dome.js', 'space-pointer.js', 'app.js'];
  for (const f of scripts) {
    if (f === 'app.js') vm.runInContext('SpaceDome = class extends SpaceDome { constructor(c, cb) { super(c, cb); window.selectObject = cb; } set(s) { window.domeSnapshot = s; window.domeFrames = (window.domeFrames || 0) + 1; } turn(h) { window.domeRotation = h; } }', context);
    vm.runInContext(fs.readFileSync(root + f, 'utf8'), context, {filename: f});
    if (f === 'space-plan.js' && planScenario) vm.runInContext(`SpacePlan.darkRanges = (from,to)=>[[from,to]]; SpacePlan.passes = (o,ob,ranges)=> { const t=${clock} + 12.25*3600000; return o.id===25544 && ranges.some(([a,b])=>a<=t&&t<=b) ? [{startMs:t,endMs:t+120000,maxMs:t+60000,startAz:90,endAz:180,maxAz:135,startEl:10,endEl:10,maxEl:20,startReason:'rises',endReason:'sets'}] : []; };`,context);
    if (f === 'space-plan.js' && planScenario === 'repeated') vm.runInContext(`SpacePlan.passes = (o)=>o.id===25544 ? [60000,600000].map(dt=>({startMs:${clock}+dt,endMs:${clock}+dt+120000,maxMs:${clock}+dt+60000,startAz:90,endAz:180,maxAz:135,startEl:10,endEl:10,maxEl:20,startReason:'rises',endReason:'sets'})) : [];`,context);
  }
  // CelesTrak and Wikipedia requests; the mirror is counted separately.
  const http = () => calls.filter(c => c.method === 'net.http' && !c.params.url.startsWith(MIRROR)).map(c => c.params.url);
  const mirrorHttp = () => calls.filter(c => c.method === 'net.http' && c.params.url.startsWith(MIRROR)).map(c => c.params.url.slice(MIRROR.length));
  return {el, calls, storage, classes, http, mirrorHttp, dome: () => sandbox.domeSnapshot, select: id => sandbox.selectObject(id),
    retryFollow: () => { now += 100; followRetries.splice(0).forEach(f => f()); },
    finishOrientation: () => heldOrientation.splice(0).forEach(f => f()),
    finishLocation: () => heldLocation.splice(0).forEach(f => f()),
    finishHttp: () => held.splice(0).forEach(f => f()),
    tick: (n = 1, ms = 1000) => { for (let i = 0; i < n; i++) { now += ms; timers.forEach(f => f()); } },
    advance: ms => { now += ms; },
    expire: ms => { now += ms; for(const t of [...expiryTimers]) if(t.at <= now) { expiryTimers.delete(t); t.fn(); } },
    visibility: visible => events.constructvisibilitychange({detail: {visible}}),
    orient: detail => events.constructorientation({detail: {timestamp: now, ...detail}}),
    rotation: () => sandbox.domeRotation,
    frames: () => sandbox.domeFrames,
    submit: (lat, lon) => { el('latitude').value = lat; el('longitude').value = lon; el('area-form').onsubmit({preventDefault() {}}); }};
}
const allowedKeys = key => /^(preferences|fetch-state|recent-launches|elements\.(meta|[0-7])|(satcat|recent)\.(meta|[0-3]))$/.test(key);
(async () => {
  // First open: one fix, one download of each CelesTrak list, nothing else.
  let r = rig(); await flush(8);
  assert.equal(r.calls.filter(c => c.method === 'location.read').length, 1);
  assert(r.el('welcome').hidden); assert(!r.el('workspace').hidden);
  assert.match(r.el('place-label').textContent, /^Your location · ±12 m · stays on this phone$/);
  assert.deepEqual(r.http(), [GP, SC, RGP, RSC]);
  assert.match(r.el('counts').textContent, /^[1-9]\d* visible · \d+ above you$/);
  assert.match(r.el('data-status').textContent, /^Orbit data \d+ h old · CelesTrak$/);
  for (const key of Object.keys(r.storage)) assert(allowedKeys(key), key);
  const stored = JSON.stringify(r.storage);
  assert(!/52\.517|13\.388/.test(stored), 'coordinates never reach storage');
  // Select from the accessible list; the spot card speaks in plain words.
  const stage = r.el('list').children.find(b => b.dataset.id === '29507');
  assert(stage, 'Long March 4B stage listed'); assert.match(stage.text, /Long March 4B rocket stage.*E · 1½ fists up · visible/);
  stage.click();
  assert(!r.el('spot').hidden);
  assert.equal(r.el('spot-title').textContent, 'Long March 4B rocket stage');
  assert.equal(r.el('spot-head').textContent, 'EAST · 1½ fists up');
  assert.match(r.el('spot-anchor').textContent, /above Saturn/);
  assert.match(r.el('spot-state').textContent, /^Sunlit · should be visible\. Gets too low to spot in \d:\d\d, in the north\.$/);
  // Details: the same-launch lookup is automatic, Wikipedia only on request.
  r.el('details').click(); await flush(4);
  assert(r.el('info-dialog').open);
  assert.equal(r.http().filter(u => u.includes('wikipedia')).length, 0);
  assert.equal(r.http().at(-1), 'https://celestrak.org/satcat/records.php?INTDES=2006-046&FORMAT=json');
  assert.match(r.el('info-body').text, /Carried: SHIJIAN-6 02A/);
  assert.match(r.el('info-body').text, /NORAD 29507 · 2006-046C/);
  await r.el('wiki').onclick(); await flush();
  assert.match(r.http().at(-1), /^https:\/\/en\.wikipedia\.org\/w\/api\.php\?.*&titles=Long%20March%204B$/);
  assert.match(r.el('info-body').text, /Chinese launch vehicle.*CC BY-SA 4\.0/);
  for (const u of r.http()) assert(!/52\.5|13\.3/.test(u), 'coordinates never leave the phone: ' + u);
  r.el('close-info').click(); assert(!r.el('info-dialog').open);
  // Rewind and back.
  r.el('rewind').value = '-120'; r.el('rewind').oninput();
  assert.equal(r.el('rewind-label').textContent, '2 min ago'); assert(!r.el('now').hidden);
  assert.equal(r.el('spot-when').textContent, '2 min ago:'); assert.equal(r.el('list-title').textContent, 'Overhead 2 min ago');
  r.el('now').click(); assert.equal(r.el('rewind-label').textContent, 'Now'); assert(r.el('now').hidden);
  // Red mode is remembered with the start choice only.
  r.el('red').click(); await flush();
  assert(r.classes.has('red')); assert.equal(r.el('red').attributes['aria-pressed'], 'true');
  assert.deepEqual(r.storage.preferences, {startWithLocation: true, red: true, layers: {gnss: false, geo: false}});

  // Reopen within hours: cached orbits and catalog, no download.
  const saved = r.storage;
  r = rig({saved, clock: START + HOUR}); await flush(8);
  assert.deepEqual(r.http(), []); assert(r.classes.has('red'));
  assert.match(r.el('counts').textContent, /visible · \d+ above you$/);
  // After the 8-hour freshness window the next minute tick downloads again.
  r.advance(8 * HOUR); r.tick(60); await flush(8);
  assert.deepEqual(r.http(), [GP, RGP, RSC]);
  // A manual refresh inside two hours explains instead of re-downloading.
  r.el('refresh').click(); await flush();
  assert.equal(r.http().length, 3); assert.match(r.el('data-status').textContent, /nothing newer yet/);

  // Refresh must invalidate name-derived descriptions even with a fresh SATCAT.
  const renamed = JSON.parse(ELEMENTS);
  renamed.find(o => o.NORAD_CAT_ID === 29507).OBJECT_NAME = 'CZ-4C R/B';
  const aged = structuredClone(saved), oldDownload = START - 3 * HOUR;
  aged['elements.meta'].at = oldDownload;
  for (const [key, value] of Object.entries(aged))
    if (/^elements\.\d$/.test(key) && value) value.g = oldDownload;
  r = rig({saved: aged, elementsBody: JSON.stringify(renamed)}); await flush(8);
  r.select(29507);
  assert.equal(r.el('spot-title').textContent, 'Long March 4B rocket stage');
  r.el('refresh').click(); await flush(8);
  assert.deepEqual(r.http(), ['https://celestrak.org/NORAD/elements/gp.php?GROUP=visual&FORMAT=json']);
  assert.equal(r.el('spot-title').textContent, 'Long March 4C rocket stage');
  assert.match(r.el('list').children.find(b => b.dataset.id === '29507').text, /Long March 4C rocket stage/);
  r.el('details').click(); await flush(4);
  await r.el('wiki').onclick(); await flush(4);
  assert.match(r.http().at(-1), /titles=Long%20March%204C$/);

  // A torn cache (chunk from another generation) is ignored, not half-used.
  const torn = structuredClone(saved); torn['elements.0'].g = 1;
  r = rig({saved: torn, clock: START + HOUR}); await flush(8);
  assert.equal(r.http().filter(u => u === GP).length, 1);

  // Corrupt numeric epochs must invalidate the cache, not abort startup.
  const corrupt = structuredClone(saved); corrupt['elements.0'].r[0][3] = 1e100;
  r = rig({saved: corrupt, clock: START + HOUR}); await flush(8);
  assert(!r.el('workspace').hidden, 'bad cached epoch must not strand startup');
  assert.equal(r.http().filter(u => u === GP).length, 1);

  // The same launch can contain several selectable payloads. Each excludes itself.
  const launchPair = JSON.stringify([
    {NORAD_CAT_ID: 25544, OBJECT_TYPE: 'PAY', OBJECT_NAME: 'FIRST', OBJECT_ID: '1998-067A'},
    {NORAD_CAT_ID: 48274, OBJECT_TYPE: 'PAY', OBJECT_NAME: 'SECOND', OBJECT_ID: '1998-067B'},
  ]);
  const paired = structuredClone(saved);
  for (const key of Object.keys(paired)) if (/^elements\.\d$/.test(key) && paired[key])
    for (const row of paired[key].r) if (row[0] === 48274) row[2] = '1998-067B';
  r = rig({saved: paired, launchBody: launchPair}); await flush(8);
  // Select via the real dome callback even when the other payload is below horizon.
  r.select(25544); r.el('details').click(); await flush(4);
  assert.match(r.el('info-body').text, /Launched with: SECOND/);
  r.el('close-info').click(); r.select(48274); r.el('details').click(); await flush(4);
  assert.match(r.el('info-body').text, /Launched with: FIRST/);
  assert.doesNotMatch(r.el('info-body').text, /Launched with: SECOND/);

  // Empty/malformed catalog replies are unavailable, never a cached no-siblings verdict.
  for (const launchBody of ['[]', '{"error":"unavailable"}', '[{"broken":true}]']) {
    r = rig({saved, launchBody}); await flush(8);
    r.select(29507); r.el('details').click(); await flush(4);
    assert.match(r.el('info-body').text, /Launch details unavailable right now/);
    assert.doesNotMatch(r.el('info-body').text, /Nothing else is catalogued/);
    r.el('close-info').click(); r.el('details').click(); await flush(4);
    assert.equal(r.http().filter(u => u.includes('INTDES=')).length, 2, 'invalid reply must not poison the session cache');
  }
  // A valid catalog containing only this object does establish no other entries.
  r = rig({saved, launchBody: JSON.stringify([JSON.parse(LAUNCH)[1]])}); await flush(8);
  r.select(29507); r.el('details').click(); await flush(4);
  assert.match(r.el('info-body').text, /Nothing else is catalogued/);
  r.el('close-info').click(); r.el('details').click(); await flush(4);
  assert.equal(r.http().filter(u => u.includes('INTDES=')).length, 1);

  // Closing and reopening the same object creates a new lookup view.
  r = rig({saved, pendingHttp: u => u.includes('wikipedia')}); await flush(8);
  r.select(29507); r.el('details').click(); await flush(4);
  const oldWiki = r.el('wiki').onclick();
  r.el('close-info').click(); r.el('details').click(); await flush(4);
  r.finishHttp(); await oldWiki; await flush(4);
  assert.equal(r.el('wiki').textContent, 'Read on Wikipedia', 'old lookup must not mark new view loaded');
  const newWiki = r.el('wiki').onclick(); r.finishHttp(); await newWiki;
  assert.match(r.el('info-body').text, /Chinese launch vehicle/);

  // Grant denial never contacted CelesTrak: reopening after grant must download now.
  r = rig({netError: 'CAPABILITY_DENIED'}); await flush(8);
  assert.match(r.el('data-status').textContent, /Enable the requested capability/);
  const deniedState = r.storage;
  r = rig({saved: deniedState, clock: START + 1000}); await flush(8);
  assert.equal(r.http().filter(u => u === GP).length, 1, 'grant change must not wait 15 minutes');
  assert.match(r.el('counts').textContent, /visible/);

  // Catalog throttling uses the two-hour provider backoff too.
  for (const status of [403, 429]) {
    r = rig({satcatStatus: status}); await flush(8);
    r.advance(16 * 60000); r.tick(60); await flush(8);
    assert.equal(r.http().filter(u => u === SC).length, 1, 'catalog provider backoff');
    r.advance(2 * HOUR); r.tick(60); await flush(8);
    assert.equal(r.http().filter(u => u === SC).length, 2);
  }

  // CelesTrak failure: a clear message, a remembered back-off, no hammering.
  r = rig({gpStatus: 503}); await flush(8);
  assert.match(r.el('data-status').textContent, /CelesTrak orbit data unavailable \(HTTP 503\)/);
  assert.equal(r.el('data-status').className, 'attention');
  assert.equal(r.storage['fetch-state'].until, START + 15 * 60000);
  r.tick(60); await flush();
  assert.equal(r.http().filter(u => u === GP).length, 1, 'no retry inside 15 minutes');
  r.tick(15 * 60); await flush(8);
  assert.equal(r.http().filter(u => u === GP).length, 2);

  // No location grant: a quiet fallback to typed coordinates, never stored.
  for (const code of ['CAPABILITY_DENIED', 'LOCATION_PERMISSION', 'LOCATION_TIMEOUT']) {
    r = rig({error: code}); await flush(4);
    assert(!r.el('welcome').hidden); assert(r.el('workspace').hidden);
    assert.equal(r.el('retry-location').hidden, code === 'LOCATION_PERMISSION' || code === 'CAPABILITY_DENIED');
  }
  r.el('start').click(); assert(r.el('area-dialog').open);
  r.submit('95', '13'); assert(r.el('area-dialog').open); assert.match(r.el('area-status').textContent, /latitude from −90 to 90/);
  r.submit('52,5178', '−13,3887'); await flush(8);
  assert(!r.el('area-dialog').open); assert(!r.el('workspace').hidden);
  assert.equal(r.el('place-label').textContent, '52.52° N, 13.39° W');
  assert(!/52\.517|13\.388/.test(JSON.stringify(r.storage)));
  r = rig({saved: {preferences: {startWithLocation: false, red: false}}}); await flush(4);
  assert.equal(r.calls.filter(c => c.method === 'location.read').length, 0);
  assert.equal(r.el('welcome-title').textContent, 'Where are you watching from?');

  // A menu interruption of the *catalog* must not impose a 15-minute penalty.
  r = rig({pendingHttp: u => u.includes('/satcat/')}); await flush(8);
  assert.equal(r.http().filter(u => u.includes('/satcat/')).length, 1);
  r.visibility(false); r.finishHttp(); await flush(4);
  r.visibility(true); await flush(4);
  assert.equal(r.http().filter(u => u.includes('/satcat/')).length, 2, 'interrupted catalog retries on resume');
  r.finishHttp(); await flush(8);

  // Platform Back/Escape must cancel an in-flight manual location request too.
  r = rig({saved: {preferences: {startWithLocation: false}}, pendingLocation: true}); await flush(4);
  r.el('start').click(); r.el('use-location').click();
  r.el('area-dialog').listeners.cancel?.(); r.el('area-dialog').close();
  r.finishLocation(); await flush(8);
  assert(r.el('workspace').hidden, 'cancelled dialog location must not set a viewpoint');
  assert.equal(r.http().length, 0);

  // A download interrupted by the native menu is dropped and retried on return.
  r = rig({pendingHttp: true}); await flush(4);
  assert.equal(r.http().length, 1);
  r.visibility(false); assert.match(r.el('status').textContent, /Paused/);
  r.finishHttp(); await flush(4);
  assert.equal(r.storage['elements.meta'], undefined, 'no data applied from a paused request');
  r.visibility(true); await flush(2); r.finishHttp(); await flush(8);
  assert.equal(r.http().filter(u => u === GP).length, 2);
  assert.equal(r.el('status').textContent, '');
  assert.match(r.el('counts').textContent, /visible/);

  // Visible passes: worked out in slices, soonest first; the ISS pass is on now.
  r = rig(); await flush(8); r.tick(1); await flush();
  assert.equal(r.el('plan-status').textContent, 'Tap one to preview it on the dome.');
  const planned = r.el('plan-list').children;
  assert(planned.length >= 5 && planned.length <= 10);
  assert.match(planned.find(b => b.dataset.id === '25544').text, /^ Now · ISS \(Zarya\) WSW → SSW · highest 1½ fists up in the SW · [34] min already visible WSW, sets 1 fist up in the SSW$/);
  // Trains come from the last-30-days list and can be planned like anything else.
  const guowang = planned.find(b => b.dataset.id === 'train:2026-221');
  assert(guowang, 'Guowang train pass planned'); assert.match(guowang.text, /^ [\d:]+( [AP]M)? · Guowang train /);
  guowang.click();
  assert.match(r.el('rewind-label').textContent, /^Preview /); assert(!r.el('now').hidden);
  assert.equal(r.el('spot-title').textContent, 'Guowang train');
  // The merged pass opens with its first visible member; a little later the
  // rest of the line is up too, and every drawn bead meets the conditions.
  r.tick(150);
  const beads = r.dome().objects.find(o=>o.id==='train:2026-221').members;
  assert(beads.length > 0);
  assert(beads.every(m=>m.el>=10 && m.sunlit), 'train beads must each meet visibility conditions');
  assert.equal(r.el('spot-kind').textContent, '9 satellites in a line · launched 5 days ago');
  assert.match(r.el('spot-when').textContent, /^At /);
  assert.match(r.el('spot-state').textContent, /A line of 9 satellites; early orbits are rough/);
  assert.match(r.el('list-title').textContent, /^Overhead at /);
  r.el('details').click(); await flush(4);
  assert.match(r.el('info-body').text, /9 of 11 from this launch/); assert.match(r.el('info-body').text, /2026-09-23 · 5 days ago/);
  const before = r.http().length;
  await r.el('wiki').onclick(); await flush(4);
  assert.equal(r.http().length, before + 1); assert.match(r.http().at(-1), /&titles=Guowang$/);
  r.el('close-info').click();
  r.el('now').click(); assert.equal(r.el('rewind-label').textContent, 'Now'); assert.equal(r.el('list-title').textContent, 'Overhead now');
  const trainButton = () => r.el('plan-list').children.find(b => b.dataset.id === 'train:2026-221');
  assert.equal(trainButton().attributes['aria-pressed'], 'false', 'Back to now clears preview selection immediately');
  trainButton().click(); assert.equal(trainButton().attributes['aria-pressed'], 'true');
  r.el('rewind').value = '-120'; r.el('rewind').oninput();
  assert.equal(trainButton().attributes['aria-pressed'], 'false', 'rewind clears preview selection immediately');
  r.el('now').click();
  for (const key of Object.keys(r.storage)) assert(allowedKeys(key), key);
  assert(r.storage['recent.meta'] && r.storage['recent-launches'].d.length === 2);
  // Reopen: trains come from the cache, no download.
  const withTrains = r.storage;
  r = rig({saved: withTrains, clock: START + 10 * 60000}); await flush(8); r.tick(1); await flush();
  assert.deepEqual(r.http(), []);
  assert(r.el('plan-list').children.some(b => b.dataset.id === 'train:2026-221'));
  r.el('plan-list').children.find(b => b.dataset.id === 'train:2026-221').click();
  r.el('details').click(); await flush(4);
  assert.match(r.el('info-body').text, /9 of 11 from this launch/, 'cache preserves original batch size');
  // Bad optional responses must preserve the prior cache and observe backoff.
  for (const bad of ['{"error":"notice"}', '[{"broken":true}]', 'not json', 'partial', 'missing-designator', 'bad-designator']) {
    for (const field of ['recentBody', 'recentSatcatBody']) {
      let body = bad === 'partial' ? JSON.stringify([JSON.parse(field === 'recentBody' ? RECENT : RECENT_SATCAT)[0], {broken:true}]) : bad;
      if (bad.endsWith('-designator')) body = JSON.stringify(JSON.parse(field === 'recentBody' ? RECENT : RECENT_SATCAT).map(o => ({...o, OBJECT_ID: bad === 'missing-designator' ? undefined : 'invalid'})));
      r = rig({saved: withTrains, clock: START + 9 * HOUR, [field]: body}); await flush(10);
      assert.equal(r.storage['recent.meta'].at, withTrains['recent.meta'].at);
      assert.equal(r.storage['fetch-state'].recentUntil, START + 11 * HOUR);
      assert.match(r.el('data-status').textContent, /^Orbit data .+ old · CelesTrak$/);
    }
  }
  // A pass must become Now at its actual start, not the next minute tick.
  {
    const O = require('../' + root + 'space-orbit.js'), K = require('../' + root + 'space-sky.js'), P = require('../' + root + 'space-plan.js');
    const ob = O.observer(52.517834, 13.388761, 0), aob = K.observer(52.517834, 13.388761, 0);
    const sun = t => K.sun(t, aob).el, ranges = P.darkRanges(START, START + 12 * HOUR, sun);
    r = rig(); await flush(8); r.tick(1, 0);
    const listed = new Set(r.el('plan-list').children.map(b => b.dataset.id));
    const pass = O.build(O.parseElements(ELEMENTS)).flatMap(o => P.passes(o, ob, ranges, sun).map(p => ({...p, id: String(o.id)})))
      .find(p => listed.has(p.id) && p.startMs > START + 60000 && p.startMs < START + 20 * 60000 && p.startMs % 60000 > 1000 && p.startMs % 60000 < 59000);
    assert(pass, 'fixture has a scheduled pass beginning inside a minute');
    r.advance(pass.startMs - START - 1000); r.tick(1, 0);
    const button = () => r.el('plan-list').children.find(b => b.dataset.id === pass.id);
    assert(!button().text.includes('Now ·'));
    r.tick(1, 2000);
    assert(button().text.includes('Now ·'), 'pass switches to Now immediately at start');
  }
  // Two passes of one object must not both announce themselves as selected.
  r=rig({planScenario:'repeated',recentBody:'[]'});await flush(8);r.tick(1,0);
  const repeated=()=>r.el('plan-list').children;
  assert.equal(repeated().length,2);
  repeated()[1].click();
  assert.deepEqual(repeated().map(b=>b.attributes['aria-pressed']),['false','true']);
  repeated()[0].click();
  assert.deepEqual(repeated().map(b=>b.attributes['aria-pressed']),['true','false']);
  r.el('now').click();assert(repeated().every(b=>b.attributes['aria-pressed']==='false'));
  // A cached plan must include passes entering the rolling 12-hour window.
  r = rig({planScenario: true, recentBody: '[]'}); await flush(8); r.tick(1,0);
  assert.equal(r.el('plan-list').children.length,0, '12h15m pass is initially outside displayed horizon');
  r.advance(29*60000); r.tick(1,0);
  assert(r.el('plan-list').children.some(b=>b.dataset.id==='25544'), 'buffered pass enters horizon before 30-minute refresh');
  // Recent orbit/SATCAT feeds can be temporarily out of sync. Launch dates
  // are immutable metadata: incomplete coverage must not erase a known date.
  for(const omitBatch of [false,true]) {
    let rows=JSON.parse(RECENT_SATCAT);
    rows=omitBatch?rows.filter(o=>!o.OBJECT_ID.startsWith('2026-221')):rows.map(o=>({...o,LAUNCH_DATE:undefined}));
    r=rig({saved:withTrains,clock:START+9*HOUR,recentSatcatBody:JSON.stringify(rows)});await flush(10);
    assert.equal(r.storage['recent-launches'].d.find(([id])=>id==='2026-221')?.[1],'2026-09-23','prior launch date survives missing provider coverage');
  }
  // Recent provider feeds may exceed the ordinary 400-object visual catalog.
  // Qualifying batches and launch dates after an unrelated prefix still count.
  {
    const prefix = Array.from({length:401},(_,i)=>({...JSON.parse(RECENT)[0],NORAD_CAT_ID:800000+i,OBJECT_NAME:'WEATHER-'+i,OBJECT_ID:'2025-001A'}));
    const catPrefix = prefix.map(o=>({NORAD_CAT_ID:o.NORAD_CAT_ID,OBJECT_ID:o.OBJECT_ID,OBJECT_NAME:o.OBJECT_NAME,LAUNCH_DATE:'2025-01-01'}));
    r = rig({recentBody:JSON.stringify([...prefix,...JSON.parse(RECENT)]),recentSatcatBody:JSON.stringify([...catPrefix,...JSON.parse(RECENT_SATCAT)])});
    await flush(8);r.tick(1,0);
    const train=r.el('plan-list').children.find(b=>b.dataset.id==='train:2026-221');
    assert(train,'recent train beyond first 400 provider rows must remain discoverable');
    train.click();r.el('details').click();await flush(4);
    assert.match(r.el('info-body').text,/9 of 11 from this launch/);
    assert.match(r.el('info-body').text,/2026-09-23 · 5 days ago/,'launch date beyond first 400 SATCAT rows retained');
  }
  // The Guowang centre is still low at 18:24, but another member is visible.
  // Group count/list/dome and selected pointing must agree with that member.
  r=rig({clock:Date.parse('2026-09-28T18:24:00Z')});await flush(8);r.tick(1,0);
  assert.equal(r.dome().objects.find(o=>o.id==='train:2026-221')?.state,'visible','visible member makes the grouped train visible');
  const earlyTrain=r.el('list').children.find(b=>b.dataset.id==='train:2026-221');
  assert.match(earlyTrain.text,/visible/);earlyTrain.click();assert.match(r.el('spot-state').textContent,/Sunlit · should be visible/);
  // The planner must agree: the train's pass is current, starting from the member
  // that is already visible, not from the centre's later rise (#49 review).
  const trainPass = r.el('plan-list').children.find(b => b.dataset.id === 'train:2026-221');
  assert.match(trainPass.text, /^ Now · Guowang train /, 'member-visible train must have a current pass');
  assert.equal(r.el('plan-list').children.filter(b => b.dataset.id === 'train:2026-221').length, 1, 'members merge into one train pass');
  // Train details search all members, not the currently highest representative.
  r=rig({clock:Date.parse('2026-09-28T16:50:00Z')});await flush(8);r.tick(1,0);
  r.select('train:2026-221');await flush(15);
  assert.match(r.el('spot-anchor').textContent,/06:20 PM/, 'grouped spot card uses the earliest member rise');
  r.el('details').click();await flush(15);
  assert.match(r.el('info-body').text,/06:20 PM/, 'details must use the earliest member rise, not the 18:28 representative');
  r=rig({clock:Date.parse('2026-09-28T16:50:00Z')});await flush(8);r.tick(1,0);
  r.select('train:2026-221');r.el('details').click();const closedBody=r.el('info-body').text;r.el('close-info').click();await flush(15);
  assert.equal(r.el('info-body').text,closedBody,'closed details discard pending member scan');
  r=rig({clock:Date.parse('2026-09-28T16:50:00Z')});await flush(8);r.tick(1,0);
  r.select('train:2026-221');r.select(29507);const otherAnchor=r.el('spot-anchor').textContent;await flush(15);
  assert.equal(r.el('spot-anchor').textContent,otherAnchor,'old train lookup cannot overwrite a new selection');
  // A genuinely empty recent list is valid and remains fresh across reopen.
  r = rig({recentBody: '[]'}); await flush(8);
  r = rig({saved: r.storage, clock: START + HOUR}); await flush(8);
  assert.deepEqual(r.http(), [], 'valid empty recent data should not refetch on every reopen');
  // Trains are optional: a failing recent list leaves the sky and its message alone.
  r = rig({recentStatus: 503}); await flush(8);
  assert.deepEqual(r.http(), [GP, SC, RGP]);
  assert.match(r.el('data-status').textContent, /^Orbit data \d+ h old · CelesTrak$/);
  assert.equal(r.storage['fetch-state'].recentLast, START);

  // Follow mode: the dome turns with the phone, true north from WMM2025.
  r = rig(); await flush(8);
  assert.equal(r.el('follow').attributes['aria-pressed'], undefined);
  await r.el('follow').onclick(); await flush();
  assert.deepEqual(r.calls.filter(c => c.method === 'orientation.read').map(c => c.params), [{op: 'watch', rateHz: 10}]);
  assert.equal(r.el('follow').attributes['aria-pressed'], 'true'); assert(!r.el('follow-status').hidden);
  assert.match(r.el('follow-status').textContent, /^Hold the phone flat for the dome, or raise it like a camera to point\.$/);
  // Raised like a camera, the pointing view replaces the dome, which does not turn.
  r.orient({pose: 'upright', azimuthDeg: 200, pitchDeg: 5, rollDeg: 0, calibrate: false, accuracyDeg: 12});
  assert.equal(r.rotation() ?? 0, 0); assert.equal(r.el('follow-status').textContent, 'Pointing south-west, below the horizon · compass ±12°');
  assert(!r.el('pointer-wrap').hidden); assert(r.el('dome').hidden); assert(r.el('scrub').hidden);
  // Upright but aimed at the ground: neither view is live.
  r.orient({pose: 'upright', azimuthDeg: 200, pitchDeg: 40, rollDeg: 0, calibrate: false, accuracyDeg: 12});
  assert(r.el('pointer-wrap').hidden); assert(!r.el('dome').hidden);
  assert.equal(r.el('follow-status').textContent, 'Raise the phone like a camera to point, or hold it flat for the dome.');
  // Flat, magnetic 220°: Berlin's ~5° east declination makes it ~225° true (SW).
  r.orient({pose: 'flat', azimuthDeg: 220, pitchDeg: 88, rollDeg: 0, calibrate: false, accuracyDeg: 12, headingRef: 'magnetic'});
  const dec = r.rotation() - 220;
  assert(dec > 4.5 && dec < 6, String(dec));
  assert.equal(r.el('follow-status').textContent, 'Facing south-west · compass ±12°');
  assert.equal(r.dome().follow, true);
  // Smoothing: a jump moves a quarter of the way, the short way across north.
  r.orient({pose: 'flat', azimuthDeg: 220 + 40, pitchDeg: 88, rollDeg: 0, calibrate: false, accuracyDeg: 12});
  assert(Math.abs(r.rotation() - (220 + dec + 10)) < 0.01);
  // Guidance for the selected object, relative to where you face.
  const iss = r.el('list').children.find(b => b.dataset.id === '25544'); iss.click();
  assert(!r.el('spot-turn').hidden); assert.match(r.el('spot-turn').textContent, /^(Ahead of you(, slightly (left|right))?\.|Turn (left|right) about \d+°\.|Behind you: turn around\.)$/);
  for (let i = 0; i < 40; i++) r.orient({pose: 'flat', azimuthDeg: 230 - dec, pitchDeg: 88, rollDeg: 0, calibrate: false, accuracyDeg: 12});
  assert.match(r.el('spot-turn').textContent, /^Ahead of you/, 'ISS is SW-ish and we face it');
  for (let i = 0; i < 60; i++) r.orient({pose: 'flat', azimuthDeg: 50 - dec, pitchDeg: 88, rollDeg: 0, calibrate: false, accuracyDeg: 12});
  assert.equal(r.el('spot-turn').textContent, 'Behind you: turn around.');
  // Unreliable readings must not retain stale heading or turn guidance.
  const kept = r.rotation();
  r.orient({pose: 'flat', pitchDeg: 88, rollDeg: 0, calibrate: true});
  assert.equal(r.rotation(), 0); assert(r.el('spot-turn').hidden); assert.equal(r.dome().follow, false); assert.match(r.el('follow-status').textContent, /figure 8/); assert.equal(r.el('follow-status').className, 'attention');
  // Pause: the host stops the stream; on return Space Watch asks again.
  r.visibility(false); r.visibility(true); await flush();
  assert.equal(r.calls.filter(c => c.method === 'orientation.read' && c.params.op === 'watch').length, 2);
  // The host ends the stream on an activity pause: Follow turns off and says so.
  r.orient({watching: false, reason: 'paused'});
  assert.equal(r.el('follow').attributes['aria-pressed'], 'false'); assert.equal(r.rotation(), 0);
  assert.match(r.el('follow-status').textContent, /lost the foreground/); assert(!r.el('follow-status').hidden);
  assert(r.el('spot-turn').hidden);
  r.visibility(false); r.visibility(true); await flush();
  assert.equal(r.calls.filter(c => c.method === 'orientation.read' && c.params.op === 'watch').length, 2, 'no silent re-watch after a host end');
  await r.el('follow').onclick(); await flush();
  assert.equal(r.el('follow').attributes['aria-pressed'], 'true');
  r.orient({pose: 'flat', azimuthDeg: 100, pitchDeg: 88, rollDeg: 0, calibrate: false, accuracyDeg: 12});
  r.orient({watching: false, reason: 'revoked'});
  assert.match(r.el('follow-status').textContent, /turned off in Module access/);
  await r.el('follow').onclick(); await flush();
  // Off: stop, north up again, no guidance.
  r.el('follow').onclick(); await flush();
  assert.equal(r.calls.at(-1).params.op, 'stop'); assert.equal(r.rotation(), 0);
  assert.equal(r.el('follow').attributes['aria-pressed'], 'false'); assert(r.el('spot-turn').hidden);
  assert(!/52\.517|13\.388/.test(JSON.stringify(r.storage)), 'no coordinates or headings stored');
  assert(!Object.keys(r.storage).some(k => /follow|orient|heading/.test(k)));
  // Not granted, or no compass: a clear note, the static dome keeps working.
  r = rig({orientError: 'CAPABILITY_DENIED'}); await flush(8);
  await r.el('follow').onclick(); await flush();
  assert.equal(r.el('follow').attributes['aria-pressed'], 'false');
  assert.match(r.el('follow-status').textContent, /Allow reading compass and tilt/); assert(!r.el('follow-status').hidden);
  r = rig({orientError: 'ORIENTATION_UNAVAILABLE'}); await flush(8);
  await r.el('follow').onclick(); await flush();
  assert.match(r.el('follow-status').textContent, /no compass/);
  // A terminal event can overtake the watch reply. It must cancel pending Follow.
  r = rig({pendingOrientation: true}); await flush(8);
  const starting = r.el('follow').onclick();
  r.orient({watching: false, reason: 'paused'});
  r.finishOrientation(); await starting; await flush();
  assert.equal(r.el('follow').attributes['aria-pressed'], 'false');
  assert.match(r.el('follow-status').textContent, /lost the foreground/);
  r.visibility(false); r.visibility(true); await flush();
  assert.equal(r.calls.filter(c => c.method === 'orientation.read' && c.params.op === 'watch').length, 1);
  // Menu pause invalidates an in-flight acknowledgement, but preserves explicit intent.
  r = rig({pendingOrientation: true}); await flush(8);
  const pausedStart = r.el('follow').onclick(); r.visibility(false);
  r.finishOrientation(); await pausedStart;
  assert.notEqual(r.el('follow').attributes['aria-pressed'], 'true');
  r.visibility(true); r.finishOrientation(); await flush();
  assert.equal(r.el('follow').attributes['aria-pressed'], 'true');
  // Upright pose and stale streams never retain live directional instructions.
  r = rig(); await flush(8); await r.el('follow').onclick();
  r.select(25544);
  const sample = {pose:'flat', azimuthDeg:90, accuracyDeg:12, calibrate:false};
  r.orient(sample); assert(!r.el('spot-turn').hidden);
  const flatRotation = r.rotation();
  r.orient({...sample, pose:'upright'}); assert(r.el('spot-turn').hidden);
  assert.equal(r.rotation(), flatRotation, 'upright suspends guidance without spinning the chart');
  assert.equal(r.dome().follow, false);
  r.orient(sample); r.tick(2); assert(r.el('spot-turn').hidden); assert.equal(r.dome().follow, false);
  r.orient(sample); assert(!r.el('spot-turn').hidden);
  // A resumed sensor event can precede the frame timer after a WebView stall.
  r.orient({...sample, azimuthDeg:0});
  r.advance(1600); // Deliberately do not invoke the periodic frame callback.
  r.orient({...sample, azimuthDeg:180});
  assert(Math.abs(r.rotation() - (flatRotation + 90)) < 0.01, 'first reading after gap resets obsolete smoothing');
  // A true-coordinate sky cannot be rotated by uncorrected magnetic headings.
  r.submit(90, 0); r.orient(sample);
  assert.equal(r.rotation(), 0); assert.equal(r.dome().follow, false);
  assert(r.el('spot-turn').hidden); assert.match(r.el('follow-status').textContent, /True-north correction unavailable/);
  const pausedFrames = r.frames();
  for (let i=0;i<10;i++) r.orient(sample);
  assert.equal(r.frames(), pausedFrames, 'unavailable correction does not recompute sky at sensor rate');
  // Measurement time, not handler time, bounds a heading's usable age.
  r = rig(); await flush(8); await r.el('follow').onclick();r.select(25544);
  r.orient(sample);r.advance(2000);
  r.orient({...sample,timestamp:START});
  assert.equal(r.rotation(),0,'queued stale sample must not rotate sky');
  assert(r.el('spot-turn').hidden);assert.equal(r.dome().follow,false);
  for(const timestamp of [undefined, NaN, START+3000]) {
    r.orient({...sample,timestamp});assert.equal(r.rotation(),0,'invalid/future measurement time rejected');
  }
  r.orient({...sample,timestamp:START+1000});assert(!r.el('spot-turn').hidden);
  r.tick(1,600);assert(r.el('spot-turn').hidden,'expiry uses measurement time');
  r.submit(85,130);r.orient(sample);
  assert.equal(r.rotation(),0);assert(r.el('spot-turn').hidden,'magnetic blackout has no guidance');
  // Silence expiry does not depend on the next one-second sky frame.
  r=rig();await flush(8);await r.el('follow').onclick();r.select(25544);r.orient(sample);
  r.expire(1500);assert(!r.el('spot-turn').hidden);
  r.expire(1);assert(r.el('spot-turn').hidden,'deadline timer clears silence without frame tick');
  r.orient(sample);r.expire(1000);r.orient({...sample,azimuthDeg:0});
  r.expire(501);assert(!r.el('spot-turn').hidden,'old expiry must not clear new sample');
  r.expire(1000);assert(r.el('spot-turn').hidden);
  // Pointing: raised like a camera, the phone is guided to the selected object.
  r = rig(); await flush(8); await r.el('follow').onclick();
  r.orient({pose: 'flat', azimuthDeg: 0, pitchDeg: 88, rollDeg: 0, calibrate: false, accuracyDeg: 8});
  const decl = r.rotation(); assert(decl > 4.5 && decl < 6);
  const point = (az, el, roll = 0, n = 25) => { for (let i = 0; i < n; i++) r.orient(hostSample(az, el, roll, {declination: decl})); };
  // Nothing selected: name what sits in the middle, from the same sky as the dome.
  const saturn = r.dome().bodies.find(b => b.label === 'Saturn');
  point(saturn.az, saturn.el);
  assert(!r.el('pointer-wrap').hidden);
  assert.equal(r.el('point-guide').textContent, 'In the middle: Saturn. Tap a satellite in the list to be guided to it.');
  assert.equal(r.el('follow-announcement').textContent, r.el('point-guide').textContent);
  r.el('list').children.find(b => b.dataset.id === '25544').click();
  const issNow = r.dome().objects.find(o => o.id === 25544);
  point(issNow.az, issNow.el);
  assert.equal(r.el('point-guide').textContent, 'On target. Look past the top of the phone.');
  assert.equal(r.el('point-guide').className, 'locked'); assert.equal(r.el('follow-announcement').textContent, 'On target.');
  r.orient({...hostSample(issNow.az, issNow.el, 0, {declination: decl}), calibrate: true});
  assert.match(r.el('follow-announcement').textContent, /figure 8/);
  point(issNow.az, issNow.el, 0, 1);
  assert.equal(r.el('follow-announcement').textContent, 'On target.', 'calibration recovery restores unchanged guidance');
  assert(r.el('spot-turn').hidden, 'the viewfinder gives the guidance');
  assert.match(r.el('follow-status').textContent, /^Pointing (north|south|east|west|north-east|north-west|south-east|south-west), .* · compass ±8°$/);
  point(issNow.az - 20, issNow.el);
  assert.match(r.el('point-guide').textContent, /^Move the phone 2 fists (up and )?to the right\.$/);
  assert.equal(r.el('point-guide').className, '');
  const announced = r.el('follow-announcement').textContent;
  assert.match(announced, /^Move the phone (up and )?to the right\.$/, 'announced once per way, without a distance that goes stale');
  point(issNow.az - 25, issNow.el);
  assert.match(r.el('point-guide').textContent, /^Move the phone 2½ fists/);
  assert.equal(r.el('follow-announcement').textContent, announced, 'no re-announcement for a few degrees');
  point(issNow.az + 180, Math.max(0, issNow.el - 5));
  assert.match(r.el('point-guide').textContent, /^Turn around: it is behind you/);
  // High in the sky the host reports the flat pose; pointing continues.
  const high = hostSample(issNow.az, 70, 0, {declination: decl}); assert.equal(high.pose, 'flat');
  point(issNow.az, 70);
  assert(!r.el('pointer-wrap').hidden); assert.match(r.el('point-guide').textContent, /^Move the phone \d½? fists down\.$/);
  assert.match(r.el('follow-status').textContent, /^Pointing .*, 7 fists up/);
  // A calibration request keeps the view but drops the aim.
  r.orient({...hostSample(issNow.az, issNow.el), azimuthDeg: undefined, calibrate: true});
  assert.equal(r.el('point-guide').textContent, 'Waiting for the compass…'); assert.match(r.el('follow-status').textContent, /figure 8/);
  // Raising the phone leaves rewind: pointing is about the sky now.
  r.orient({pose: 'flat', azimuthDeg: 0, pitchDeg: 88, rollDeg: 0, calibrate: false, accuracyDeg: 8});
  assert(r.el('pointer-wrap').hidden); assert(!r.el('dome').hidden); assert(!r.el('scrub').hidden);
  r.el('rewind').value = '-120'; r.el('rewind').oninput(); assert(!r.el('now').hidden);
  point(issNow.az, issNow.el, 0, 1);
  assert.equal(r.el('rewind').value, '0'); assert.equal(r.el('rewind-label').textContent, 'Now');
  // Silence ends pointing like it ends the dome heading; Follow off hides the view.
  r.expire(1501); assert(r.el('pointer-wrap').hidden); assert(!r.el('dome').hidden);
  point(issNow.az, issNow.el, 0, 1); assert(!r.el('pointer-wrap').hidden);
  r.el('follow').onclick(); await flush();
  assert(r.el('pointer-wrap').hidden); assert(!r.el('dome').hidden); assert(!r.el('scrub').hidden);
  assert(!Object.keys(r.storage).some(k => /follow|orient|heading|point/.test(k)));
  // A place without a true-north correction never shows a pointing view.
  r = rig(); await flush(8); await r.el('follow').onclick(); r.submit(85, 130);
  r.orient(hostSample(90, 20)); assert(r.el('pointer-wrap').hidden); assert.match(r.el('follow-status').textContent, /True-north correction unavailable/);
  // Selecting another pass while already pointing must not trap a future sky
  // behind the hidden rewind controls. Keep the selection, but point at Now.
  r = rig({planScenario: 'repeated'}); await flush(8); r.tick(1); await flush();
  await r.el('follow').onclick();
  const pointingSample = hostSample(230, 14, 0, {declination: 5.2});
  r.orient(pointingSample);
  assert(!r.el('pointer-wrap').hidden);
  const futurePass = r.el('plan-list').children[1]; assert(futurePass);
  futurePass.click();
  assert.equal(r.el('rewind-label').textContent, 'Now', 'active pointing cannot enter a future preview');
  assert(!r.el('point-guide').textContent.includes('below your horizon'), 'currently visible ISS still has guidance');
  assert(r.el('plan-list').children.every(b => b.attributes['aria-pressed'] === 'false'));
  r.orient(pointingSample);
  assert.equal(r.el('rewind-label').textContent, 'Now');
  // Menu visibility may arrive before the native window regains focus.
  r = rig({orientationErrors:[null,'RUN_PAUSED',null]}); await flush(8);
  await r.el('follow').onclick();r.visibility(false);r.visibility(true);await flush();
  r.retryFollow();await flush();
  assert.equal(r.el('follow').attributes['aria-pressed'],'true');
  assert.equal(r.calls.filter(c=>c.method==='orientation.read'&&c.params.op==='watch').length,3);
  // A terminal event or explicit off cancels the bounded menu-return retry.
  for(const cancel of ['terminal','off']) {
    r = rig({orientationErrors:[null,'RUN_PAUSED',null]});await flush(8);
    await r.el('follow').onclick();r.visibility(false);r.visibility(true);await flush();
    if(cancel==='terminal')r.orient({watching:false,reason:'paused'});else r.el('follow').onclick();
    r.retryFollow();await flush();
    assert.equal(r.calls.filter(c=>c.method==='orientation.read'&&c.params.op==='watch').length,2,cancel);
    assert.equal(r.el('follow').attributes['aria-pressed'],'false');
  }
  r = rig({orientationErrors:[null,...Array(30).fill('RUN_PAUSED')]});await flush(8);
  await r.el('follow').onclick();r.visibility(false);r.visibility(true);await flush();
  for(let i=0;i<25;i++){r.retryFollow();await flush();}
  assert.equal(r.el('follow').attributes['aria-pressed'],'false');
  const attempts=r.calls.length;r.retryFollow();await flush();assert.equal(r.calls.length,attempts,'bounded retry stops');
  // ---- 0.5.0: the space-data mirror first, CelesTrak as the fallback ----
  const baseline = rig(); await flush(8);
  const baseCounts = baseline.el('counts').textContent;
  r = rig({mirror: mirrorFiles()}); await flush(8);
  assert.deepEqual(r.http(), [], 'a fresh mirror serves everything; CelesTrak is not asked');
  assert.deepEqual(r.mirrorHttp(), ['index.json', '20260928T1700Z/visual/elements-1.json', '20260928T1700Z/visual/satcat-1.json',
    '20260928T1700Z/last-30-days/elements-1.json', '20260928T1700Z/last-30-days/satcat-1.json']);
  assert.equal(r.el('counts').textContent, baseCounts, 'same sky as the CelesTrak path');
  assert.match(r.el('data-status').textContent, /^Orbit data \d+ h old · CelesTrak$/);
  r.el('list').children.find(b => b.dataset.id === '29507').click();
  assert.equal(r.el('spot-head').textContent, 'EAST · 1½ fists up');
  assert(r.storage['elements.meta'], 'mirror rows are cached like CelesTrak rows');
  assert(!/52\.517|13\.388/.test(r.mirrorHttp().join()), 'no place in mirror URLs');
  // Stale (built 13 h before the clock): CelesTrak directly, as in 0.4.
  r = rig({mirror: mirrorFiles({built: '2026-09-28T04:50:00Z', dataset: '20260928T0450Z'})}); await flush(8);
  assert.deepEqual(r.mirrorHttp(), ['index.json']);
  assert.deepEqual(r.http(), [GP, SC, RGP, RSC]);
  assert.equal(r.el('counts').textContent, baseCounts);
  // One bad row anywhere: that list comes from CelesTrak, and the mirror rests.
  r = rig({mirror: mirrorFiles({tamper: (f, d) => { f[`${MIRROR}${d}/visual/elements-1.json`].rows[3][5] = 1.5; }})}); await flush(8);
  assert.deepEqual(r.http(), [GP, SC, RGP, RSC], 'after a bad file the mirror rests; everything falls back');
  assert.deepEqual(r.mirrorHttp(), ['index.json', '20260928T1700Z/visual/elements-1.json']);
  assert.equal(r.el('counts').textContent, baseCounts);
  r.advance(20 * 60000); await r.el('refresh').onclick(); await flush(4);
  assert.equal(r.mirrorHttp().length, 2, 'no mirror request during its 30-minute rest');
  // A recent list with any row lacking its launch ID is not trusted from the mirror.
  r = rig({mirror: mirrorFiles({tamper: (f, d) => { f[`${MIRROR}${d}/last-30-days/elements-1.json`].rows[0][2] = null; }})}); await flush(8);
  assert.deepEqual(r.http(), [RGP, RSC]);

  // Native origin denial must fall back without treating it as a pause.
  r = rig({mirror: mirrorFiles(), mirrorError: 'HTTP_SOURCE'}); await flush(8);
  assert.deepEqual(r.http(), [GP, SC, RGP, RSC]);
  assert.equal(r.el('counts').textContent, baseCounts);
  // Empty and duplicate-row mirror snapshots cannot erase or duplicate the sky.
  for (const kind of ['empty-recent', 'duplicate-visual']) {
    r = rig({mirror: mirrorFiles({tamper: (f, d) => {
      const key = kind === 'empty-recent' ? 'last-30-days' : 'visual';
      const rows = f[`${MIRROR}${d}/${key}/elements-1.json`].rows;
      if (kind === 'empty-recent') rows.length = 0; else rows[1] = rows[0];
    }})}); await flush(8);
    assert(r.http().includes(kind === 'empty-recent' ? RGP : GP), kind + ' falls back');
    assert.equal(r.el('counts').textContent, baseCounts);
  }

  // ---- 0.5.0: layers ----
  r = rig({mirror: mirrorFiles()}); await flush(8);
  assert(r.el('layer-section').hidden, 'layers are off by default');
  assert.equal(r.dome().layers.length, 0);
  r.el('layers').click();
  assert(r.el('layers-dialog').open);
  r.el('layer-gnss-switch').checked = true; r.el('layer-gnss-switch').onchange(); await flush(6);
  assert.deepEqual(r.mirrorHttp().slice(-2), ['20260928T1700Z/gnss/elements-1.json', '20260928T1700Z/gnss/satcat-1.json']);
  assert.equal(r.el('layers-status').textContent, 'Navigation on.');
  assert.deepEqual(r.storage.preferences.layers, {gnss: true, geo: false});
  r.el('close-layers').click();
  assert(!r.el('layer-section').hidden); assert(!r.el('layer-gnss').hidden); assert(r.el('layer-geo').hidden);
  assert.match(r.el('layer-gnss-summary').textContent, /^\d+ navigation satellites above you: .*\b\d+ GPS\b.*\. Drawn as small squares\.$/);
  const gnssItems = r.dome().layers;
  assert(gnssItems.length > 10 && gnssItems.every(x => x.kind === 'gnss' && x.el >= 0));
  assert.equal(r.el('counts').textContent, baseCounts, 'layers never count as visible objects');
  const navButton = r.el('layer-gnss-list').children.find(b => /^GPS /.test(b.children[0].textContent));
  assert(navButton, 'a GPS satellite is listed');
  navButton.click();
  assert.match(r.el('spot-kind').textContent, /^GPS navigation satellite · United States$/);
  assert.match(r.el('spot-state').textContent, /^Far too faint to see without a telescope\. Your phone’s location fix can use signals/);
  assert.equal(r.dome().selected, Number(navButton.dataset.id));
  r.el('details').click(); await flush(4);
  assert.match(r.el('info-body').text, /Next time above you|Height/);
  assert.doesNotMatch(r.el('info-body').text, /· (visible|not visible)/, 'no visibility promise for a layer object');
  await r.el('wiki').onclick(); await flush();
  assert.match(r.http().at(-1), /titles=Global%20Positioning%20System$/);
  r.el('close-info').click();
  // Geostationary: the belt, a parked satellite, and what dishes point at.
  r.el('layers').click(); r.el('layer-geo-switch').checked = true; r.el('layer-geo-switch').onchange(); await flush(6);
  const snap = r.dome();
  assert(snap.belt && snap.belt.length > 20, 'the belt is drawn');
  assert.match(r.el('layer-geo-summary').textContent, /^\d+ geostationary satellites above you, strung along the dotted belt 3 fists up in the south\. Drawn as small diamonds\.$/);
  r.select(29055);
  assert.equal(r.el('spot-title').textContent, 'ASTRA 1KR');
  assert.match(r.el('spot-kind').textContent, /^Geostationary satellite · parked above 19\.\d°E/);
  assert.equal(r.el('spot-head').textContent, 'SOUTH · 3 fists up');
  assert.equal(r.el('spot-motion').textContent, 'It stays at this spot: it circles Earth once a day, exactly as fast as Earth turns.');
  assert.match(r.el('spot-state').textContent, /Satellite dishes aimed at it point exactly this way$/);
  r.el('details').click(); await flush(4);
  assert.match(r.el('info-body').text, /Parked above 19\.\d°E on the equator/);
  r.el('close-info').click();
  // Turning a layer off drops its selection and its objects.
  r.el('layer-geo-switch').checked = false; r.el('layer-geo-switch').onchange();
  assert(r.el('spot').hidden, 'a switched-off layer’s object is deselected');
  assert(r.dome().layers.every(x => x.kind === 'gnss')); assert.equal(r.dome().belt, null);
  // Preferences carry the layers into the next open; the data is downloaded again.
  const layerPrefs = structuredClone(r.storage);
  r = rig({mirror: mirrorFiles(), saved: layerPrefs}); await flush(10);
  assert(!r.el('layer-gnss').hidden);
  assert(r.mirrorHttp().includes('20260928T1700Z/gnss/elements-1.json'));
  assert(!Object.keys(r.storage).some(k => /gnss|geo|layer/.test(k)), 'layer data is not stored');
  for (const key of Object.keys(r.storage)) assert(allowedKeys(key), key);
  // Without the mirror a layer explains itself; the rest of the sky works.
  r = rig(); await flush(8);
  r.el('layers').click(); r.el('layer-geo-switch').checked = true; r.el('layer-geo-switch').onchange(); await flush(4);
  assert.match(r.el('layer-geo-summary').textContent, /come from the Space Watch data mirror, which is not reachable right now/);
  assert.equal(r.el('counts').textContent, baseCounts);

  // Repeated toggles share a pending layer request, and a pause does not
  // impose the network-failure retry delay on an uncompleted download.
  r = rig({mirror: mirrorFiles(), pendingHttp: u => u.includes('/gnss/')}); await flush(8);
  r.el('layer-gnss-switch').checked = true; r.el('layer-gnss-switch').onchange(); await flush();
  r.el('layer-gnss-switch').checked = false; r.el('layer-gnss-switch').onchange();
  r.el('layer-gnss-switch').checked = true; r.el('layer-gnss-switch').onchange(); await flush();
  assert.equal(r.mirrorHttp().filter(u => u.endsWith('gnss/elements-1.json')).length, 1, 'only one layer request in flight');
  r.visibility(false); r.finishHttp(); await flush();
  r.visibility(true); await flush();
  assert.equal(r.mirrorHttp().filter(u => u.endsWith('gnss/elements-1.json')).length, 2, 'pause retries on return, not after 15 minutes');
  r.finishHttp(); await flush(); r.finishHttp(); await flush(6);
  assert(r.dome().layers.length > 10, 'retried layer completes');

  console.log('Space Watch app checks passed: start, privacy (no coordinates in URLs or storage), list selection, spot words, details, Wikipedia on request, rewind, red mode, visible passes and preview, trains (plan, details, cache, optional failure), cache reuse/expiry/torn cache, CelesTrak back-off, location fallbacks, paused downloads and follow mode (true north, smoothing, guidance, calibration, pause, denial), pointing (camera aim to the zenith, words, lock, announcements, rewind exit), the space-data mirror (fresh, stale, bad row, rest) and layers (navigation, geostationary belt, selection, details, persistence, mirror down).');
})().catch(error => { console.error(error); process.exitCode = 1; });
