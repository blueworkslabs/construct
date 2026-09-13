'use strict';
const el=id=>document.getElementById(id);
let working=false,nextPage=null,currentQuery='',lastRequest=0;
const errors={CAPABILITY_DENIED:'Allow reading contacts in Module access.',ANDROID_PERMISSION_DENIED:'Allow Android contacts access in Module access.',CONTACTS_STALE:'Search again; these results have expired.',CONTACTS_LIMIT:'Narrow your search to see more contacts.',CONTACTS_NOT_FOUND:'Contact no longer exists. Search again.',CONTACTS_TIMEOUT:'Contacts took too long. Close and reopen to retry; if it persists, try later.',CONTACTS_BUSY:'A previous request is still finishing. Wait, or close and reopen to retry.'};
function clearResults(){el('results').replaceChildren();el('detail').hidden=true;el('name').textContent='';el('phones').replaceChildren();el('emails').replaceChildren();nextPage=null;el('more').hidden=true;}
function state(on){working=on;el('browse').disabled=on;el('go').disabled=on;el('query').disabled=on;el('more').disabled=on;for(const b of el('results').querySelectorAll('button'))b.disabled=on;}
async function request(params,render){
  if(working)return;state(true);el('status').textContent='Reading contacts…';
  try{
    const delay=Math.max(0,350-(Date.now()-lastRequest));if(delay)await new Promise(resolve=>setTimeout(resolve,delay));lastRequest=Date.now();
    const value=await call('contacts.read',params);render(value);
  }catch(e){clearResults();el('status').textContent='['+(e.code||'REQUEST_FAILED')+'] '+(errors[e.code]||'Contacts unavailable. Try searching again.');}
  finally{state(false);}
}
function search(more=false){
  if(working)return;
  if(!more){currentQuery=el('query').value.trim();clearResults();if(!currentQuery){el('status').textContent='Enter a name, or choose Browse contacts.';return;}}
  const params={op:'search',query:currentQuery};if(more&&nextPage)params.cursor=nextPage;
  return request(params,value=>{
    el('detail').hidden=true;el('results').hidden=false;
    for(const item of value.items){const button=document.createElement('button');button.textContent=item.name;button.onclick=()=>detail(item.ref);el('results').append(button);}
    nextPage=value.next;el('more').hidden=!nextPage;
    const count=el('results').children.length;
    el('status').textContent=count?count+(count===1?' contact shown.':' contacts shown.')+(value.limited?' Limit reached; narrow the search.':''):'No matching contacts.';
  });
}
function detail(ref){return request({op:'get',ref},value=>{
  el('name').textContent=value.name;
  for(const key of ['phones','emails']){el(key).replaceChildren();const labels=value[key==='phones'?'phoneLabels':'emailLabels']||[];const values=value[key].length?value[key]:['None listed'];values.forEach((text,i)=>{const row=document.createElement('li');row.textContent=(labels[i]?labels[i]+': ':'')+text;el(key).append(row);});}
  el('detail-note').textContent=value.limited?'Some details omitted (up to five numbers and five emails).':'';
  el('detail').hidden=false;el('results').hidden=true;el('more').hidden=true;el('status').textContent='Contact details. Read only.';
});}
el('browse').onclick=()=>{if(working)return;el('query').value='';currentQuery='';clearResults();return search(true);};
el('search').onsubmit=event=>{event.preventDefault();search();};el('more').onclick=()=>search(true);
el('back').onclick=()=>{if(working)return;el('detail').hidden=true;el('name').textContent='';el('phones').replaceChildren();el('emails').replaceChildren();el('results').hidden=false;el('more').hidden=!nextPage;el('status').textContent=el('results').children.length+(el('results').children.length===1?' contact shown.':' contacts shown.');};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')clearResults();});
