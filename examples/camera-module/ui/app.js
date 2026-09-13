'use strict';
const cameraButton=document.getElementById('open');
const cameraStatus=document.getElementById('status');
const cameraErrors={CAPABILITY_DENIED:'Camera workspace access is off. Enable it in Module access.',ANDROID_PERMISSION_DENIED:'Android camera access is off. Allow it through Module access.',CAMERA_BUSY:'The camera workspace is already opening or open.',RUN_STALE:'Close and reopen this module before trying again.'};
cameraButton.onclick=async()=>{
  cameraButton.disabled=true;cameraStatus.textContent='Opening the native camera workspace…';
  try { await call('camera.capture',{op:'open'});cameraStatus.textContent='Camera workspace opened. Return to the host list when finished.'; }
  catch(error){cameraStatus.textContent='['+(error.code||'UNAVAILABLE')+'] '+(cameraErrors[error.code]||'Could not open the camera. Close and reopen to retry.');}
  finally {cameraButton.disabled=false;}
};
