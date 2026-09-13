const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../examples/snake-module/ui/model.js');
const eat=()=>{let s=M.fresh(42);for(let i=0;i<3;i++)s=M.step(s);return s;};
test('first fruit grows snake and saves score/best; RNG is reproducible',()=>{
  const s=eat();assert.equal(s.score,1);assert.equal(s.best,1);assert.equal(s.snake.length,5);assert.equal(M.valid(s),true);
  assert.deepEqual(s,eat());assert.equal(s.snake.some(c=>c.join()==s.food.join()),false);
});
test('immediate reversal is ignored, legal turns change direction',()=>{
  const s=M.fresh();assert.equal(M.step(s,'left').direction,'right');assert.equal(M.step(s,'up').direction,'up');
  assert.deepEqual(M.step(s,'__proto__'),M.step(s));
});
test('wall collision freezes a valid game-over state',()=>{
  let s=M.fresh();for(let i=0;i<20;i++)s=M.step(s);
  assert.equal(s.mode,'over');assert.equal(M.valid(s),true);assert.equal(M.step(s),s);
});
test('self collision differs from legal movement into a vacated tail',()=>{
  const tail={...M.fresh(),snake:[[3,2],[2,2],[2,3],[2,4],[3,4],[3,3]],score:2,best:2,food:[8,8]};
  assert.equal(M.valid(tail),true);assert.equal(M.step(tail,'down').mode,'alive');
  const body={...tail,snake:[...tail.snake,[4,3],[4,2]],score:4,best:4};
  assert.equal(M.valid(body),true);assert.equal(M.step(body,'down').mode,'over');
});
test('full board finishes without an unbounded food-placement loop',()=>{
  const path=[];for(let y=0;y<16;y++)for(let x=0;x<16;x++)path.push([y%2?15-x:x,y]);
  const s={...M.fresh(),snake:path.slice(0,255).reverse(),direction:'left',food:path[255],score:251,best:251};
  assert.equal(M.valid(s),true);const won=M.step(s);assert.equal(won.mode,'won');assert.equal(won.food,null);assert.equal(M.valid(won),true);assert.ok(JSON.stringify({id:'123',method:'storage.kv',params:{op:'set',key:'game',value:won}}).length<8192);
});
test('speed increases within a bounded 110–300ms range',()=>{
  assert.equal(M.interval({score:0}),300);assert.ok(M.interval({score:4})<300);assert.equal(M.interval({score:252}),110);
});
test('corrupt/future/contradictory saved states fail validation',()=>{
  for(const s of [null,[],{}, {...M.fresh(),schema:2},{...M.fresh(),direction:'__proto__'},
    {...M.fresh(),snake:[[1,1],[1,1],[1,2],[1,3]]},{...M.fresh(),food:[5,8]},
    {...M.fresh(),best:10000},{...M.fresh(),moves:NaN},{...M.fresh(),direction:'up'},
    {...M.fresh(),unknown:true}])assert.equal(M.valid(s),false);
});
test('many seeded games retain invariants and never place food inside snake',()=>{
  for(let seed=0;seed<100;seed++){
    let s=M.fresh(seed);for(let i=0;i<200&&s.mode==='alive';i++){
      s=M.step(s,Object.keys(M.vectors)[(seed+i)%4]);assert.equal(M.valid(s),true);
    }
  }
});
async function flush(){for(let i=0;i<12;i++)await Promise.resolve();}
async function app(saved=null,reduced=false){
  const els=new Map(),handlers={},events=[];let now=0,frame,stored=saved,denied=false,delay=false,release;
  const draws=[],motion={matches:reduced,addEventListener:(k,f)=>handlers['motion:'+k]=f};
  const ctx=new Proxy({}, {get:(obj,k)=>obj[k]??((...args)=>draws.push([k,...args]))});
  const el=id=>{if(!els.has(id))els.set(id,{textContent:'',hidden:false,disabled:false,width:0,height:0,
    setAttribute(k,v){this[k]=v;},getContext:()=>ctx,getBoundingClientRect:()=>({width:280}),
    addEventListener:(k,f)=>{handlers[id+':'+k]=f;},setPointerCapture:()=>{}});return els.get(id);};
  const context={SnakeModel:M,Math,performance:{now:()=>now},window:{matchMedia:()=>motion,devicePixelRatio:2,addEventListener:(k,f)=>handlers['window:'+k]=f},
    document:{getElementById:el,visibilityState:'visible',addEventListener:(k,f)=>handlers['document:'+k]=f},requestAnimationFrame:f=>frame=f,
    call:async(method,p)=>{events.push({method,...p});if(denied)throw {code:'CAPABILITY_DENIED'};
      if(p.op==='get')return stored;if(delay)await new Promise(resolve=>release=resolve);stored=p.value;return null;}};
  vm.runInNewContext(fs.readFileSync('examples/snake-module/ui/app.js','utf8'),context);await flush();
  return {el,events,handlers,context,draws,motion,get stored(){return stored;},deny:v=>denied=v,delay:v=>delay=v,release:async()=>{release();await flush();},
    click:async id=>{if(el(id).disabled)throw Error('Disabled '+id);await el(id).onclick();await flush();},
    frame:async ms=>{now+=ms;frame(now);await flush();}};
}
test('one accepted turn per tick prevents rapid double-turn reversal',async()=>{
  const a=await app();await a.click('play');await a.click('up');await a.click('left');await a.frame(300);
  assert.equal(a.stored.direction,'up');assert.deepEqual(a.stored.snake[0],[5,7]);
});
test('board accessibility exposes current position; reopening is paused',async()=>{
  const a=await app(eat());assert.match(a.el('board')['aria-label'],/Head 9, 9/);assert.equal(a.el('play').textContent,'Resume');
  await a.frame(900);assert.equal(a.events.some(e=>e.op==='set'),false);
});
test('serialized writes never overlap, long stalls pause without catch-up',async()=>{
  const a=await app();await a.click('play');a.delay(true);await a.frame(300);await a.frame(500);await a.frame(500);
  assert.equal(a.events.filter(e=>e.op==='set').length,1);await a.release();await a.frame(1);
  assert.match(a.el('status').textContent,/interruption/);assert.equal(a.stored.moves,1);
});
test('denied writes pause, keep last save and reload safely',async()=>{
  const initial=M.fresh(),a=await app(initial);await a.click('play');a.deny(true);await a.frame(300);
  assert.equal(a.stored,initial);assert.equal(a.el('play').disabled,true);assert.match(a.el('status').textContent,/CAPABILITY_DENIED/);
  a.deny(false);await a.click('retry');assert.equal(a.el('play').disabled,false);assert.equal(a.el('pause').disabled,true);
});
test('visibility and resize pause without advancing on return',async()=>{
  const a=await app();await a.click('play');await a.frame(300);
  a.context.document.visibilityState='hidden';a.handlers['document:visibilitychange']();await a.frame(900);assert.equal(a.stored.moves,1);
  a.context.document.visibilityState='visible';await a.click('play');a.handlers['window:resize']();await a.frame(900);assert.equal(a.stored.moves,1);
});
test('new game keeps high score; saved-data reset requires explicit confirmation',async()=>{
  const a=await app(eat());await a.click('new');assert.equal(a.stored.best,1);assert.equal(a.stored.score,0);
  const bad={schema:99},b=await app(bad);assert.equal(b.el('play').disabled,true);await b.click('discard-open');await b.click('keep');assert.equal(b.stored,bad);
  await b.click('discard-open');await b.click('discard');assert.equal(b.stored.best,0);assert.equal(b.el('play').disabled,false);
});
test('short swipes and secondary pointers do not turn; primary swipe does',async()=>{
  const a=await app();await a.click('play');
  a.handlers['board:pointerdown']({isPrimary:false,pointerId:2,clientX:50,clientY:50});
  a.handlers['board:pointerup']({pointerId:2,clientX:50,clientY:0});
  await a.frame(300);assert.equal(a.stored.direction,'right');
  a.handlers['board:pointerdown']({isPrimary:true,pointerId:1,clientX:50,clientY:50});
  a.handlers['board:pointerup']({pointerId:1,clientX:50,clientY:45});await a.frame(300);assert.equal(a.stored.direction,'right');
  a.handlers['board:pointerdown']({isPrimary:true,pointerId:1,clientX:50,clientY:50});
  a.handlers['board:pointerup']({pointerId:1,clientX:50,clientY:0});await a.frame(300);assert.equal(a.stored.direction,'up');
});

test('all browser scripts compile together without colliding global declarations',()=>{
  const sources=['bridge.js','model.js','app.js'].map(n=>fs.readFileSync('examples/snake-module/ui/'+n,'utf8')).join('\n');
  assert.doesNotThrow(()=>new vm.Script(sources));
});


test('board tap starts/resumes but never bypasses storage denial or game over',async()=>{
  const tapBoard=a=>{a.handlers['board:pointerdown']({isPrimary:true,pointerId:1,clientX:50,clientY:50});a.handlers['board:pointerup']({pointerId:1,clientX:50,clientY:50});};
  const a=await app();tapBoard(a);await a.frame(300);assert.equal(a.stored.moves,1);
  await a.click('pause');tapBoard(a);await a.frame(300);assert.equal(a.stored.moves,2);
  a.deny(true);await a.frame(300);tapBoard(a);await a.frame(300);assert.equal(a.stored.moves,2);
  let over=M.fresh();for(let i=0;i<20;i++)over=M.step(over);
  const b=await app(over);tapBoard(b);await b.frame(300);assert.equal(b.events.some(e=>e.op==='set'),false);
});
test('reduced motion removes decorative canvas animation, including preference changes',async()=>{
  const a=await app(null,true);await a.click('play');await a.frame(300);
  a.draws.length=0;await a.frame(20);const first=JSON.stringify(a.draws);
  a.draws.length=0;await a.frame(20);assert.equal(JSON.stringify(a.draws),first);
  const b=await app();await b.click('play');for(let i=0;i<3;i++)await b.frame(300);
  assert.equal(b.stored.score,1);b.motion.matches=true;b.handlers['motion:change']();await b.click('pause');
  b.draws.length=0;await b.frame(20);assert.equal(b.draws.length,0);
});

test('native menu notification pauses without advancing or auto-resuming',async()=>{
  const a=await app();await a.click('play');await a.frame(300);
  a.handlers['window:constructvisibilitychange']({detail:{visible:false}});
  await a.frame(600);assert.equal(a.stored.moves,1);
  a.handlers['window:constructvisibilitychange']({detail:{visible:true}});
  await a.frame(600);assert.equal(a.stored.moves,1);assert.equal(a.el('pause').disabled,true);
});
