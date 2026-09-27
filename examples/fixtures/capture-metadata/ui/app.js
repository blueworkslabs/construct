'use strict';
// Outcomes are plain text with a sequence number so the runner reads the accessibility
// tree and never mistakes an earlier result for the current one. The raw bridge result is
// shown verbatim as JSON; the fixture interprets nothing.
const $=id=>document.getElementById(id);
let seq=0;
function report(text){$('status').textContent=text+' #'+(++seq);}
function task(fn){return async()=>{$('status').textContent='Working…';
  try{report(await fn());}catch(error){report('['+(error.code||'UNAVAILABLE')+'] '+error.message);}};}
async function capture(params){
  $('result').textContent='Capture result: none';$('listed').textContent='ID listed: unknown';
  const r=await call('camera.photo',params);
  $('result').textContent='Capture result: '+JSON.stringify(r);
  if(!r.saved)return 'Capture canceled.';
  const ids=(await call('photos.library',{op:'list'})).photos.map(p=>p.id);
  $('listed').textContent='ID listed: '+(typeof r.id==='string'?(ids.includes(r.id)?'yes':'no'):'not provided');
  return 'Captured.';
}
$('measured').onclick=task(()=>capture({op:'capture',level:true,zoom:[1,2]}));
$('plain').onclick=task(()=>capture({op:'capture'}));
