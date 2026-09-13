'use strict';
const el=id=>document.getElementById(id),canvas=el('board'),ctx=canvas.getContext('2d');
let game=SnakeModel.fresh(),previous=game,playing=false,saving=false,fault=false,loading=true,queuedTurn=null;
let lastStep=0,animationStart=0,gesture=null,raf=0,pulse=null,newBest=false,shownScore=0;
const motionPreference=window.matchMedia?window.matchMedia('(prefers-reduced-motion: reduce)'):null;
const reducedMotion=()=>Boolean(motionPreference&&motionPreference.matches);
if(motionPreference)motionPreference.addEventListener('change',()=>{if(reducedMotion())pulse=null;draw(performance.now());});
const seed=()=>Math.floor(Math.random()*4294967296);
// Visual-only helpers. Every one of them is a no-op when the element has no classList (test harness).
function flash(id,cls){const list=el(id).classList;if(!list)return;list.remove(cls);void el(id).offsetWidth;list.add(cls);}
function mark(id,cls,on){const list=el(id).classList;if(list)list.toggle(cls,on);}
function label() {
  const head=game.snake[0];
  canvas.setAttribute('aria-label',`Game board. Head ${head[0]+1}, ${head[1]+1}. Facing ${game.direction}. Moves ${game.moves}.`);
  el('score').textContent='Score '+game.score;el('best').textContent='Best '+game.best;
  if(game.score!==shownScore){if(game.score>shownScore)flash('score','pop');shownScore=game.score;}
  mark('best','best-new',newBest);
  el('play').textContent=game.moves?'Resume':'Play';
  el('play').disabled=loading||fault||saving||playing||game.mode!=='alive';
  el('pause').disabled=!playing;
  el('new').disabled=loading||fault||saving||playing;
  for(const d of Object.keys(SnakeModel.vectors))el(d).disabled=!playing||fault;
  el('retry').disabled=loading||saving;el('discard').disabled=loading||saving;
  el('overlay').hidden=playing&&!fault;
  const over=game.mode==='over',won=game.mode==='won';
  el('overlay-text').textContent=loading?'Loading…':fault?'Save unavailable':over?'Game over':won?'Board cleared!':game.moves?'Paused':'Ready?';
  el('overlay-sub').textContent=loading?'':fault?'Check Module access, then retry':over?`Score ${game.score}`+(newBest?' · New best!':''):won?'A perfect run':game.moves?'Tap the board or Resume':'Tap the board or Play';
}
function roundRect(x,y,w,h,r) {
  ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();
}
function draw(now) {
  const bounds=canvas.getBoundingClientRect(),ratio=Math.min(window.devicePixelRatio||1,2),width=Math.max(1,Math.round(bounds.width*ratio));
  if(canvas.width!==width||canvas.height!==width){canvas.width=width;canvas.height=width;}
  const size=SnakeModel.size,unit=width/size;
  ctx.fillStyle='#172d29';ctx.fillRect(0,0,width,width);
  ctx.fillStyle='#1b3330';
  for(let y=0;y<size;y++)for(let x=(y%2);x<size;x+=2)ctx.fillRect(x*unit,y*unit,unit,unit);
  if(pulse&&!reducedMotion()){
    const t=(now-pulse.start)/280;
    if(t>=1)pulse=null;
    else{ctx.strokeStyle=`rgba(246,186,114,${1-t})`;ctx.lineWidth=unit*.12;ctx.beginPath();ctx.arc((pulse.x+.5)*unit,(pulse.y+.5)*unit,unit*(.35+t*.9),0,Math.PI*2);ctx.stroke();}
  }
  if(game.food){
    const[x,y]=game.food,cx=(x+.5)*unit,cy=(y+.5)*unit,r=unit*(.32+(playing&&!reducedMotion()?Math.sin(now/160)*.025:0));
    ctx.fillStyle='#f0655a';ctx.beginPath();ctx.arc(cx,cy+unit*.03,r,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#ffffff55';ctx.beginPath();ctx.arc(cx-r*.35,cy-r*.35,r*.28,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#8bcba0';ctx.beginPath();ctx.ellipse(cx+r*.25,cy-r*.85,r*.36,r*.18,-.7,0,Math.PI*2);ctx.fill();
  }
  const blend=playing&&!reducedMotion()?Math.min(1,Math.max(0,(now-animationStart)/80)):1;
  const points=game.snake.map((cell,i)=>{
    const from=previous.snake[Math.min(i,previous.snake.length-1)]||cell;
    return [(from[0]+(cell[0]-from[0])*blend+.5)*unit,(from[1]+(cell[1]-from[1])*blend+.5)*unit];
  });
  const len=points.length,dead=game.mode==='over';
  ctx.lineCap='round';ctx.lineJoin='round';
  for(let i=len-1;i>0;i--){
    const shade=Math.round(200-90*(i/len));
    ctx.strokeStyle=dead?`rgb(${shade-40},${shade-60},${shade-70})`:`rgb(${Math.round(shade*.55)},${shade},${Math.round(shade*.72)})`;
    ctx.lineWidth=unit*(.74-.28*(i/len));
    ctx.beginPath();ctx.moveTo(points[i][0],points[i][1]);ctx.lineTo(points[i-1][0],points[i-1][1]);ctx.stroke();
  }
  const[hx,hy]=points[0],[dx,dy]=SnakeModel.vectors[game.direction],px=-dy,py=dx,hr=unit*.42;
  ctx.fillStyle=dead?'#d9776c':'#e3f7b0';roundRect(hx-hr,hy-hr,hr*2,hr*2,hr*.55);ctx.fill();
  for(const s of[-1,1]){
    const ex=hx+(dx*.14+px*s*.18)*unit,ey=hy+(dy*.14+py*s*.18)*unit;
    ctx.fillStyle='#ffffff';ctx.beginPath();ctx.arc(ex,ey,unit*.1,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#173126';ctx.beginPath();
    if(dead){ctx.lineWidth=unit*.05;ctx.strokeStyle='#173126';ctx.moveTo(ex-unit*.06,ey-unit*.06);ctx.lineTo(ex+unit*.06,ey+unit*.06);ctx.moveTo(ex+unit*.06,ey-unit*.06);ctx.lineTo(ex-unit*.06,ey+unit*.06);ctx.stroke();}
    else{ctx.arc(ex+dx*unit*.03,ey+dy*unit*.03,unit*.05,0,Math.PI*2);ctx.fill();}
  }
}
function fail(error) {
  playing=false;queuedTurn=null;fault=true;el('retry').hidden=false;
  el('status').textContent='Saving unavailable ['+(error.code||'STORAGE_ERROR')+']. Paused; check Module access, then retry.';label();
}
async function persist(next,message) {
  saving=true;label();
  try {
    await call('storage.kv',{op:'set',key:'game',value:next});
    if(!reducedMotion()&&next.score>game.score&&game.food)pulse={x:game.food[0],y:game.food[1],start:performance.now()};
    if(next.score>game.best&&next.score>0)newBest=true;
    if(message)newBest=false;
    previous=game;game=next;animationStart=performance.now();
    if(game.mode!=='alive'){playing=false;queuedTurn=null;}
    if(game.mode==='over')flash('board-wrap','shake');
    if(message)el('status').textContent=message;
    else if(game.mode==='over')el('status').textContent=newBest?'Game over. New best score saved!':'Game over. Best score saved.';
    else if(game.mode==='won')el('status').textContent='All fruit collected. Best score saved.';
    return true;
  } catch(error){fail(error);return false;}
  finally {saving=false;label();draw(performance.now());}
}
function pause(message='Paused. Reopen or Resume when ready.') {
  playing=false;queuedTurn=null;el('status').textContent=message;label();draw(performance.now());
}
function turn(direction) {
  if(!playing||fault||queuedTurn!==null||!SnakeModel.canTurn(game,direction))return;
  queuedTurn=direction;
}
async function load() {
  if(saving)return;
  loading=true;playing=false;queuedTurn=null;fault=false;newBest=false;el('retry').hidden=true;el('repair').hidden=true;el('confirm').hidden=true;label();
  try {
    const saved=await call('storage.kv',{op:'get',key:'game'});
    if(saved!==null&&!SnakeModel.valid(saved)){fault=true;el('repair').hidden=false;el('status').textContent='Unsupported saved game. Nothing was changed.';return;}
    game=saved||SnakeModel.fresh(seed());previous=game;shownScore=game.score;
    el('status').textContent=saved?'Saved game loaded; paused.':'Ready when you are. Moves save on this phone.';
  }catch(error){fail(error);}
  finally {loading=false;label();draw(performance.now());}
}
function start() {
  if(loading||saving||fault||game.mode!=='alive'||playing)return;
  playing=true;queuedTurn=null;previous=game;lastStep=performance.now();el('status').textContent='Playing. Moves and best score save on this phone.';label();
}
el('play').onclick=start;
el('pause').onclick=()=>pause();
el('new').onclick=()=>{if(!playing&&!saving&&!loading&&!fault)persist(SnakeModel.fresh(seed(),game.best),'New game ready. Best score kept.');};
for(const d of Object.keys(SnakeModel.vectors))el(d).onclick=()=>turn(d);
window.addEventListener('keydown',event=>{
  const direction={ArrowUp:'up',ArrowDown:'down',ArrowLeft:'left',ArrowRight:'right'}[event.key];
  if(direction){event.preventDefault();turn(direction);}
  else if(event.key===' '){event.preventDefault();if(playing)pause();else start();}
});
canvas.addEventListener('pointerdown',event=>{if(!event.isPrimary)return;gesture={id:event.pointerId,x:event.clientX,y:event.clientY};canvas.setPointerCapture(event.pointerId);});
canvas.addEventListener('pointerup',event=>{
  if(!gesture||gesture.id!==event.pointerId)return;
  const dx=event.clientX-gesture.x,dy=event.clientY-gesture.y;gesture=null;
  if(Math.max(Math.abs(dx),Math.abs(dy))<14){if(!playing)start();return;}
  turn(Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up'));
});
canvas.addEventListener('pointercancel',()=>{gesture=null;});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible')pause('Paused after leaving the game.');});
window.addEventListener('constructvisibilitychange',event=>{if(!event.detail.visible)pause('Paused for Construct menu. Resume when ready.');});
window.addEventListener('resize',()=>{if(playing)pause('Paused after resizing. Resume when ready.');draw(performance.now());});
el('retry').onclick=()=>{if(!loading&&!saving)load();};
el('discard-open').onclick=()=>{el('confirm').hidden=false;};el('keep').onclick=()=>{el('confirm').hidden=true;};
el('discard').onclick=async()=>{if(loading||saving)return;if(await persist(SnakeModel.fresh(seed()),'Saved game and best reset.')){fault=false;el('repair').hidden=true;label();}};
function frame(now) {
  if(playing&&!saving&&!fault&&!loading){
    const elapsed=now-lastStep;
    if(elapsed>1000)pause('Paused after an interruption. Resume when ready.');
    else if(elapsed>=SnakeModel.interval(game)){
      const direction=queuedTurn;queuedTurn=null;lastStep=now;
      persist(SnakeModel.step(game,direction));
    }
  }
  if(playing||pulse)draw(now);
  raf=requestAnimationFrame(frame);
}
load();raf=requestAnimationFrame(frame);
