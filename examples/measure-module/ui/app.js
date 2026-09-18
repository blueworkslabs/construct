'use strict';
(() => {
  const el=id=>document.getElementById(id),canvas=el('photo'),ctx=canvas.getContext('2d'),editor=new Measure.Editor();
  let selected=null,image=null,corners=[],busy=false,epoch=0,visible=true,endpoint=null;
  let zoom=1,offset={x:0,y:0},gesture=null,frame=0;const pointers=new Map();
  // Construct tokens; the same values as construct-ui.css. Dark under-strokes keep marks readable on any photo.
  const ink={jade:'#5FD3A0',focus:'#8CF0C4',text:'#E6F0EA',dark:'#06110B',error:'#F08A7E',surface:'#122019'};
  const LOUPE_MAGNIFICATION=2.5,HANDLE_HIT=26,TAP_SLOP=8;
  const dimensions=()=>({w:canvas.clientWidth,h:canvas.clientHeight});
  function fit(){const {w,h}=dimensions();if(!selected)return {x:0,y:0,w:0,h:0};const scale=Math.min(w/selected.width,h/selected.height)*zoom;return {x:(w-selected.width*scale)/2+offset.x,y:(h-selected.height*scale)/2+offset.y,w:selected.width*scale,h:selected.height*scale};}
  function point(p){const f=fit();return {x:(p.x-f.x)/f.w,y:(p.y-f.y)/f.h};}
  function screen(p){const f=fit();return {x:f.x+p.x*f.w,y:f.y+p.y*f.h};}
  function position(event){const r=canvas.getBoundingClientRect();return {x:event.clientX-r.left,y:event.clientY-r.top};}
  function format(mm){const units=el('units').value;return (units==='mm'?mm:mm/10).toFixed(1)+' '+units;}
  function expanded(value){el('controls').hidden=!value;el('panel').classList.toggle('collapsed',!value);el('expand').textContent=value?'Hide controls':'Show controls';el('expand').setAttribute('aria-expanded',String(value));}
  function fail(error){const message=error.code==='CAPABILITY_DENIED'?'Allow selected image pixels and local marker detection in Module access, then reopen.':(error.message||'Could not complete this action.');el('error').textContent=(error.code?'['+error.code+'] ':'')+message;el('error').hidden=false;expanded(true);}
  function clearError(){el('error').hidden=true;el('error').textContent='';}
  function run(action){try{action();clearError();}catch(error){fail(error);}render();}
  function clampView(){const {w,h}=dimensions(),f=fit();offset.x=Math.max(-Math.max(0,(f.w-w)/2),Math.min(Math.max(0,(f.w-w)/2),offset.x));offset.y=Math.max(-Math.max(0,(f.h-h)/2),Math.min(Math.max(0,(f.h-h)/2),offset.y));}
  // Coalesce pointer-driven redraws to one per frame; state changes still update the DOM immediately.
  function paint(){if(frame)return;const raf=window.requestAnimationFrame;if(typeof raf==='function')frame=raf.call(window,()=>{frame=0;draw();});else draw();}
  function pill(text,x,y,colour,size){
    ctx.font='bold '+size+'px system-ui, sans-serif';ctx.textBaseline='middle';ctx.textAlign='center';
    const measured=ctx.measureText(text),width=((measured&&measured.width)||text.length*size*0.6)+size*0.9,height=size*1.6,r=height/2;
    ctx.beginPath();ctx.moveTo(x-width/2+r,y-height/2);ctx.arcTo(x+width/2,y-height/2,x+width/2,y+height/2,r);ctx.arcTo(x+width/2,y+height/2,x-width/2,y+height/2,r);ctx.arcTo(x-width/2,y+height/2,x-width/2,y-height/2,r);ctx.arcTo(x-width/2,y-height/2,x+width/2,y-height/2,r);ctx.closePath();
    ctx.fillStyle='rgba(6,17,11,.82)';ctx.fill();ctx.fillStyle=colour;ctx.fillText(text,x,y);ctx.textAlign='start';ctx.textBaseline='alphabetic';
  }
  function handle(p,label,other,selectedEnd){
    // Label sits on the side away from the line, so neither the line nor the finger covers it.
    const dx=other?p.x-other.x:0,dy=other?p.y-other.y:-1,len=Math.hypot(dx,dy)||1,ux=dx/len,uy=dy/len;
    if(selectedEnd){ctx.beginPath();ctx.arc(p.x,p.y,15,0,Math.PI*2);ctx.strokeStyle=ink.focus;ctx.lineWidth=2;ctx.stroke();}
    ctx.beginPath();ctx.arc(p.x,p.y,8,0,Math.PI*2);ctx.fillStyle=ink.jade;ctx.fill();ctx.strokeStyle=ink.dark;ctx.lineWidth=3;ctx.stroke();
    ctx.beginPath();ctx.arc(p.x,p.y,2.2,0,Math.PI*2);ctx.fillStyle=ink.dark;ctx.fill();
    pill(label,p.x+ux*22,p.y+uy*22,ink.jade,13);
  }
  // The magnifier is drawing only: it reads the decoded image already in memory and never changes a point.
  function magnifier(centrePoint,finger,valid,other){
    const {w,h}=dimensions(),f=fit();
    const diameter=Math.max(72,Math.min(128,Math.floor(Math.min(w,h)*0.42))),lift=Math.round(diameter*0.72);
    const place=Measure.loupePlacement(finger,w,h,diameter,lift),crop=Measure.loupe(centrePoint,selected.width,selected.height,f.w,diameter,LOUPE_MAGNIFICATION);
    ctx.save();ctx.beginPath();ctx.arc(place.x,place.y,place.r,0,Math.PI*2);ctx.closePath();
    ctx.lineWidth=6;ctx.strokeStyle='rgba(6,17,11,.55)';ctx.stroke();
    ctx.clip();ctx.fillStyle=ink.surface;ctx.fillRect(place.x-place.r,place.y-place.r,diameter,diameter);
    if(crop.w>0&&crop.h>0)ctx.drawImage(image,crop.x,crop.y,crop.w,crop.h,place.x-place.r+crop.dx,place.y-place.r+crop.dy,crop.w*crop.scale,crop.h*crop.scale);
    if(other){const o=screen(other),c=screen(centrePoint);ctx.beginPath();ctx.moveTo(place.x,place.y);ctx.lineTo(place.x+(o.x-c.x)*LOUPE_MAGNIFICATION,place.y+(o.y-c.y)*LOUPE_MAGNIFICATION);ctx.strokeStyle='rgba(6,17,11,.6)';ctx.lineWidth=5;ctx.stroke();ctx.strokeStyle=ink.jade;ctx.lineWidth=2;ctx.stroke();}
    const arm=place.r*0.7,tone=valid?ink.jade:ink.error;
    for(const [colour,width] of [['rgba(6,17,11,.65)',3],[tone,1]]){ctx.strokeStyle=colour;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(place.x-arm,place.y);ctx.lineTo(place.x+arm,place.y);ctx.moveTo(place.x,place.y-arm);ctx.lineTo(place.x,place.y+arm);ctx.stroke();}
    ctx.beginPath();ctx.arc(place.x,place.y,5,0,Math.PI*2);ctx.strokeStyle=tone;ctx.lineWidth=1.5;ctx.stroke();
    ctx.restore();
    ctx.beginPath();ctx.arc(place.x,place.y,place.r,0,Math.PI*2);ctx.strokeStyle=ink.text;ctx.lineWidth=2;ctx.stroke();
  }
  function draw(){
    const {w,h}=dimensions(),ratio=Math.min(window.devicePixelRatio||1,3);
    if(canvas.width!==Math.round(w*ratio)||canvas.height!==Math.round(h*ratio)){canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);}
    ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);if(!image)return;
    const f=fit();ctx.drawImage(image,f.x,f.y,f.w,f.h);
    if(corners.length){ctx.beginPath();corners.forEach((p,i)=>{const q=screen(p);if(i)ctx.lineTo(q.x,q.y);else ctx.moveTo(q.x,q.y);});ctx.closePath();ctx.strokeStyle='rgba(6,17,11,.7)';ctx.lineWidth=4;ctx.stroke();ctx.setLineDash([6,5]);ctx.strokeStyle=ink.jade;ctx.lineWidth=2;ctx.stroke();ctx.setLineDash([]);}
    const value=editor.value;
    if(value){
      const a=screen(value.a),b=value.b?screen(value.b):null;
      if(b){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.strokeStyle=ink.dark;ctx.lineWidth=7;ctx.stroke();ctx.strokeStyle=ink.jade;ctx.lineWidth=3;ctx.stroke();
        // Length pill pushed off the line, perpendicular, toward the top when possible.
        const nx=-(b.y-a.y),ny=b.x-a.x,len=Math.hypot(nx,ny)||1,sign=ny/len<0?1:-1;
        if(value.mm!=null)pill(format(value.mm),(a.x+b.x)/2+nx/len*22*sign,(a.y+b.y)/2+ny/len*22*sign,ink.text,14);}
      handle(a,'A',b,endpoint==='a');if(b)handle(b,'B',a,endpoint==='b');
    }
    if(gesture&&gesture.loupe){
      if(gesture.type==='endpoint'&&value?.[gesture.end])magnifier(value[gesture.end],gesture.last,true,value[gesture.end==='a'?'b':'a']);
      else if(gesture.type==='tap'||gesture.type==='place'){const p=point(gesture.last);let valid=Measure.inside(p);if(valid)try{editor.plane.project(p);}catch{valid=false;}magnifier({x:Math.max(0,Math.min(1,p.x)),y:Math.max(0,Math.min(1,p.y))},gesture.last,valid,value?.a||null);}
    }
  }
  function render(){
    const value=editor.value,calibrated=editor.side!==null;
    if(endpoint&&!value?.[endpoint])endpoint=null;
    el('result').textContent=value?.mm!=null?'Length: '+format(value.mm):'No length yet';
    el('step').textContent=busy?'Reading photo':!image?'Step 1 of 3 · Photo':!calibrated?'Step 2 of 3 · Reference size':'Step 3 of 3 · Endpoints';
    el('status').textContent=busy?'Reading photo and finding reference marker…':!image?'Choose one saved photo. Nothing is saved or sent online.':!calibrated?corners.length?'Reference found. Enter its measured black-square side.':'Choose a photo containing the reference card.':!value?'Tap the two ends of a length in the photo.':!value.b?'First endpoint set. Tap the other end.':'Drag an endpoint to adjust, or Clear for another length.';
    el('choose').disabled=busy||!visible;el('retry').hidden=!image||corners.length>0;el('retry').disabled=busy||!visible;
    el('setup').hidden=!corners.length||calibrated;el('calibrate').hidden=!calibrated;el('confirm').disabled=busy||!visible;
    el('calibration').textContent=calibrated?'Marker '+editor.side+' mm ✓':'';
    el('undo').disabled=!editor.history.length||busy||!visible;el('clear').disabled=!value||busy||!visible;
    el('adjust').disabled=!value||busy||!visible;el('select-b').disabled=!value?.b;
    for(const end of ['a','b'])el('select-'+end).setAttribute('aria-pressed',String(endpoint===end));
    for(const direction of ['left','up','down','right'])el(direction).disabled=!endpoint;
    el('placeholder').hidden=!!image;el('reset').hidden=!image||zoom<=1;el('reset').textContent='Reset view · '+zoom.toFixed(1)+'×';
    paint();
  }
  function cancelGesture(){
    const captured=[...pointers.keys()];editor.cancel();gesture=null;pointers.clear();
    // A touch-only cancellation may also omit the browser's capture cleanup.
    // Clear our transaction first so lostcapture cannot re-enter an active edit.
    for(const id of captured){try{canvas.releasePointerCapture(id);}catch{}}
    paint();
  }
  async function detect(token){
    const result=await call('image.markers',{op:'detect',handle:selected.handle,dictionary:'DICT_4X4_50'});
    if(token!==epoch||!visible)return;
    corners=Measure.reference(result.markers,selected.width,selected.height);expanded(true);
  }
  el('choose').onclick=async()=>{
    const token=++epoch;cancelGesture();editor.reset();selected=null;image=null;corners=[];endpoint=null;el('side').value='';busy=true;zoom=1;offset={x:0,y:0};clearError();expanded(true);render();
    try {
      const next=await call('image.read',{op:'pick'});if(token!==epoch)return;
      selected=next;
      const decoded=await new Promise((resolve,reject)=>{const picture=new Image();picture.onload=()=>resolve(picture);picture.onerror=()=>reject(new Error('Image is no longer available. Choose it again.'));picture.src=next.url;});
      if(token!==epoch)return;
      image=decoded;
      await detect(token);
    } catch(error){if(token===epoch)fail(error);}
    finally {if(token===epoch){busy=false;render();}}
  };
  el('retry').onclick=async()=>{const token=++epoch;busy=true;clearError();render();try{await detect(token);}catch(error){if(token===epoch)fail(error);}finally{if(token===epoch){busy=false;render();}}};
  el('setup').onsubmit=event=>{event.preventDefault();run(()=>{cancelGesture();editor.calibrate(corners,Measure.sideMm(el('side').value));el('side').blur();endpoint=null;expanded(false);});};
  el('side').oninput=()=>{cancelGesture();editor.reset();endpoint=null;clearError();render();};
  el('calibrate').onclick=()=>run(()=>{cancelGesture();editor.reset();endpoint=null;expanded(true);});
  el('expand').onclick=()=>{cancelGesture();expanded(el('controls').hidden);render();};
  el('units').onchange=()=>{cancelGesture();render();};
  el('undo').onclick=()=>run(()=>{cancelGesture();editor.undo();});el('clear').onclick=()=>run(()=>{cancelGesture();editor.clear();endpoint=null;});
  for(const end of ['a','b'])el('select-'+end).onclick=()=>run(()=>{cancelGesture();endpoint=end;});
  for(const [name,dx,dy] of [['left',-1,0],['right',1,0],['up',0,-1],['down',0,1]])el(name).onclick=()=>run(()=>{cancelGesture();editor.nudge(endpoint,dx,dy,selected.width,selected.height);});
  el('reset').onclick=()=>run(()=>{cancelGesture();zoom=1;offset={x:0,y:0};});
  function pinchState(){const [a,b]=[...pointers.values()];return {distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),centre:{x:(a.x+b.x)/2,y:(a.y+b.y)/2}};}
  canvas.onpointerdown=event=>{
    if(!image||busy||!visible)return;event.preventDefault();canvas.setPointerCapture(event.pointerId);const p=position(event);pointers.set(event.pointerId,p);
    if(pointers.size===2){editor.cancel();const state=pinchState();gesture={type:'pinch',...state,zoom,offset:{...offset}};render();return;}
    if(pointers.size>2)return;
    const near=['a','b'].filter(end=>editor.value?.[end]).map(end=>({end,d:Math.hypot(screen(editor.value[end]).x-p.x,screen(editor.value[end]).y-p.y)})).sort((a,b)=>a.d-b.d)[0];
    if(near&&near.d<=HANDLE_HIT){run(()=>editor.begin(editor.revision,near.end));endpoint=near.end;gesture={type:'endpoint',end:near.end,start:p,token:editor.revision,last:p,loupe:!!editor.drag};}
    else {
      // A press on empty photo previews the next endpoint in the magnifier; release places it.
      const placing=!!editor.plane&&!editor.value?.b;
      gesture={type:'tap',start:p,last:p,offset:{...offset},loupe:placing};
    }
    paint();
  };
  canvas.onpointermove=event=>{
    if(!pointers.has(event.pointerId)||!gesture)return;const p=position(event);pointers.set(event.pointerId,p);
    if(gesture.type==='pinch'&&pointers.size>=2){const now=pinchState(),old=gesture;zoom=Math.max(1,Math.min(8,old.zoom*now.distance/old.distance));const {w,h}=dimensions(),ratio=zoom/old.zoom;offset={x:now.centre.x-w/2-(old.centre.x-w/2-old.offset.x)*ratio,y:now.centre.y-h/2-(old.centre.y-h/2-old.offset.y)*ratio};clampView();paint();return;}
    if(gesture.type==='endpoint'){gesture.last=p;try{editor.move(gesture.token,point(p));clearError();}catch(error){el('error').textContent=error.message;el('error').hidden=false;}render();return;}
    if(gesture.type==='tap'&&Math.hypot(p.x-gesture.start.x,p.y-gesture.start.y)>TAP_SLOP){
      // Zoomed in, a drag pans. At fit there is nothing to pan, so the drag keeps previewing the endpoint.
      if(zoom>1){gesture.type='pan';gesture.loupe=false;}else if(gesture.loupe)gesture.type='place';
    }
    gesture.last=p;
    if(gesture.type==='pan'){offset={x:gesture.offset.x+p.x-gesture.start.x,y:gesture.offset.y+p.y-gesture.start.y};clampView();}
    paint();
  };
  canvas.onpointerup=event=>{
    if(!pointers.has(event.pointerId))return;const p=position(event),old=gesture;pointers.delete(event.pointerId);
    if(old?.type==='endpoint'){try{editor.move(old.token,point(p),true);clearError();}catch(error){editor.cancel();fail(error);}}
    else if((old?.type==='tap'||old?.type==='place')&&editor.plane)run(()=>editor.place(editor.revision,point(p)));
    gesture=null;if(pointers.size)gesture={type:'ignore'};render();
  };
  const cancelInput=()=>{cancelGesture();clearError();render();};
  canvas.onpointercancel=cancelInput;
  // Some Android WebViews emit touchcancel without pointercancel. Neither a
  // cancelled touch nor lost capture may leave a preview waiting for release.
  canvas.ontouchcancel=cancelInput;
  canvas.onlostpointercapture=()=>{if(gesture)cancelInput();};
  new ResizeObserver(()=>{cancelGesture();zoom=1;offset={x:0,y:0};render();}).observe(el('viewport'));
  window.addEventListener('constructvisibilitychange',event=>{
    visible=event.detail.visible;cancelGesture();
    // Picker handoff pauses natively without this menu event. A real menu cancels work.
    if(!visible){epoch++;busy=false;clearError();}
    render();
  });
  render();
})();
