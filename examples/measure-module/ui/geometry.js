'use strict';
const Measure = (() => {
  function require(ok, message) { if (!ok) throw new Error(message); }
  const inside = p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1;
  function sideMm(text) {
    const raw = String(text).trim();
    const value = /^[0-9]{1,3}([.,][0-9]{1,2})?$/.test(raw) ? Number(raw.replace(',', '.')) : NaN;
    require(value >= 10 && value <= 300, 'Enter the measured black-square side: 10–300 mm.'); return value;
  }
  class Plane {
    constructor(corners) {
      require(corners.length === 4 && corners.every(inside), 'Marker corners are outside the photo.');
      const crosses = corners.map((a,i) => { const b=corners[(i+1)%4],c=corners[(i+2)%4]; return (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x); });
      require(crosses.every(x=>x>0.00001)||crosses.every(x=>x< -0.00001), 'Use a larger, less angled marker.');
      this.centre={x:corners.reduce((a,p)=>a+p.x,0)/4,y:corners.reduce((a,p)=>a+p.y,0)/4};
      const target=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}],m=[];
      corners.forEach((p,i)=>{ const q=target[i];m.push([p.x,p.y,1,0,0,0,-q.x*p.x,-q.x*p.y,q.x],[0,0,0,p.x,p.y,1,-q.y*p.x,-q.y*p.y,q.y]); });
      for(let col=0;col<8;col++) {
        let pivot=col;for(let r=col+1;r<8;r++)if(Math.abs(m[r][col])>Math.abs(m[pivot][col]))pivot=r;
        require(Math.abs(m[pivot][col])>1e-10,'Marker perspective is too extreme.');
        [m[col],m[pivot]]=[m[pivot],m[col]];const divisor=m[col][col];
        for(let j=col;j<9;j++)m[col][j]/=divisor;
        for(let r=0;r<8;r++)if(r!==col){const f=m[r][col];for(let j=col;j<9;j++)m[r][j]-=f*m[col][j];}
      }
      this.h=m.map(row=>row[8]);
    }
    denominator(p) {return this.h[6]*p.x+this.h[7]*p.y+1;}
    project(p) {
      require(inside(p),'Tap inside the photograph.');const h=this.h,d=this.denominator(p);
      require(Math.abs(d)>1e-6&&d*this.denominator(this.centre)>0,'Point is too far from the reference plane.');
      const q={x:(h[0]*p.x+h[1]*p.y+h[2])/d,y:(h[3]*p.x+h[4]*p.y+h[5])/d};
      require(Number.isFinite(q.x)&&Number.isFinite(q.y)&&Math.abs(q.x)<50&&Math.abs(q.y)<50,'Keep the item near the marker.');return q;
    }
    length(a,b,side) {
      require(Number.isFinite(side)&&side>=10&&side<=300,'Enter a marker side from 10 to 300 mm.');
      require(this.denominator(a)*this.denominator(b)>0,'Measurement crosses an invalid perspective region.');
      const p=this.project(a),q=this.project(b),length=Math.hypot(q.x-p.x,q.y-p.y)*side;
      require(Number.isFinite(length)&&length>=0.1&&length<=5000,'Choose two distinct nearby endpoints.');return length;
    }
  }
  function reference(markers,width,height) {
    const targets=markers.filter(m=>m.id===0);
    require(targets.length===1,targets.length ? 'Use only one reference card in the photo.' : 'No reference marker found. Show all four corners of the supplied card.');
    const corners=targets[0].corners;
    new Plane(corners);
    require(corners.every((p,i)=>Math.hypot((p.x-corners[(i+1)%4].x)*width,(p.y-corners[(i+1)%4].y)*height)>=40),'Move closer: each marker edge must be at least 40 image pixels.');
    return corners;
  }
  class Editor {
    constructor(){this.revision=0;this.reset();}
    reset(){this.revision++;this.plane=null;this.side=null;this.value=null;this.history=[];this.drag=null;}
    calibrate(corners,side){const plane=new Plane(corners);sideMm(String(side));this.reset();this.plane=plane;this.side=side;}
    remember(value){if(this.history.length===10)this.history.shift();this.history.push(value);}
    labelled(a,b){require(this.plane,'Confirm the marker size first.');this.plane.project(a);return {a,b,mm:b?this.plane.length(a,b,this.side):null};}
    check(token){require(token===this.revision,'This photo or calibration has changed.');require(this.plane,'Confirm the marker size first.');}
    place(token,p){this.check(token);require(!this.drag,'Finish the current adjustment first.');require(!this.value?.b,'Drag an endpoint to adjust, or Clear to measure another length.');const next=this.value?this.labelled(this.value.a,p):this.labelled(p,null);this.remember(this.value);this.value=next;}
    begin(token,end){this.check(token);require(!this.drag&&this.value?.[end],'Endpoint is no longer available.');this.drag={end,before:this.value};}
    move(token,p,commit=false){this.check(token);require(this.drag,'Adjustment is no longer active.');const next=this.drag.end==='a'?this.labelled(p,this.value.b):this.labelled(this.value.a,p);this.value=next;if(commit){if(JSON.stringify(next)!==JSON.stringify(this.drag.before))this.remember(this.drag.before);this.drag=null;}}
    cancel(){if(this.drag)this.value=this.drag.before;this.drag=null;}
    undo(){this.cancel();if(this.history.length)this.value=this.history.pop();}
    clear(){this.cancel();if(this.value){this.remember(this.value);this.value=null;}}
    nudge(end,dx,dy,width,height){const p=this.value?.[end];require(p,'Select an existing endpoint.');this.begin(this.revision,end);try{this.move(this.revision,{x:p.x+dx/width,y:p.y+dy/height},true);}catch(e){this.cancel();throw e;}}
  }
  // Magnifier crop for a photo-space point: source rectangle in image pixels plus
  // where that crop lands inside the loupe, so edge crops stay centred on the point.
  function loupe(point,width,height,fitWidth,diameter,magnification){
    require(inside(point)&&width>0&&height>0&&fitWidth>0&&diameter>0&&magnification>0,'Magnifier needs a photo point.');
    const pixelsPerScreen=width/fitWidth;
    const half=diameter/2/magnification*pixelsPerScreen;
    const cx=point.x*width,cy=point.y*height;
    const x=Math.max(0,cx-half),y=Math.max(0,cy-half);
    const w=Math.max(0,Math.min(width,cx+half)-x),h=Math.max(0,Math.min(height,cy+half)-y);
    const scale=diameter/(half*2);
    return {x,y,w,h,scale,dx:(x-(cx-half))*scale,dy:(y-(cy-half))*scale};
  }
  // Loupe centre: lifted above the finger, flipped below near the top, clamped inside the view.
  function loupePlacement(finger,width,height,diameter,lift){
    const r=diameter/2,clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
    const x=clamp(finger.x,r,Math.max(r,width-r));
    const y=clamp(finger.y-lift-r>=0?finger.y-lift:finger.y+lift,r,Math.max(r,height-r));
    return {x,y,r};
  }
  return {Plane,Editor,reference,sideMm,inside,loupe,loupePlacement};
})();
if (typeof module !== 'undefined') module.exports = Measure;
