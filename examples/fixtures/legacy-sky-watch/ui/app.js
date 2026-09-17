 'use strict';
const button=document.getElementById('open');
const status=document.getElementById('status');
const errors={CAPABILITY_DENIED:'Enable Allow Sky Watch map and data in Module access.',SKY_BUSY:'Sky Watch is already open.',RUN_STALE:'Close and reopen this module before trying again.'};
button.onclick=async()=>{
  button.disabled=true;status.className='';status.textContent='Opening aircraft map…';
  try {await call('sky.watch',{op:'open'});status.textContent='Sky Watch opened.';}
  catch(error){status.className='error';status.textContent='['+(error.code||'UNAVAILABLE')+'] '+(errors[error.code]||'Could not open Sky Watch. Close and reopen to retry.');}
  finally {button.disabled=false;}
};
