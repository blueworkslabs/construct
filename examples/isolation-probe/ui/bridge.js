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
  if (response.error) request.reject(Object.assign(new Error(response.error.message), {code: response.error.code}));
  else request.resolve(response.result);
};
