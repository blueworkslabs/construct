'use strict';
const SnakeModel = (() => {
  const size=16, vectors={up:[0,-1],right:[1,0],down:[0,1],left:[-1,0]};
  const opposite={up:'down',down:'up',left:'right',right:'left'};
  const same=(a,b)=>a[0]===b[0] && a[1]===b[1];
  const cell=c=>Array.isArray(c)&&c.length===2&&c.every(n=>Number.isInteger(n)&&n>=0&&n<size);
  function fresh(seed=1,best=0) {
    return {schema:1,snake:[[5,8],[4,8],[3,8],[2,8]],direction:'right',food:[8,8],score:0,best,seed:seed>>>0,moves:0,mode:'alive'};
  }
  function valid(s) {
    if (!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).sort().join(',')!=='best,direction,food,mode,moves,schema,score,seed,snake')return false;
    if(s.schema!==1||!Object.prototype.hasOwnProperty.call(vectors,s.direction)||!['alive','over','won'].includes(s.mode))return false;
    if(!Array.isArray(s.snake)||s.snake.length<4||s.snake.length>size*size||!s.snake.every(cell))return false;
    if(new Set(s.snake.map(c=>c.join(','))).size!==s.snake.length)return false;
    if(s.snake.some((c,i)=>i>0&&Math.abs(c[0]-s.snake[i-1][0])+Math.abs(c[1]-s.snake[i-1][1])!==1))return false;
    if(!Number.isInteger(s.score)||s.score!==s.snake.length-4||!Number.isInteger(s.best)||s.best<s.score||s.best>size*size-4)return false;
    if(!Number.isInteger(s.seed)||s.seed<0||s.seed>0xffffffff||!Number.isSafeInteger(s.moves)||s.moves<0)return false;
    const [dx,dy]=vectors[s.direction];
    if(!same(s.snake[1],[s.snake[0][0]-dx,s.snake[0][1]-dy]))return false;
    if(s.mode==='won')return s.snake.length===size*size&&s.food===null;
    return cell(s.food)&&!s.snake.some(c=>same(c,s.food))&&s.snake.length<size*size;
  }
  function spawn(snake,seed) {
    const occupied=new Set(snake.map(c=>c.join(','))),free=[];
    for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(!occupied.has(x+','+y))free.push([x,y]);
    seed=(Math.imul(seed,1664525)+1013904223)>>>0;
    return {seed,food:free.length?free[seed%free.length]:null};
  }
  function canTurn(s,d) {return Object.prototype.hasOwnProperty.call(vectors,d)&&d!==s.direction&&d!==opposite[s.direction];}
  function step(s,request) {
    if(s.mode!=='alive')return s;
    const direction=canTurn(s,request)?request:s.direction;
    const [dx,dy]=vectors[direction],head=[s.snake[0][0]+dx,s.snake[0][1]+dy];
    const eating=same(head,s.food),body=eating?s.snake:s.snake.slice(0,-1);
    if(!cell(head)||body.some(c=>same(c,head)))return {...s,mode:'over'};
    const snake=[head,...s.snake];if(!eating)snake.pop();
    const score=s.score+(eating?1:0),next=eating?spawn(snake,s.seed):{food:s.food,seed:s.seed};
    return {...s,...next,snake,direction,score,best:Math.max(s.best,score),moves:s.moves+1,mode:next.food?'alive':'won'};
  }
  const interval=s=>Math.max(110,300-Math.floor(s.score/2)*18);
  return {size,vectors,opposite,fresh,valid,step,canTurn,interval,spawn};
})();
if(typeof module!=='undefined')module.exports=SnakeModel;
