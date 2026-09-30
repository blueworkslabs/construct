const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const context = vm.createContext({ResizeObserver: class {observe(){}}, Date, Map, Set, Promise, Math, Number, devicePixelRatio: 2});
const ui='examples/sky-watch-module/ui/';
vm.runInContext(fs.readFileSync(ui+'models.js','utf8')+fs.readFileSync(ui+'sky-data.js','utf8')+fs.readFileSync(ui+'sky-map.js','utf8')+'\nglobalThis.TestMap=SkyMap;', context);
const tick=()=>new Promise(r=>setImmediate(r));
function setup() {
  const pending=[],errors=[];
  const canvas={getContext:()=>({}),addEventListener(){},getBoundingClientRect:()=>({width:0,height:0})};
  const map=new context.TestMap(canvas,()=>new Promise((resolve,reject)=>pending.push({resolve,reject})),()=>{},()=>{},e=>errors.push(e));
  map.wanted=new Set(['8/134/86']);
  return {map,pending,errors};
}
// Interactive rig: a 300×300 canvas with a no-op 2D context and captured listeners.
function rig() {
  const listeners={},selected=[],pans=[];
  const canvas={width:0,height:0,setPointerCapture(){},getBoundingClientRect:()=>({left:0,top:0,width:300,height:300}),
    addEventListener(type,fn){listeners[type]=fn;},
    getContext:()=>new Proxy({},{get:(_,k)=>k==='measureText'?()=>({width:40}):()=>{},set:()=>true})};
  const map=new context.TestMap(canvas,()=>new Promise(()=>{}),k=>selected.push(k),()=>pans.push(1),()=>{});
  map.setArea({lat:50,lon:8},50);
  const fire=(type,x,y,id=1)=>listeners[type]({type,pointerId:id,clientX:x,clientY:y,preventDefault(){},deltaY:0});
  return {map,fire,selected,pans};
}
const near=(a,b,eps=1e-6)=>Math.abs(a-b)<eps;
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

  // Zoom bounds, button rounding and anchored zoom.
  const z=rig();assert.equal(z.map.width,300);
  const fitted=z.map.zoom;assert.ok(fitted>=2&&fitted<=13&&Number.isInteger(fitted));
  z.map.zoomTo(40);assert.equal(z.map.zoom,13);z.map.zoomTo(-3);assert.equal(z.map.zoom,2);z.map.zoomTo(NaN);assert.equal(z.map.zoom,2);
  z.map.zoomTo(8.4);z.map.zoomBy(1);assert.equal(z.map.zoom,9);z.map.zoomBy(-1);assert.equal(z.map.zoom,8);
  const before=z.map.geoAt(250,90);z.map.zoomTo(10.3,250,90);const after=z.map.geoAt(250,90);
  assert.ok(near(before.lat,after.lat,1e-9)&&near(before.lon,after.lon,1e-9),'anchor stays under the finger');
  assert.ok(!near(z.map.center.lat,50,1e-6)||!near(z.map.center.lon,8,1e-6),'centre moved to keep the anchor');
  for (const heading of [45, 90, 270]) {
    const rotated = rig(); rotated.map.turn(heading);
    const before = rotated.map.geoAt(245, 80);
    rotated.map.zoomTo(rotated.map.zoom + 1, 245, 80);
    const after = rotated.map.geoAt(245, 80);
    assert.ok(near(before.lat, after.lat, 1e-9) && near(before.lon, after.lon, 1e-9), 'turned anchored zoom preserves geography');
  }
  // Pinch: two pointers spread ×1.5 → +log2(1.5) zoom, no selection, tap state cleared.
  const p=rig();const z0=p.map.zoom, pinchAnchor=p.map.geoAt(150,150);
  p.fire('pointerdown',100,150,1);p.fire('pointerdown',200,150,2);assert.equal(p.map.drag,null);assert.ok(p.map.pinch);
  p.fire('pointermove',250,150,2);assert.ok(near(p.map.zoom,z0+Math.log2(1.5),1e-9));
  const pinchAfter=p.map.geoAt(175,150);
  assert.ok(near(pinchAnchor.lat,pinchAfter.lat,1e-9)&&near(pinchAnchor.lon,pinchAfter.lon,1e-9),'initial geography follows moving pinch midpoint');
  assert.equal(p.pans.length,1,'pinch exposes Search here after moving the centre');
  p.fire('pointerup',250,150,2);assert.equal(p.map.pinch,null);p.fire('pointerup',100,150,1);
  assert.deepEqual(p.selected,[]);assert.ok(near(p.map.zoom,z0+Math.log2(1.5),1e-9));
  // Double tap on empty map zooms one level; a tap near a marker selects instead.
  const d=rig();const zd=d.map.zoom;d.fire('pointerdown',150,150);d.fire('pointerup',150,150);d.fire('pointerdown',152,151);d.fire('pointerup',152,151);
  assert.equal(d.map.zoom,zd+1);assert.equal(d.pans.length,1);
  d.map.hits=[{x:60,y:60,key:'icao:abc123'}];d.fire('pointerdown',70,65);d.fire('pointerup',70,65);assert.deepEqual(d.selected,['icao:abc123']);
  // Follow: the map turns so the heading is up; geometry round-trips under
  // rotation, drags move the map in the turned frame, markers keep their track.
  const tm=rig();const home=tm.map.geoAt(150,150);
  tm.map.turn(90);assert.equal(tm.map.rotation,90);assert.equal(tm.map.follow,true);
  const east=tm.map.xy({lat:50,lon:8.3});
  assert.ok(east.y<150-20&&near(east.x,150,1e-6),'facing east, a point to the east appears at the top');
  const back=tm.map.geoAt(east.x,east.y);assert.ok(near(back.lat,50,1e-6)&&near(back.lon,8.3,1e-6),'xy and geoAt invert under rotation');
  const still=tm.map.geoAt(150,150);assert.ok(near(still.lat,home.lat,1e-9)&&near(still.lon,home.lon,1e-9),'the centre does not move when turning');
  tm.fire('pointerdown',150,150);tm.fire('pointermove',150,100);tm.fire('pointerup',150,100);
  assert.ok(tm.map.center.lon<7.9999&&near(tm.map.center.lat,50,1e-6),'dragging the map up while facing east reveals what is behind you: the centre moves west');
  tm.map.turn(0,false);assert.equal(tm.map.rotation,0);assert.equal(tm.map.follow,false);
  tm.map.turn(370);assert.equal(tm.map.rotation,10);
  const marks=[];tm.map.marker=(x,y,track)=>marks.push(track);tm.map.turn(45);
  tm.map.update([{key:'icao:aaa111',point:{lat:50.05,lon:8.05},track:90,positionTime:Date.now()/1000,altitudeM:1000,speedMps:100,sources:['adsb'],source:'adsb'},{key:'icao:bbb222',point:{lat:50.02,lon:8.02},track:null,positionTime:Date.now()/1000,altitudeM:null,speedMps:null,sources:['adsb'],source:'adsb'}],null);
  assert.deepEqual(marks,[45,null],'symbols keep their ground track relative to the turned map');
  assert.equal(tm.map.hits.length,2);
  const [hx,hy]=[tm.map.hits[0].x,tm.map.hits[0].y];tm.fire('pointerdown',hx+3,hy-2);tm.fire('pointerup',hx+3,hy-2);
  assert.deepEqual(tm.selected.at(-1),'icao:aaa111','taps hit turned markers');
  // Drag pans and never selects.
  const g=rig();g.fire('pointerdown',150,150);g.fire('pointermove',190,150);g.fire('pointerup',190,150);
  assert.ok(g.map.center.lon<8);assert.deepEqual(g.selected,[]);assert.equal(g.pans.length,1);
  // shows/centerOn: area centre visible, a distant point not until centred on.
  const s=rig();assert.ok(s.map.shows({lat:50,lon:8}));assert.ok(!s.map.shows({lat:52,lon:13}));
  s.map.centerOn({lat:52,lon:13});assert.ok(s.map.shows({lat:52,lon:13}));assert.equal(s.map.area.lat,50);assert.equal(s.map.area.lon,8);
  // Fractional zoom still requests integer tile keys only.
  const t=rig();t.map.zoomTo(7.6);for(const key of t.map.wanted)assert.match(key,/^8\/\d+\/\d+$/);
  console.log('6 Sky map interaction checks passed: zoom bounds, anchored zoom, pinch, double tap/select, drag, centre-on and integer tiles.');
})().catch(e=>{console.error(e);process.exitCode=1});
