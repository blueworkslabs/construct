const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const M = require('../examples/focus-module/ui/model.js');
const epoch = 1800000000000;

test('pause/resume preserves exact remainder and new deadline', () => {
  const running = M.start(M.fresh(10000), epoch);
  const paused = M.pause(running, epoch+2500);
  assert.equal(paused.remainingMs,7500);
  assert.equal(M.start(paused,epoch+30000).deadline,epoch+37500);
});
test('expired countdown settles once and restart creates a new session', () => {
  const done=M.settle(M.start(M.fresh(10000),epoch),epoch+10001);
  assert.equal(done.phase,'done'); assert.equal(M.settle(done,epoch+20000),done);
  assert.equal(M.start(done,epoch+20000).deadline,epoch+30000);
});
test('saved schema rejects malformed/future/oversized state', () => {
  for(const s of [[],{},null,{...M.fresh(),schema:2},{...M.fresh(),remainingMs:NaN},
    {...M.fresh(),durationMs:86400000},{...M.fresh(),phase:'running',deadline:-1},
    {...M.fresh(),phase:'done'},{...M.fresh(),extra:'unknown'}]) assert.equal(M.valid(s),false);
  for(const d of M.durations) assert.equal(M.valid(M.start(M.fresh(d),epoch)),true);
});
test('clock movement never exposes negative or longer-than-selected remainder', () => {
  const s=M.start(M.fresh(10000),epoch);
  assert.equal(M.left(s,epoch-999999),10000); assert.equal(M.left(s,epoch+999999),0);
});

async function flush() { for(let i=0;i<10;i++) await Promise.resolve(); }
async function app(saved=null, options={}) {
  const elements=new Map();
  const el=id=>{if(!elements.has(id))elements.set(id,{textContent:id==='status'?'Loading…':'',hidden:false,disabled:false,setAttribute(name,value){this[name]=value;}});return elements.get(id);};
  let now=epoch, tick, stored=saved, denied=options.denied || false;
  const events=[];
  const context={FocusModel:M, Date:{now:()=>now}, document:{getElementById:el,visibilityState:'visible'},
    setInterval:fn=>{tick=fn;}, call:async(method,p)=>{
      events.push({method,...p});
      if(method==='storage.kv') {
        if(denied) throw {code:'CAPABILITY_DENIED'};
        if(p.op==='get') return stored;
        stored=p.value; return null;
      }
      if(options.toneError) throw {code:options.toneError};
      return {accepted:true};
    }};
  vm.runInNewContext(fs.readFileSync('examples/focus-module/ui/app.js','utf8'),context);
  await flush();
  return {el,events,context,get stored(){return stored;}, deny:v=>denied=v,
    click:async id=>{if(el(id).disabled)throw Error('Disabled '+id); await el(id).onclick(); await flush();},
    advance:async ms=>{now+=ms;tick();await flush();}};
}
test('completion is durable before optional denied tone; not retried', async()=>{
  const a=await app(M.fresh(10000),{toneError:'CAPABILITY_DENIED'});
  await a.click('start'); await a.advance(10000); await a.advance(10000);
  assert.equal(a.stored.phase,'done'); assert.match(a.el('status').textContent,/Finished quietly/);
  const tones=a.events.filter(e=>e.method==='device.tone'); assert.equal(tones.length,1);
  const idx=a.events.findIndex(e=>e.method==='device.tone'); assert.equal(a.events[idx-1].value.phase,'done');
});
test('reopening an expired saved deadline finishes without late playback',async()=>{
  const a=await app(M.start(M.fresh(10000),epoch-20000));
  assert.equal(a.stored.phase,'done'); assert.match(a.el('status').textContent,/No late sound/);
  await a.advance(5000); assert.equal(a.events.filter(e=>e.method==='device.tone').length,0);
});
test('paused state survives reopening without consuming time',async()=>{
  const paused=M.pause(M.start(M.fresh(10000),epoch-1000),epoch);
  const a=await app(paused); await a.advance(60000);
  assert.equal(a.el('clock').textContent,'00:09'); assert.equal(a.el('clock')['aria-label'],'Time remaining: 00:09'); assert.equal(a.el('start').textContent,'Resume timer');
});
test('failed storage reads never overwrite existing data; retry restores it',async()=>{
  const original=M.fresh(300000),a=await app(original,{denied:true});
  assert.equal(a.el('start').disabled,true); assert.equal(a.events.some(e=>e.op==='set'),false);
  a.deny(false); await a.click('retry'); assert.equal(a.el('clock').textContent,'05:00');
  assert.equal(a.stored,original);
});
test('revoked storage at completion blocks sound and allows safe retry',async()=>{
  const a=await app(M.fresh(10000)); await a.click('start'); a.deny(true); await a.advance(10000);
  assert.equal(a.stored.phase,'running'); assert.equal(a.el('start').disabled,true);
  assert.equal(a.events.some(e=>e.method==='device.tone'),false);
  a.deny(false); await a.click('retry'); assert.equal(a.stored.phase,'done');
  assert.equal(a.events.some(e=>e.method==='device.tone'),false);
});
test('hidden document cannot submit completion tone',async()=>{
  const a=await app(M.fresh(10000)); await a.click('start'); a.context.document.visibilityState='hidden';
  await a.advance(10000); assert.equal(a.stored.phase,'done');
  assert.equal(a.events.some(e=>e.method==='device.tone'),false);
});
test('unsupported saved state needs explicit reset; cancel keeps it',async()=>{
  const original={schema:99},a=await app(original);
  assert.equal(a.el('start').disabled,true); await a.click('repair-open'); await a.click('repair-no');
  assert.equal(a.stored,original); assert.equal(a.events.some(e=>e.op==='set'),false);
  await a.click('repair-open'); await a.click('repair-yes'); assert.equal(a.stored.schema,1);
  assert.equal(a.el('start').disabled,false);
});
test('DND denial completes quietly and reset never submits sound',async()=>{
  const a=await app(M.fresh(10000),{toneError:'AUDIO_MUTED'}); await a.click('start'); await a.advance(10000);
  assert.match(a.el('status').textContent,/sound settings suppressed/); await a.click('reset');
  assert.equal(a.stored.phase,'idle'); assert.equal(a.events.filter(e=>e.method==='device.tone').length,1);
});
