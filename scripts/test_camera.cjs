'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('examples/camera-module/ui/app.js','utf8');
function rig(respond=async()=>({})){
 const elements=new Map(),events={},frames=[];
 const element=()=>({textContent:'',disabled:false,hidden:false,checked:true,style:{},children:[],classList:{toggle(){}},replaceChildren(){this.children=[];},append(x){this.children.push(x);},getBoundingClientRect(){return {width:400,height:300};}});
 const drawing=[];const ctx=new Proxy({measureText:s=>({width:s.length*7})},{get(t,k){return t[k]||((...a)=>drawing.push([k,...a]));}});
 const get=id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);};get('photo').getContext=()=>ctx;
 const calls=[];
 const context=vm.createContext({document:{getElementById:get,createElement:element,body:element()},window:{devicePixelRatio:2,addEventListener:(n,f)=>events[n]=f},requestAnimationFrame:f=>{frames.push(f);return frames.length;},ResizeObserver:class{observe(){}},performance:{now:()=>0},Image:class{naturalWidth=200;naturalHeight=100;set src(v){this.url=v;queueMicrotask(()=>this.onload());}},call:async(m,p)=>{calls.push({m,p});return respond(m,p);}});
 vm.runInContext(source,context);
 return {get,calls,events,frames,drawing,context,state:()=>vm.runInContext('state',context),eval:s=>vm.runInContext(s,context)};
}
const image={handle:'image-one',url:'https://dev.construct.camera.construct.invalid/construct-images/one.png',width:200,height:100};
test('normalized overlay fit is correctly letterboxed in both orientations',()=>{
 const r=rig();assert.deepEqual(JSON.parse(JSON.stringify(r.eval('fit(200,100,400,300)'))),{x:0,y:50,w:400,h:200});
 assert.deepEqual(JSON.parse(JSON.stringify(r.eval('fit(100,200,400,300)'))),{x:125,y:0,w:150,h:300});
});
test('capture is a human handoff, then album selection happens in the module',async()=>{
 const r=rig(async(m,p)=>m==='camera.photo'?{saved:true}:p.op==='list'?{photos:[{ref:'old'},{ref:'new'}]}:image);
 await r.get('capture').onclick();assert.deepEqual(r.calls.map(x=>[x.m,x.p.op]),[['camera.photo','capture'],['photos.library','list'],['photos.library','open']]);
 assert.equal(r.calls[2].p.ref,'new');assert.equal(r.get('position').textContent,'Private photo 2 of 2');assert.equal(r.state().image.handle,'image-one');
});
test('capture cancellation does not read the album',async()=>{
 const r=rig(async()=>({saved:false}));await r.get('capture').onclick();assert.equal(r.calls.length,1);assert.match(r.get('status').textContent,/canceled/);
});
test('confirmed deletion is requested, never impersonated by module UI',async()=>{
 const r=rig(async(m,p)=>p.op==='list'?{photos:[{ref:'one'}]}:p.op==='open'?image:{completed:false});
 await r.get('album').onclick();await r.get('delete').onclick();assert.equal(r.calls.at(-1).p.op,'delete');assert.deepEqual(Object.keys(r.calls.at(-1).p).sort(),['op','ref']);
 assert.equal(r.state().image.handle,'image-one');assert.match(r.get('status').textContent,/unchanged/);
});
test('phone selection does not enable deletion/export of an unrelated private original',async()=>{
 const r=rig(async()=>image);await r.get('pick').onclick();assert.equal(r.state().private,false);assert.equal(r.get('delete').disabled,true);assert.equal(r.get('export').disabled,true);
});
test('late inference after a native menu interruption cannot paint results',async()=>{
 let finish;const r=rig(async(m)=>m==='image.read'?image:new Promise(resolve=>finish=resolve));await r.get('pick').onclick();const pending=r.get('faces').onclick();
 r.events.constructvisibilitychange({detail:{visible:false}});finish({kind:'faces',processingMs:10,boxes:[{label:'Face',score:.9,left:.1,top:.2,right:.3,bottom:.4}]});await pending;
 assert.equal(r.state().analysis,null);assert.equal(r.get('results').children.length,0);
});
test('overlay toggles redraw locally without another inference and respect normalized boxes',async()=>{
 const r=rig(async(m)=>m==='image.read'?image:{kind:'objects',processingMs:10,boxes:[{label:'cat',score:.8,left:.1,top:.2,right:.5,bottom:.6}]});
 await r.get('pick').onclick();await r.get('objects').onclick();r.eval('paint()');assert.ok(r.drawing.some(x=>x[0]==='strokeRect'&&x[1]===40&&x[2]===90&&x[3]===160));
 const count=r.calls.length;r.get('overlays').checked=false;r.get('overlays').onchange();r.eval('paint()');assert.equal(r.calls.length,count);assert.equal(r.get('summary').textContent,'Objects found: 1 · on-device estimate');
});
test('bridge does not time out a human capture or native confirmation',async()=>{
 const timers=[];const construct={postMessage(){}};const c=vm.createContext({construct,setTimeout:(f,ms)=>{timers.push({f,ms});return timers.length;},clearTimeout(){}});
 vm.runInContext(fs.readFileSync('examples/camera-module/ui/bridge.js','utf8'),c);
 for(const [method,op] of [['camera.photo','capture'],['photos.library','delete'],['photos.library','export'],['image.read','pick']]){
  const p=vm.runInContext(`call('${method}',{op:'${op}'})`,c);assert.equal(timers.length,0);
  construct.onmessage({data:JSON.stringify({id:String(vm.runInContext('sequence',c)),result:{completed:false}})});await p;
 }
 const p=vm.runInContext("call('image.analyze',{op:'detect'})",c);assert.equal(timers[0].ms,20000);construct.onmessage({data:JSON.stringify({id:'5',result:{}})});await p;
});
test('startup has no privileged calls and denial offers the access route with retry',async()=>{
 const r=rig(async()=>{throw Object.assign(new Error('Access off'),{code:'CAPABILITY_DENIED'});});assert.equal(r.calls.length,0);
 await r.get('album').onclick();assert.match(r.get('status').textContent,/Module access/);assert.equal(r.get('album').disabled,false);
});
test('actual bridge and camera scripts compile together',()=>{assert.doesNotThrow(()=>new vm.Script(['bridge.js','app.js'].map(n=>fs.readFileSync('examples/camera-module/ui/'+n,'utf8')).join('\n')));});
