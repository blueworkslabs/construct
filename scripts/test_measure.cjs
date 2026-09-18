const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {Plane,Editor,reference,sideMm}=require('../examples/measure-module/ui/geometry.js');
const square=[{x:.2,y:.2},{x:.4,y:.2},{x:.4,y:.4},{x:.2,y:.4}],a={x:.3,y:.6},b={x:.8,y:.6};
function editor(){const e=new Editor();e.calibrate(square,100);return e;}
function pair(e){e.place(e.revision,a);e.place(e.revision,b);}
function close(x,y){assert.ok(Math.abs(x-y)<1e-7,`${x} != ${y}`);}
test('actual measured marker size determines scale',()=>{const p=new Plane(square);close(p.length(a,b,95),237.5);close(p.length(a,b,100),250);});
test('independent forward perspective and four corner rotations recover 240 mm',()=>{const project=(x,y)=>{const d=1+.2*x+.1*y;return {x:(.25+.18*x+.04*y)/d,y:(.2+.03*x+.16*y)/d};};const corners=[project(0,0),project(1,0),project(1,1),project(0,1)];for(let r=0;r<4;r++)close(new Plane(corners.map((_,i)=>corners[(i+r)%4])).length(project(0,2),project(2.4,2),100),240);});
test('malformed geometry and non-finite/outside points fail',()=>{for(const c of [[],[square[0],square[0],square[2],square[3]],[square[0],square[2],square[1],square[3]]])assert.throws(()=>new Plane(c));const p=new Plane(square);for(const q of [{x:NaN,y:.4},{x:-.1,y:.4},{x:.4,y:Infinity}])assert.throws(()=>p.project(q));assert.throws(()=>p.length(a,a,100));assert.throws(()=>p.length(a,b,NaN));});
test('projective horizon and opposite side rejected',()=>{const p=new Plane([{x:.2,y:.3},{x:.4,y:.3},{x:.5,y:.5},{x:.1,y:.5}]);p.project({x:.3,y:.4});for(const y of [.1,.05])assert.throws(()=>p.project({x:.3,y}));});
test('calibration supports decimal comma and rejects ambiguous input',()=>{assert.equal(sideMm('95,5'),95.5);for(const s of ['','NaN','1e2','9','301','95mm','95,5.0','-95'])assert.throws(()=>sideMm(s));});
test('reference selection is module policy, ignores other IDs but rejects duplicate target and small edges',()=>{assert.deepEqual(reference([{id:7,corners:[]},{id:0,corners:square}],1200,900),square);assert.throws(()=>reference([{id:1,corners:square}],1200,900),/No reference/);assert.throws(()=>reference([{id:0,corners:square},{id:0,corners:square}],1200,900),/only one/);assert.throws(()=>reference([{id:0,corners:square}],100,100),/40 image pixels/);});
test('many drag previews become one undo transaction',()=>{const e=editor();pair(e);const before=e.value;e.begin(e.revision,'b');for(let i=0;i<30;i++)e.move(e.revision,{x:.7+i/1000,y:.6});e.move(e.revision,{x:.72,y:.6},true);e.undo();assert.deepEqual(e.value,before);e.undo();assert.equal(e.value.b,null);e.undo();assert.equal(e.value,null);});
test('cancel restores original value without adding undo',()=>{const e=editor();pair(e);const before=e.value;e.begin(e.revision,'b');e.move(e.revision,{x:.7,y:.6});e.cancel();assert.deepEqual(e.value,before);e.undo();assert.equal(e.value.b,null);});
test('invalid preview and commit cannot replace last accepted value',()=>{const e=editor();pair(e);e.begin(e.revision,'b');e.move(e.revision,{x:.7,y:.6});const accepted=e.value;assert.throws(()=>e.move(e.revision,a));assert.deepEqual(e.value,accepted);assert.throws(()=>e.move(e.revision,{x:NaN,y:.6},true));assert.deepEqual(e.value,accepted);e.cancel();assert.deepEqual(e.value.b,b);});
test('recalibration invalidates gestures and previous undo',()=>{const e=editor();pair(e);const token=e.revision;e.begin(token,'b');e.calibrate(square,95.5);assert.throws(()=>e.place(token,a));assert.throws(()=>e.move(token,b,true));assert.equal(e.value,null);assert.equal(e.history.length,0);pair(e);close(e.value.mm,238.75);});
test('clear is undoable; no-op drags do not consume undo',()=>{const e=editor();pair(e);const before=e.value;e.begin(e.revision,'b');e.move(e.revision,b,true);e.clear();e.undo();assert.deepEqual(e.value,before);e.undo();assert.equal(e.value.b,null);});
test('history bounded, third placement cannot replace current pair',()=>{const e=editor();pair(e);assert.throws(()=>e.place(e.revision,{x:.9,y:.5}));for(let i=0;i<12;i++){e.begin(e.revision,'b');e.move(e.revision,{x:.7+i/1000,y:.6},true);}assert.equal(e.history.length,10);for(let i=0;i<10;i++)e.undo();assert.ok(e.value.b);assert.equal(e.history.length,0);});
test('fine nudge is a single undo and rejected nudge cancels transaction',()=>{const e=editor();pair(e);const before=e.value;e.nudge('b',1,0,1200,900);close(e.value.b.x,b.x+1/1200);e.undo();assert.deepEqual(e.value,before);assert.throws(()=>e.nudge('b',1200,0,1200,900));assert.deepEqual(e.value,before);assert.equal(e.drag,null);});
test('module scripts compile and capabilities exclude native launcher/network/storage/log',()=>{assert.doesNotThrow(()=>new vm.Script(['bridge.js','geometry.js','app.js'].map(n=>fs.readFileSync('examples/measure-module/ui/'+n,'utf8')).join('\n')));const m=JSON.parse(fs.readFileSync('examples/measure-module/manifest.json'));assert.deepEqual(m.capabilities.map(c=>c.id),['image.read','image.markers']);assert.equal(m.constructApi.min,'0.10.0');});

// Exercise the actual UI event wiring, not just Editor.cancel(). The Android 17
// WebView trace delivered touchcancel without a corresponding pointercancel.
function measureUi(calls=null) {
  class Element {
    constructor(){this.captures=new Set();this.value='';this.hidden=false;this.listeners={};this.clientWidth=600;this.clientHeight=450;this.classList={toggle(){}};}
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
    dispatch(type,extra={}){const event={type,preventDefault(){},...extra};this['on'+type]?.(event);for(const fn of this.listeners[type]||[])fn(event);}
    setAttribute(){} blur(){} setPointerCapture(id){this.captures.add(id);} releasePointerCapture(id){this.captures.delete(id);}
    getBoundingClientRect(){return {left:0,top:0};}
    getContext(){return new Proxy({},{get:(_,name)=>(...args)=>{calls?.push({name,args});return name==='measureText'?{width:args[0].length*8}:undefined;}});}
  }
  const html=fs.readFileSync('examples/measure-module/ui/index.html','utf8');
  const elements=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()]));
  elements.units.value='cm';const window=new Element();window.devicePixelRatio=1;
  const sandbox={document:{getElementById:id=>elements[id]},window,Measure:require('../examples/measure-module/ui/geometry.js'),ResizeObserver:class{observe(){}},Image:class{set src(_){queueMicrotask(()=>this.onload());}},call:async method=>method==='image.read'?{handle:'synthetic',url:'https://synthetic.invalid/image.png',width:1200,height:900}:{markers:[{id:0,corners:square}]}};
  vm.runInNewContext(fs.readFileSync('examples/measure-module/ui/app.js','utf8'),sandbox);
  const pointer=(type,x,y,pointerId=1)=>elements.photo.dispatch(type,{pointerId,clientX:x,clientY:y});
  return {elements,pointer,tap(x,y){pointer('pointerdown',x,y);pointer('pointerup',x,y);}};
}
for(const cancellation of ['pointercancel','touchcancel','lostpointercapture'])test('actual module UI restores a drag on '+cancellation+' and ignores late release',async()=>{
  const {elements:e,pointer,tap}=measureUi();await e.choose.onclick();e.side.value='100';e.setup.dispatch('submit');
  tap(180,270);tap(480,270);assert.equal(e.result.textContent,'Length: 25.0 cm');
  pointer('pointerdown',480,270);pointer('pointermove',420,270);assert.equal(e.result.textContent,'Length: 20.0 cm');
  e.photo.dispatch(cancellation);assert.equal(e.result.textContent,'Length: 25.0 cm');
  pointer('pointerup',420,270);assert.equal(e.result.textContent,'Length: 25.0 cm');
  e.undo.onclick();assert.equal(e.result.textContent,'No length yet','cancel must not add a committed undo step');
});

test('touch-only cancellation releases capture before subsequent controls can receive input',async()=>{
  const {elements:e,pointer,tap}=measureUi();await e.choose.onclick();e.side.value='100';e.setup.dispatch('submit');tap(180,270);tap(480,270);
  pointer('pointerdown',480,270);pointer('pointermove',420,270);assert.ok(e.photo.captures.has(1));
  e.photo.dispatch('touchcancel');assert.equal(e.photo.captures.size,0);assert.equal(e.result.textContent,'Length: 25.0 cm');
  e['select-b'].onclick();e.left.onclick();assert.equal(e.result.textContent,'Length: 25.0 cm');
  e.units.value='mm';e.units.onchange();assert.equal(e.result.textContent,'Length: 249.6 mm');
});

function measureBridge() {
  let now=0,nextTimer=0;const timers=new Map(),sent=[];
  const sandbox={construct:{postMessage:raw=>sent.push(JSON.parse(raw))},
    setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,at:now+delay});return id;},
    clearTimeout(id){timers.delete(id);}};
  vm.runInNewContext(fs.readFileSync('examples/measure-module/ui/bridge.js','utf8'),sandbox);
  return {call:sandbox.call,sent,timers,
    advance(ms){now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}},
    reply(response){sandbox.construct.onmessage({data:JSON.stringify(response)});}};
}
test('human picker request survives beyond five minutes and accepts its original reply',async()=>{
  const bridge=measureBridge();let state='pending';
  const result=bridge.call('image.read',{op:'pick'});result.then(()=>state='resolved',()=>state='rejected');
  bridge.advance(30*60*1000);await Promise.resolve();assert.equal(state,'pending');
  bridge.reply({id:bridge.sent[0].id,result:{handle:'chosen-after-browsing'}});
  assert.equal((await result).handle,'chosen-after-browsing');assert.equal(bridge.timers.size,0);
});
test('late picker cancellation still rejects with the host cancellation reason',async()=>{
  const bridge=measureBridge();const result=bridge.call('image.read',{op:'pick'});
  const rejected=assert.rejects(result,error=>error.code==='IMAGE_CANCELLED');
  bridge.advance(30*60*1000);
  bridge.reply({id:bridge.sent[0].id,error:{code:'IMAGE_CANCELLED',message:'No photo selected'}});
  await rejected;assert.equal(bridge.timers.size,0);
});
test('noninteractive marker and release calls retain bounded response timeouts',async()=>{
  for(const [method,params] of [['image.markers',{op:'detect'}],['image.read',{op:'release',handle:'old'}]]){
    const bridge=measureBridge();const result=bridge.call(method,params);
    const rejected=assert.rejects(result,error=>error.code==='TIMEOUT');
    bridge.advance(20000);await rejected;assert.equal(bridge.timers.size,0);
    bridge.reply({id:bridge.sent[0].id,result:{late:true}});
  }
});

// Magnifier geometry is pure: the crop is centred on the point, honest at photo edges and scaled to the loupe.
const {loupe,loupePlacement}=require('../examples/measure-module/ui/geometry.js');
test('loupe crop centres on the point at the current zoom and shifts instead of drifting at edges',()=>{
  const centre=loupe({x:.5,y:.5},1200,900,600,120,2.5);
  assert.equal(centre.w,centre.h);assert.equal(centre.x+centre.w/2,600);assert.equal(centre.y+centre.h/2,450);assert.equal(centre.dx,0);close(centre.w*centre.scale,120);
  const zoomed=loupe({x:.5,y:.5},1200,900,2400,120,2.5);assert.ok(zoomed.w<centre.w,'zoomed-in view magnifies fewer photo pixels');
  const corner=loupe({x:0,y:0},1200,900,600,120,2.5);assert.equal(corner.x,0);assert.equal(corner.y,0);assert.equal(corner.w,centre.w/2);
  assert.ok(corner.dx>0&&Math.abs(corner.dx-60)<1e-9,'crop start lands at the loupe centre so the crosshair still marks the point');
  const far=loupe({x:1,y:1},1200,900,600,120,2.5);assert.equal(far.x+far.w,1200);assert.equal(far.y+far.h,900);assert.equal(far.dx,0);
  assert.throws(()=>loupe({x:1.2,y:.5},1200,900,600,120,2.5));
});
test('loupe placement lifts above the finger, flips below near the top and stays inside the view',()=>{
  assert.deepEqual(loupePlacement({x:300,y:300},600,450,120,80),{x:300,y:220,r:60});
  assert.deepEqual(loupePlacement({x:300,y:100},600,450,120,80),{x:300,y:180,r:60});
  assert.deepEqual(loupePlacement({x:10,y:440},600,450,120,80),{x:60,y:360,r:60});
  assert.deepEqual(loupePlacement({x:595,y:300},600,450,120,80),{x:540,y:220,r:60});
  const tiny=loupePlacement({x:5,y:5},40,40,120,80);assert.ok(tiny.x>=0&&tiny.y>=0,'undersized views never invert the clamp');
});
test('magnifier draws the actual photo crop around the dragged endpoint and disappears on release',async()=>{
  const calls=[];const {elements:e,pointer,tap}=measureUi(calls);await e.choose.onclick();e.side.value='100';e.setup.dispatch('submit');
  tap(180,270);tap(480,270);calls.length=0;
  pointer('pointerdown',480,270);pointer('pointermove',420,270);
  const draws=calls.filter(c=>c.name==='drawImage');assert.ok(draws.length>=2,'photo plus loupe crop');
  const crop=draws[draws.length-1].args;assert.equal(crop.length,9);
  assert.equal(crop[1]+crop[3]/2,840,'crop centred on the accepted x of B (0.7 × 1200)');assert.equal(crop[2]+crop[4]/2,540);
  calls.length=0;pointer('pointerup',420,270);
  assert.equal(calls.filter(c=>c.name==='drawImage').length,1,'no magnifier once the drag is committed');
  assert.equal(e.result.textContent,'Length: 20.0 cm');
});
test('press-and-hold previews the next endpoint and places it where the finger is released',async()=>{
  const calls=[];const {elements:e,pointer}=measureUi(calls);await e.choose.onclick();e.side.value='100';e.setup.dispatch('submit');calls.length=0;
  pointer('pointerdown',180,270);assert.equal(calls.filter(c=>c.name==='drawImage').length,2,'magnifier shows on the initial press');
  pointer('pointermove',300,300);pointer('pointermove',180,270);
  assert.equal(e.result.textContent,'No length yet','preview alone never places a point');
  pointer('pointerup',180,270);calls.length=0;
  pointer('pointerdown',400,300);pointer('pointermove',480,270);pointer('pointerup',480,270);
  assert.equal(e.result.textContent,'Length: 25.0 cm','B lands at the release position, not the press');
  calls.length=0;pointer('pointerdown',300,100);assert.equal(calls.filter(c=>c.name==='drawImage').length,1,'a completed pair shows no placement preview');pointer('pointerup',300,100);
  assert.equal(e.result.textContent,'Length: 25.0 cm','a third tap cannot replace the pair and shows no preview');
});
test('a second finger cancels the preview and pinch/pan never place or move endpoints',async()=>{
  const calls=[];const {elements:e,pointer,tap}=measureUi(calls);await e.choose.onclick();e.side.value='100';e.setup.dispatch('submit');
  tap(180,270);tap(480,270);
  pointer('pointerdown',480,270);pointer('pointermove',440,270);assert.equal(e.result.textContent,'Length: 21.7 cm');
  pointer('pointerdown',200,200,2);assert.equal(e.result.textContent,'Length: 25.0 cm','second finger restores the drag start');
  calls.length=0;pointer('pointermove',100,200,2);
  assert.equal(calls.filter(c=>c.name==='drawImage').length,1,'no magnifier while pinching');
  pointer('pointerup',100,200,2);pointer('pointerup',480,270);
  assert.equal(e.result.textContent,'Length: 25.0 cm');
  e.clear.onclick();assert.equal(e.result.textContent,'No length yet');
  assert.equal(e.reset.hidden,false,'pinch left the view zoomed in');
  pointer('pointerdown',300,225);pointer('pointermove',360,225);pointer('pointerup',360,225);
  pointer('pointerdown',300,225);pointer('pointerup',300,225);
  assert.equal(e.result.textContent,'No length yet','zoomed-in drag panned instead of placing A, so this tap is A');
  e.reset.onclick();assert.equal(e.reset.hidden,true);e.clear.onclick();
  pointer('pointerdown',300,225);pointer('pointerup',300,225);pointer('pointerdown',420,225);pointer('pointerup',420,225);
  assert.equal(e.result.textContent,'Length: 10.0 cm','fit coordinates unchanged after reset');
  e.undo.onclick();e.undo.onclick();assert.equal(e.result.textContent,'No length yet');
});
