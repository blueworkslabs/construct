'use strict';
const button=document.getElementById('open');
const status=document.getElementById('status');
const errors={CAPABILITY_DENIED:'Enable Allow photo measurement in Module access.',MEASURE_BUSY:'The measurement workspace is already open.',RUN_STALE:'Close and reopen this module before trying again.'};
button.onclick=async()=>{
  status.className='';
  button.disabled=true;status.textContent='Opening the native measurement workspace…';
  try {await call('photo.measure',{op:'open'});status.textContent='Measurement workspace opened.';}
  catch(error){status.className='error';status.textContent='['+(error.code||'UNAVAILABLE')+'] '+(errors[error.code]||'Could not open measurement. Close and reopen to retry.');}
  finally {button.disabled=false;}
};
