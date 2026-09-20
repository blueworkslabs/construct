'use strict';
const pending = new Map();
let sequence = 0;
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = String(++sequence);
    // Human-operated picker handoff has no deadline. The host still bounds
    // decode/detection work after return and cancels a closed/replaced session.
    const picking = method === 'image.read' && params.op === 'pick' || method === 'camera.photo' || method === 'photos.library' && ['delete','export'].includes(params.op);
    const timeout = picking ? null : setTimeout(() => { pending.delete(id); reject(Object.assign(new Error('Host did not respond'), {code:'TIMEOUT'})); }, 20000);
    pending.set(id, { resolve, reject, timeout });
    construct.postMessage(JSON.stringify({ id, method, params }));
  });
}
construct.onmessage = event => {
  const response = JSON.parse(event.data);
  const request = pending.get(response.id);
  if (!request) return;
  if (request.timeout !== null) clearTimeout(request.timeout);
  pending.delete(response.id);
  if (response.error) request.reject(Object.assign(new Error(response.error.message), {code:response.error.code}));
  else request.resolve(response.result);
};
