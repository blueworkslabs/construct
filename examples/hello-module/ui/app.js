'use strict';
const pending = new Map();
let sequence = 0;
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = String(++sequence);
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Host did not respond')); }, 5000);
    pending.set(id, { resolve, reject, timeout });
    construct.postMessage(JSON.stringify({ id, method, params }));
  });
}
construct.onmessage = event => {
  const response = JSON.parse(event.data);
  const request = pending.get(response.id);
  if (!request) return;
  clearTimeout(request.timeout);
  pending.delete(response.id);
  if (response.error) request.reject(new Error(response.error.message));
  else request.resolve(response.result);
};
const status = document.querySelector('#status');
let count = 0;
function failure(error) { status.textContent = error.message; }
async function save(value) {
  await call('storage.kv', { op: 'set', key: 'count', value });
  count = value;
  document.querySelector('#count').textContent = count;
}
document.querySelector('#add').onclick = () => save(count + 1).catch(failure);
document.querySelector('#toast').onclick = () => call('device.toast', { message: 'Hello from Construct!' }).catch(failure);
document.querySelector('#reset').onclick = () => save(0).catch(failure);
(async () => {
  const saved = await call('storage.kv', { op: 'get', key: 'count' });
  count = typeof saved === 'number' ? saved : 0;
  document.querySelector('#count').textContent = count;
  document.querySelector('#reset').hidden = '__VERSION__' === '0.1.0';
  await call('log.write', { level: 'info', message: 'Hello module ready', fields: { version: '__VERSION__' } });
  for (const button of document.querySelectorAll('button')) button.disabled = false;
  status.textContent = 'Ready. The counter is stored only for this module.';
})().catch(failure);
