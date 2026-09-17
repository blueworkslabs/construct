'use strict';
(() => {
  const el=id=>document.getElementById(id),canvas=el('photo'),ctx=canvas.getContext('2d'),editor=new Measure.Editor();
  let selected=null,image=null,corners=[],busy=false,epoch=0,visible=true,endpoint=null;
  let zoom=1,offset={x:0,y:0},gesture=null;const pointers=new Map();
  const dimensions=()=>({w:canvas.clientWidth,h:canvas.clientHeight});
  function fit(){const {w,h}=dimensions();if(!selected)return {x:0,y:0,w:0,h:0};const scale=Math.min(w/selected.width,h/selected.height)*zoom;return {x:(w-selected.width*scale)/2+offset.x,y:(h-selected.height*scale)/2+offset.y,w:selected.width*scale,h:selected.height*scale};}
  function point(p){const f=fit();return {x:(p.x-f.x)/f.w,y:(p.y-f.y)/f.h};}
  function screen(p){const f=fit();return {x:f.x+p.x*f.w,y:f.y+p.y*f.h};}
  function position(event){const r=canvas.getBoundingClientRect();return {x:event.clientX-r.left,y:event.clientY-r.top};}
  function expanded(value){el('controls').hidden=!value;el('panel').classList.toggle('collapsed',!value);el('expand').textContent=value?'Hide controls':'Show controls';el('expand').setAttribute('aria-expanded',String(value));}
  function fail(error){const message=error.code==='CAPABILITY_DENIED'?'Allow selected image pixels and local marker detection in Module access, then reopen.':(error.message||'Could not complete this action.');el('error').textContent=(error.code?'['+error.code+'] ':'')+message;el('error').hidden=false;expanded(true);}
  function clearError(){el('error').hidden=true;el('error').textContent='';}
  function run(action){try{action();clearError();}catch(error){fail(error);}render();}
  function clampView(){const {w,h}=dimensions(),f=fit();offset.x=Math.max(-Math.max(0,(f.w-w)/2),Math.min(Math.max(0,(f.w-w)/2),offset.x));offset.y=Math.max(-Math.max(0,(f.h-h)/2),Math.min(Math.max(0,(f.h-h)/2),offset.y));}
  function draw(){
    const {w,h}=dimensions(),ratio=Math.min(window.devicePixelRatio||1,3);
    if(canvas.width!==Math.round(w*ratio)||canvas.height!==Math.round(h*ratio)){canvas.width=Math.round(w*ratio);canvas.height=Math.round(h*ratio);}
    ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,w,h);if(!image)return;
    const f=fit();ctx.drawImage(image,f.x,f.y,f.w,f.h);
    if(corners.length){ctx.strokeStyle='#5be3b0';ctx.lineWidth=2;ctx.beginPath();corners.forEach((p,i)=>{const q=screen(p);if(i)ctx.lineTo(q.x,q.y);else ctx.moveTo(q.x,q.y);});ctx.closePath();ctx.stroke();}
    const value=editor.value;if(!value)return;
    if(value.b){const a=screen(value.a),b=screen(value.b);ctx.strokeStyle='#0b1410';ctx.lineWidth=7;ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();ctx.strokeStyle='#64d7a7';ctx.lineWidth=3;ctx.stroke();}
    for(const end of ['a','b'])if(value[end]){const p=screen(value[end]);ctx.beginPath();ctx.arc(p.x,p.y,endpoint===end?11:8,0,Math.PI*2);ctx.fillStyle='#64d7a7';ctx.fill();ctx.strokeStyle='#09170f';ctx.lineWidth=3;ctx.stroke();ctx.font='bold 16px system-ui';ctx.lineWidth=4;ctx.strokeText(end.toUpperCase(),p.x+14,p.y-12);ctx.fillStyle='#fff';ctx.fillText(end.toUpperCase(),p.x+14,p.y-12);}
  }
  function render(){
    const value=editor.value,calibrated=editor.side!==null;
    if(endpoint&&!value?.[endpoint])endpoint=null;
    const units=el('units').value;
    el('result').textContent=value?.mm!=null?'Length: '+(units==='mm'?value.mm:value.mm/10).toFixed(1)+' '+units:'No length yet';
    el('status').textContent=busy?'Reading photo and finding reference marker…':!image?'Choose one saved photo. Nothing is saved or sent online.':!calibrated?corners.length?'Reference found. Enter its measured black-square side.':'Choose a photo containing the reference card.':!value?'Tap the two ends of a length in the photo.':!value.b?'First endpoint set. Tap the other end.':'Drag an endpoint to adjust, or Clear for another length.';
    el('choose').disabled=busy||!visible;el('retry').hidden=!image||corners.length>0;el('retry').disabled=busy||!visible;
    el('setup').hidden=!corners.length||calibrated;el('calibrate').hidden=!calibrated;el('confirm').disabled=busy||!visible;
    el('calibration').textContent=calibrated?'Marker '+editor.side+' mm ✓':'';
    el('undo').disabled=!editor.history.length||busy||!visible;el('clear').disabled=!value||busy||!visible;
    el('adjust').disabled=!value||busy||!visible;el('select-b').disabled=!value?.b;
    for(const end of ['a','b'])el('select-'+end).setAttribute('aria-pressed',String(endpoint===end));
    for(const direction of ['left','up','down','right'])el(direction).disabled=!endpoint;
    el('placeholder').hidden=!!image;el('reset').hidden=!image;
    draw();
  }
  function cancelGesture(){editor.cancel();gesture=null;pointers.clear();draw();}
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
  el('setup').onsubmit=event=>{event.preventDefault();run(()=>{cancelGesture();editor.calibrate(corners,Measure.sideMm(el('side').value));endpoint=null;expanded(false);});};
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
    if(near&&near.d<=26){run(()=>editor.begin(editor.revision,near.end));endpoint=near.end;gesture={type:'endpoint',start:p,token:editor.revision,last:p};}
    else gesture={type:'tap',start:p,last:p,offset:{...offset}};
  };
  canvas.onpointermove=event=>{
    if(!pointers.has(event.pointerId)||!gesture)return;const p=position(event);pointers.set(event.pointerId,p);
    if(gesture.type==='pinch'&&pointers.size>=2){const now=pinchState(),old=gesture;zoom=Math.max(1,Math.min(8,old.zoom*now.distance/old.distance));const {w,h}=dimensions(),ratio=zoom/old.zoom;offset={x:now.centre.x-w/2-(old.centre.x-w/2-old.offset.x)*ratio,y:now.centre.y-h/2-(old.centre.y-h/2-old.offset.y)*ratio};clampView();draw();return;}
    if(gesture.type==='endpoint'){gesture.last=p;try{editor.move(gesture.token,point(p));clearError();}catch(error){el('error').textContent=error.message;el('error').hidden=false;}render();return;}
    if(gesture.type==='tap'&&Math.hypot(p.x-gesture.start.x,p.y-gesture.start.y)>8)gesture.type='pan';
    if(gesture.type==='pan'){offset={x:gesture.offset.x+p.x-gesture.start.x,y:gesture.offset.y+p.y-gesture.start.y};clampView();draw();}
  };
  canvas.onpointerup=event=>{
    if(!pointers.has(event.pointerId))return;const p=position(event),old=gesture;pointers.delete(event.pointerId);
    if(old?.type==='endpoint'){try{editor.move(old.token,point(p),true);clearError();}catch(error){editor.cancel();fail(error);}}
    else if(old?.type==='tap'&&editor.plane)run(()=>editor.place(editor.revision,point(p)));
    gesture=null;if(pointers.size)gesture={type:'ignore'};render();
  };
  canvas.onpointercancel=()=>{cancelGesture();clearError();render();};
  new ResizeObserver(()=>{cancelGesture();zoom=1;offset={x:0,y:0};draw();}).observe(el('viewport'));
  window.addEventListener('constructvisibilitychange',event=>{
    visible=event.detail.visible;cancelGesture();
    // Picker handoff pauses natively without this menu event. A real menu cancels work.
    if(!visible){epoch++;busy=false;clearError();}
    render();
  });
  render();
})();
