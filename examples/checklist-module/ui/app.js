 'use strict';
const status = document.querySelector('#status');
const input = document.querySelector('#text');
let items = [];
let busy = true;
const upgraded = '__VERSION__' !== '0.1.0';
function render() {
  const list = document.querySelector('#items');
  list.replaceChildren();
  items.forEach((item, index) => {
    const li = document.createElement('li');
    const check = document.createElement('input');
    check.type = 'checkbox'; check.checked = item.done; check.disabled = busy;
    check.setAttribute('aria-label', 'Complete ' + item.text);
    check.onchange = () => change(items.map((v, i) => i === index ? {...v, done:check.checked} : v));
    const text = document.createElement('span'); text.textContent = item.text;
    if (item.done) text.className = 'done';
    const remove = document.createElement('button'); remove.textContent = 'Delete'; remove.setAttribute('aria-label', 'Delete ' + item.text); remove.disabled = busy;
    remove.onclick = () => change(items.filter((_, i) => i !== index));
    li.append(check, text, remove); list.append(li);
  });
  input.disabled = busy;
  document.querySelector('#add').disabled = busy;
  document.querySelector('#clear').disabled = busy;
  document.querySelector('#clear').hidden = !upgraded;
  document.querySelector('#summary').textContent = items.filter(v => v.done).length + ' / ' + items.length + ' completed';
}
async function change(next) {
  if (busy) return;
  if (next.length > 30) { status.textContent = 'This checklist holds up to 30 items.'; return; }
  busy = true; render();
  try {
    await call('storage.kv', {op:'set', key:'items', value:next});
    items = next; status.textContent = 'Saved on this phone.';
  } catch (_) { status.textContent = 'Could not save. Previous items are unchanged; please retry.'; }
  finally { busy = false; render(); }
}
document.querySelector('#add-form').onsubmit = async event => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text || busy) return;
  await change([...items, {text, done:false}]);
  if (items.some(v => v.text === text)) input.value = '';
  input.focus();
};
document.querySelector('#clear').onclick = () => change(items.filter(v => !v.done));
(async () => {
  const saved = await call('storage.kv', {op:'get', key:'items'});
  if (saved !== null && (!Array.isArray(saved) || saved.length > 30 || saved.some(v => !v || typeof v.text !== 'string' || v.text.length > 120 || typeof v.done !== 'boolean'))) {
    status.textContent = 'Saved items have an unsupported format. They have not been changed.'; return;
  }
  items = saved || [];
  await call('log.write', {level:'info', message:'Checklist ready __VERSION__; item contents omitted'});
  busy = false; render(); status.textContent = 'Ready. Works offline once installed.';
})().catch(() => { status.textContent = 'Could not load saved items. Close and retry; no items have been changed.'; });
