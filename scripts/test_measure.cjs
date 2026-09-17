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
function measureUi() {
  class Element {
    constructor(){this.captures=new Set();this.value='';this.hidden=false;this.listeners={};this.clientWidth=600;this.clientHeight=450;this.classList={toggle(){}};}
    addEventListener(type,fn){(this.listeners[type]??=[]).push(fn);}
    dispatch(type,extra={}){const event={type,preventDefault(){},...extra};this['on'+type]?.(event);for(const fn of this.listeners[type]||[])fn(event);}
    setAttribute(){} blur(){} setPointerCapture(id){this.captures.add(id);} releasePointerCapture(id){this.captures.delete(id);}
    getBoundingClientRect(){return {left:0,top:0};}
    getContext(){return new Proxy({},{get:()=>()=>{}});}
  }
  const html=fs.readFileSync('examples/measure-module/ui/index.html','utf8');
  const elements=Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(m=>[m[1],new Element()]));
  elements.units.value='cm';const window=new Element();window.devicePixelRatio=1;
  const sandbox={document:{getElementById:id=>elements[id]},window,Measure:require('../examples/measure-module/ui/geometry.js'),ResizeObserver:class{observe(){}},Image:class{set src(_){queueMicrotask(()=>this.onload());}},call:async method=>method==='image.read'?{handle:'synthetic',url:'https://synthetic.invalid/image.png',width:1200,height:900}:{markers:[{id:0,corners:square}]}};
  vm.runInNewContext(fs.readFileSync('examples/measure-module/ui/app.js','utf8'),sandbox);
  const pointer=(type,x,y)=>elements.photo.dispatch(type,{pointerId:1,clientX:x,clientY:y});
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
