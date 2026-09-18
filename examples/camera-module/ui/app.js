'use strict';
const $=id=>document.getElementById(id), canvas=$('photo'), ctx=canvas.getContext('2d');
const state={items:[],index:-1,image:null,raster:null,analysis:null,busy:false,generation:0,private:false};
let paintFrame=0;
function fit(iw,ih,w,h){const s=Math.min(w/iw,h/ih);return {x:(w-iw*s)/2,y:(h-ih*s)/2,w:iw*s,h:ih*s};}
function schedulePaint(){if(!paintFrame)paintFrame=requestAnimationFrame(()=>{paintFrame=0;paint();});}
function paint(){
 const r=canvas.getBoundingClientRect(),d=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.max(1,Math.round(r.width*d));canvas.height=Math.max(1,Math.round(r.height*d));ctx.setTransform(d,0,0,d,0,0);ctx.clearRect(0,0,r.width,r.height);
 if(!state.raster)return;const f=fit(state.raster.naturalWidth,state.raster.naturalHeight,r.width,r.height);ctx.drawImage(state.raster,f.x,f.y,f.w,f.h);
 if(!$('overlays').checked||!state.analysis)return;ctx.lineWidth=2;ctx.font='bold 13px sans-serif';
 for(const b of state.analysis.boxes){const x=f.x+b.left*f.w,y=f.y+b.top*f.h,w=(b.right-b.left)*f.w,h=(b.bottom-b.top)*f.h;ctx.strokeStyle='#8ff8b4';ctx.strokeRect(x,y,w,h);const text=b.label+' '+Math.round(b.score*100)+'%',tw=ctx.measureText(text).width+10,tx=Math.max(f.x,Math.min(x,f.x+f.w-tw)),ty=Math.max(f.y+16,y);ctx.fillStyle='#07100c';ctx.fillRect(tx,ty-16,tw,18);ctx.fillStyle='#b3ffcc';ctx.fillText(text,tx+5,ty-2);}
}
function render(){
 document.body.classList.toggle('working',state.busy);$('empty').hidden=!!state.raster;$('empty').style.display=state.raster?'none':'grid';
 for(const id of ['capture','album','pick'])$(id).disabled=state.busy;
 for(const id of ['faces','objects'])$(id).disabled=state.busy||!state.image;
 $('previous').disabled=state.busy||!state.private||state.index<=0;$('next').disabled=state.busy||!state.private||state.index>=state.items.length-1;
 for(const id of ['delete','export'])$(id).disabled=state.busy||!state.private||state.index<0;
 $('clear').disabled=!state.analysis;$('position').textContent=state.private?'Private photo '+(state.index+1)+' of '+state.items.length:state.image?'Selected phone photo':'No photo selected';
 $('results').replaceChildren();if(state.analysis)for(const b of state.analysis.boxes){const li=document.createElement('li');li.textContent=b.label+' · '+Math.round(b.score*100)+'% score';$('results').append(li);}
 schedulePaint();
}
function clearAnalysis(){state.analysis=null;$('summary').textContent='Analysis runs only when you choose.';$('timing').textContent='';}
async function task(message,operation){
 if(state.busy)return;const token=++state.generation;state.busy=true;$('status').textContent=message;render();
 try{await operation(token);}catch(e){if(token===state.generation)$('status').textContent='['+(e.code||'PHOTO_ERROR')+'] '+e.message;}
 finally{if(token===state.generation){state.busy=false;render();}}
}
async function display(data,token){
 const raster=new Image();await new Promise((resolve,reject)=>{raster.onload=resolve;raster.onerror=()=>reject(new Error('Photo could not be displayed'));raster.src=data.url;});
 if(token!==state.generation)return false;state.image=data;state.raster=raster;clearAnalysis();return true;
}
async function openIndex(index,token){
 state.image=null;state.raster=null;state.private=false;clearAnalysis();render();
 const data=await call('photos.library',{op:'open',ref:state.items[index].ref});
 if(await display(data,token)){state.index=index;state.private=true;$('status').textContent='Private photo ready. Original unchanged.';}
}
async function album(token,last=true){
 const data=await call('photos.library',{op:'list'});if(token!==state.generation)return;state.items=data.photos;
 if(!state.items.length){state.index=-1;state.image=null;state.raster=null;state.private=false;clearAnalysis();$('status').textContent='No private photos yet. Take a photo to start.';return;}
 await openIndex(last?state.items.length-1:Math.min(Math.max(state.index,0),state.items.length-1),token);
}
$('album').onclick=()=>task('Opening private album…',t=>album(t));
$('capture').onclick=()=>task('Opening camera…',async t=>{const r=await call('camera.photo',{op:'capture'});if(t!==state.generation)return;if(r.saved)await album(t);else $('status').textContent='Capture canceled. Private photos unchanged.';});
$('pick').onclick=()=>task('Choose a photo…',async t=>{state.image=null;state.raster=null;state.private=false;clearAnalysis();render();const r=await call('image.read',{op:'pick'});if(await display(r,t)){state.private=false;state.index=-1;$('status').textContent='Selected photo ready. It is not copied into the private album.';}});
$('previous').onclick=()=>task('Opening photo…',t=>openIndex(state.index-1,t));$('next').onclick=()=>task('Opening photo…',t=>openIndex(state.index+1,t));
for(const kind of ['faces','objects'])$(kind).onclick=()=>task('Finding '+kind+' on this phone…',async t=>{
 clearAnalysis();const start=performance.now();let previous=start,frames=0,maxGap=0,live=true;
 const tick=now=>{if(!live)return;frames++;maxGap=Math.max(maxGap,now-previous);previous=now;requestAnimationFrame(tick);};requestAnimationFrame(tick);
 try{const result=await call('image.analyze',{op:'detect',handle:state.image.handle,kind});if(t!==state.generation)return;
  state.analysis=result;const elapsed=performance.now()-start;
  window.cameraMetrics={kind,processingMs:result.processingMs,turnaroundMs:elapsed,frames,maxFrameGapMs:maxGap};
  $('summary').textContent=kind[0].toUpperCase()+kind.slice(1)+' found: '+result.boxes.length+' · on-device estimate';
  $('timing').textContent='Local processing: '+Math.round(result.processingMs)+' ms · Ready in '+Math.round(elapsed)+' ms';$('status').textContent='Analysis complete. Original unchanged.';
 }finally{live=false;}
});
$('overlays').onchange=schedulePaint;$('clear').onclick=()=>{clearAnalysis();render();};
for(const op of ['delete','export'])$(op).onclick=()=>task('Waiting for your confirmation…',async t=>{
 const r=await call('photos.library',{op,ref:state.items[state.index].ref});if(t!==state.generation)return;
 if(!r.completed){$('status').textContent='Canceled. Private photo unchanged.';return;}
 if(op==='delete'){state.image=null;state.raster=null;clearAnalysis();await album(t,false);}
 else $('status').textContent='Copy saved to phone gallery. Private original kept.';
});
new ResizeObserver(schedulePaint).observe(canvas);
window.addEventListener('constructvisibilitychange',event=>{if(!event.detail.visible){state.generation++;state.busy=false;clearAnalysis();$('status').textContent='Request interrupted. Choose an action to continue.';render();}});
render();
