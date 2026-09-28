'use strict';
// Outcomes are plain text with a sequence number so the runner reads the accessibility
// tree and never mistakes an earlier result for the current one. Samples are shown
// verbatim as JSON; the fixture interprets nothing. Events counts pushed samples since
// the last watch, so the runner can check the rate cap and that pause/stop end the stream.
const $=id=>document.getElementById(id);
let seq=0,events=0;
function report(text){$('status').textContent=text+' #'+(++seq);}
function task(fn){return async()=>{$('status').textContent='Working…';
  try{report(await fn());}catch(error){report('['+(error.code||'UNAVAILABLE')+'] '+error.message);}};}
window.addEventListener('constructorientation',e=>{
  events++;$('count').textContent='Events: '+events;$('sample').textContent='Sample: '+JSON.stringify(e.detail);
});
window.addEventListener('constructvisibilitychange',e=>{if(e.detail&&e.detail.visible===false)report('Paused; stream stopped by host.');});
$('get').onclick=task(async()=>{const r=await call('orientation.read',{op:'get'});$('sample').textContent='Sample: '+JSON.stringify(r);return 'Read.';});
const watch=rate=>task(async()=>{events=0;$('count').textContent='Events: 0';const r=await call('orientation.read',{op:'watch',rateHz:rate});return 'Watching: '+JSON.stringify(r);});
$('watch').onclick=watch(10);
$('watch15').onclick=watch(15);
$('stop').onclick=task(async()=>'Stopped: '+JSON.stringify(await call('orientation.read',{op:'stop'})));
