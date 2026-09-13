'use strict';
const el = id => document.getElementById(id);
let state = FocusModel.fresh();
let busy = true;
let fault = false;
const phaseText = {idle:'Ready to focus', running:'Focus in progress', paused:'Timer paused', done:'Session finished'};
function render() {
  const seconds = Math.ceil(FocusModel.left(state, Date.now()) / 1000);
  el('clock').textContent = String(Math.floor(seconds / 60)).padStart(2,'0') + ':' + String(seconds % 60).padStart(2,'0');
  el('clock').setAttribute('aria-label', 'Time remaining: ' + el('clock').textContent);
  el('phase').textContent = fault ? 'Saved timer unavailable' : phaseText[state.phase];
  for (const id of ['focus','break','check']) el(id).disabled = busy || fault || ['running','paused'].includes(state.phase);
  el('start').disabled = busy || fault || state.phase === 'running';
  el('start').textContent = state.phase === 'paused' ? 'Resume timer' : 'Start timer';
  el('pause').disabled = busy || fault || state.phase !== 'running';
  el('reset').disabled = busy || fault;
  el('retry').disabled = busy;
  el('repair-yes').disabled = busy;
}
function problem(error) {
  fault = true;
  el('status').textContent = 'Could not access the saved timer [' + (error.code || 'STORAGE_ERROR') + ']. Check Module access, then retry. No completion sound will play.';
  el('retry').hidden = false;
}
async function save(next, message) {
  busy = true; render();
  try {
    await call('storage.kv', {op:'set', key:'timer', value:next});
    state = next; el('status').textContent = message; return true;
  } catch (error) { problem(error); return false; }
  finally { busy = false; render(); }
}
async function load() {
  if (busy && !fault && el('status').textContent !== 'Loading…') return;
  busy = true; fault = false; el('retry').hidden = true; el('repair').hidden = true; el('repair-confirm').hidden = true; render();
  try {
    const saved = await call('storage.kv', {op:'get', key:'timer'});
    if (saved !== null && !FocusModel.valid(saved)) {
      fault = true; el('repair').hidden = false;
      el('status').textContent = 'Saved timer format is unsupported. Nothing has been overwritten.';
      return;
    }
    state = saved || FocusModel.fresh();
    const caughtUp = FocusModel.settle(state, Date.now());
    if (caughtUp !== state) {
      await call('storage.kv', {op:'set', key:'timer', value:caughtUp}); state = caughtUp;
      el('status').textContent = 'Finished while away. No late sound played.';
    } else el('status').textContent = state.phase === 'running' ? 'Continuing saved countdown. Keep open for sound.' : 'Ready. Timer saved on this phone.';
  } catch (error) { problem(error); }
  finally { busy = false; render(); }
}
async function complete(next) {
  if (!await save(next, 'Session finished.')) return;
  // Completion is saved first: reopening never replays a sound, even if interrupted here.
  // A delayed callback after leaving is not an alarm service.
  if (document.visibilityState !== 'visible') return;
  busy = true; render();
  try {
    await call('device.tone', {pattern:'beep'});
    el('status').textContent = 'Session finished. Completion tone requested.';
  } catch (error) {
    el('status').textContent = error.code === 'CAPABILITY_DENIED' ? 'Finished quietly — tone access is off.' : error.code === 'AUDIO_MUTED' ? 'Finished quietly — device sound settings suppressed the tone.' : 'Session finished. Sound unavailable [' + (error.code || 'TONE_ERROR') + '].';
  } finally { busy = false; render(); }
}
el('start').onclick = () => { if (!busy && !fault) save(FocusModel.start(state, Date.now()), 'Timer started. Keep open for sound.'); };
el('pause').onclick = () => { if (!busy && !fault) save(FocusModel.pause(state, Date.now()), 'Paused and saved.'); };
el('reset').onclick = () => { if (!busy && !fault) save(FocusModel.fresh(state.durationMs), 'Timer reset.'); };
for (const [id, duration] of [['focus',1500000],['break',300000],['check',10000]]) {
  el(id).onclick = () => { if (!busy && !fault && !['running','paused'].includes(state.phase)) save(FocusModel.fresh(duration), 'Duration saved.'); };
}
el('retry').onclick = () => { if (!busy) load(); };
el('repair-open').onclick = () => { el('repair-confirm').hidden = false; };
el('repair-no').onclick = () => { el('repair-confirm').hidden = true; };
el('repair-yes').onclick = async () => {
  if (busy) return;
  if (await save(FocusModel.fresh(), 'Saved timer reset.')) { fault = false; el('repair').hidden = true; el('retry').hidden = true; render(); }
};
setInterval(() => {
  if (busy || fault) return;
  const next = FocusModel.settle(state, Date.now());
  if (next !== state) complete(next); else render();
}, 250);
load();
