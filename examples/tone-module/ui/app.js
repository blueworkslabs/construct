'use strict';
const version = '__VERSION__';
const status = document.querySelector('#status');
async function play(pattern) {
  status.className = '';
  try {
    await call('device.tone', {pattern});
    status.textContent = 'TONE_ACCEPTED: ' + pattern + '. Playback requested; audibility depends on your device.';
  } catch (error) { status.className = error.code === 'AUDIO_MUTED' ? 'attention' : 'error'; status.textContent = error.code + ': ' + error.message; }
}
document.querySelector('#beep').onclick = () => play('beep');
const double = document.querySelector('#double');
double.hidden = version === '0.1.0';
double.onclick = () => play('double');
