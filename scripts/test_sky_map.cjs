const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({ResizeObserver: class {observe(){}}, Date, Map, Set, Promise, Math});
vm.runInContext(fs.readFileSync('examples/sky-watch-module/ui/sky-map.js','utf8')+'\nglobalThis.TestMap=SkyMap;', context);
const tick=()=>new Promise(r=>setImmediate(r));
function setup() {
  const pending=[],errors=[];
  const canvas={getContext:()=>({}),addEventListener(){},getBoundingClientRect:()=>({width:0,height:0})};
  const map=new context.TestMap(canvas,()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),()=>{},()=>{},e=>errors.push(e));
  map.wanted=new Set(['8/134/86']);
  return {map,pending,errors};
}
(async()=>{
  const paused=setup();paused.map.pump();assert.equal(paused.pending.length,1);paused.map.pause(true);
  paused.pending[0].reject(Object.assign(new Error('Interrupted'),{code:'RUN_PAUSED'}));await tick();
  assert.equal(paused.map.failures.size,0);assert.equal(paused.errors.length,0);
  paused.map.pause(false);paused.map.pump();assert.equal(paused.pending.length,2);
  paused.map.pause(true);paused.pending[1].reject(new Error('Closed'));await tick();
  const normal=setup();normal.map.pump();normal.pending[0].reject(new Error('Offline'));await tick();
  assert.equal(normal.map.failures.size,1);assert.equal(normal.errors.length,1);normal.map.pump();assert.equal(normal.pending.length,1);
  const late=setup();late.map.pump();late.pending[0].reject(Object.assign(new Error('Old epoch'),{code:'RUN_STALE'}));await tick();
  assert.equal(late.map.failures.size,0);assert.equal(late.errors.length,0);
  console.log('3 Sky map lifecycle checks passed: cancellation/retry, real failure cooldown, stale reply.');
})().catch(e=>{console.error(e);process.exitCode=1});
