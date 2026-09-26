'use strict';
// Every outcome is plain text with a sequence number, so the runner can read the
// accessibility tree and never mistake an earlier result for the current one.
const $=id=>document.getElementById(id);
let items=[],seq=0;
function report(text){$('status').textContent=text+' #'+(++seq);}
function show(photos){
  items=photos;$('count').textContent='Photo count: '+photos.length;$('ids').replaceChildren();
  photos.forEach((photo,n)=>{const li=document.createElement('li');
    li.textContent='ID '+(n+1)+': '+(typeof photo.id==='string'?photo.id:'not provided');$('ids').append(li);});
}
async function list(){
  $('count').textContent='Photo count: unknown';$('ids').replaceChildren();items=[];
  show((await call('photos.library',{op:'list'})).photos);
}
function task(fn){return async()=>{$('status').textContent='Working…';
  try{report(await fn());}catch(error){report('['+(error.code||'UNAVAILABLE')+'] '+error.message);}};}
const empty=message=>Object.assign(new Error(message),{code:'FIXTURE_EMPTY'});
$('list').onclick=task(async()=>{await list();return 'Listed.';});
$('capture').onclick=task(async()=>{
  const r=await call('camera.photo',{op:'capture'});
  if(!r.saved)return 'Capture canceled.';
  await list();return 'Captured and listed.';
});
$('authority').onclick=task(async()=>{
  if(!items.length||typeof items[0].id!=='string')throw empty('List photos with IDs first');
  await call('photos.library',{op:'open',ref:items[0].id});
  return 'ID accepted as ref.';
});
$('delete').onclick=task(async()=>{
  if(!items.length)throw empty('List photos first');
  const r=await call('photos.library',{op:'delete',ref:items[0].ref});
  if(!r.completed)return 'Delete canceled.';
  await list();return 'Deleted and listed.';
});
