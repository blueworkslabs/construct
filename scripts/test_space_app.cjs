// Exercise the actual Space Watch controller with a bounded host/DOM double.
// Canvas drawing, layout and real permission UI remain Android acceptance work.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
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
const WIKI = JSON.stringify({query: {pages: [{title: 'Long March 4B', extract: 'The Long March 4B is a Chinese launch vehicle.', fullurl: 'https://en.wikipedia.org/wiki/Long_March_4B'}]}});
function rig({saved = {}, error = null, gpStatus = 200, satcatStatus = 200, recentStatus = 200, recentBody = RECENT, recentSatcatBody = RECENT_SATCAT, netError = null, pendingHttp = false, clock = START, launchBody = LAUNCH, elementsBody = ELEMENTS, pendingLocation = false, planScenario = false} = {}) {
  const elements = new Map(), events = {}, timers = [], calls = [], held = [], heldLocation = [];
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
    Date: Clock, setInterval: fn => timers.push(fn), setTimeout: () => 0, Math, JSON, Promise, Map, Set, URLSearchParams,
    addEventListener(type, handler) { events[type] = handler; },
    call: async (method, params) => {
      calls.push({method, params: JSON.parse(JSON.stringify(params))});
      if (method === 'storage.kv') {
        if (params.op === 'set') storage[params.key] = JSON.parse(JSON.stringify(params.value));
        return structuredClone(storage[params.key] ?? null);
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
  const scripts = ['vendor/satellite.min.js', 'vendor/astronomy.min.js', 'space-stars.js', 'space-orbit.js', 'space-sky.js', 'space-catalog.js', 'space-plan.js', 'space-dome.js', 'app.js'];
  for (const f of scripts) {
    if (f === 'app.js') vm.runInContext('SpaceDome = class extends SpaceDome { constructor(c, cb) { super(c, cb); window.selectObject = cb; } set(s) { window.domeSnapshot = s; } }', context);
    vm.runInContext(fs.readFileSync(root + f, 'utf8'), context, {filename: f});
    if (f === 'space-plan.js' && planScenario) vm.runInContext(`SpacePlan.darkRanges = (from,to)=>[[from,to]]; SpacePlan.passes = (o,ob,ranges)=> { const t=${clock} + 12.25*3600000; return o.id===25544 && ranges.some(([a,b])=>a<=t&&t<=b) ? [{startMs:t,endMs:t+120000,maxMs:t+60000,startAz:90,endAz:180,maxAz:135,startEl:10,endEl:10,maxEl:20,startReason:'rises',endReason:'sets'}] : []; };`,context);
  }
  const http = () => calls.filter(c => c.method === 'net.http').map(c => c.params.url);
  return {el, calls, storage, classes, http, dome: () => sandbox.domeSnapshot, select: id => sandbox.selectObject(id),
    finishLocation: () => heldLocation.splice(0).forEach(f => f()),
    finishHttp: () => held.splice(0).forEach(f => f()),
    tick: (n = 1, ms = 1000) => { for (let i = 0; i < n; i++) { now += ms; timers.forEach(f => f()); } },
    advance: ms => { now += ms; },
    visibility: visible => events.constructvisibilitychange({detail: {visible}}),
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
  assert.deepEqual(r.storage.preferences, {startWithLocation: true, red: true});

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
  // A cached plan must include passes entering the rolling 12-hour window.
  r = rig({planScenario: true, recentBody: '[]'}); await flush(8); r.tick(1,0);
  assert.equal(r.el('plan-list').children.length,0, '12h15m pass is initially outside displayed horizon');
  r.advance(29*60000); r.tick(1,0);
  assert(r.el('plan-list').children.some(b=>b.dataset.id==='25544'), 'buffered pass enters horizon before 30-minute refresh');
  // A genuinely empty recent list is valid and remains fresh across reopen.
  r = rig({recentBody: '[]'}); await flush(8);
  r = rig({saved: r.storage, clock: START + HOUR}); await flush(8);
  assert.deepEqual(r.http(), [], 'valid empty recent data should not refetch on every reopen');
  // Trains are optional: a failing recent list leaves the sky and its message alone.
  r = rig({recentStatus: 503}); await flush(8);
  assert.deepEqual(r.http(), [GP, SC, RGP]);
  assert.match(r.el('data-status').textContent, /^Orbit data \d+ h old · CelesTrak$/);
  assert.equal(r.storage['fetch-state'].recentLast, START);
  console.log('Space Watch app checks passed: start, privacy (no coordinates in URLs or storage), list selection, spot words, details, Wikipedia on request, rewind, red mode, visible passes and preview, trains (plan, details, cache, optional failure), cache reuse/expiry/torn cache, CelesTrak back-off, location fallbacks and paused downloads.');
})().catch(error => { console.error(error); process.exitCode = 1; });
