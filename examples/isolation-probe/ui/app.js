 'use strict';
const endpoint = 'https://192.0.2.1/construct-registry/index.json';
const status = document.querySelector('#status');
async function record(message) {
  status.textContent = message;
  await call('log.write', {level:'info', message});
}
const probes = {
  'Undeclared toast': async () => {
    try { await call('device.toast', {message:'UNEXPECTED probe toast'}); await record('FAIL: undeclared capability succeeded'); }
    catch (error) { await record(error.code === 'CAPABILITY_DENIED' ? 'BLOCKED: CAPABILITY_DENIED' : 'FAIL: denial unproven: ' + (error.code || error.message)); }
  },
  'Fetch': async () => {
    try { await fetch(endpoint); await record('FAIL: fetch succeeded'); }
    catch (_) { await record('PENDING: fetch rejected; inspect native evidence'); }
  },
  'WebSocket': () => { const ws = new WebSocket('wss://192.0.2.1/construct-probe'); ws.onopen = () => record('FAIL: socket opened'); ws.onerror = () => record('PENDING: WebSocket rejected; inspect native evidence'); },
  'Iframe / nested bridge': () => {
    const frame = document.createElement('iframe');
    frame.srcdoc = '<script>parent.construct.postMessage(JSON.stringify({id:"nested",method:"device.toast",params:{message:"UNEXPECTED frame toast"}}))<\/script>';
    document.body.append(frame);
    return record('PENDING: frame attached; no nested reply observed, not proof of denial');
  },
  'Popup': () => { const popup = window.open(endpoint); return record(popup ? 'PENDING: popup object returned; host POPUP_BLOCKED evidence required' : 'PENDING: no popup object; inspect host diagnostics'); },
  'Native resource denial': () => {
    const img = document.createElement('img');
    img.src = '/invalid~probe.png';
    document.body.append(img);
    return record('PENDING: local rejected-path request; native evidence required');
  },
  'External navigation': () => { location.href = endpoint; },
  'Data navigation': () => { location.href = 'data:text/html,Unexpected%20navigation'; },
  'File navigation': () => { location.href = 'file:///construct-probe-nonexistent'; },
  'Content navigation': () => { location.href = 'content://construct-probe-nonexistent'; },
  'Bounded bridge flood (40)': () => {
    for (let i = 0; i < 40; i++) construct.postMessage(JSON.stringify({id:'flood'+i,method:'log.write',params:{level:'info',message:'Bounded probe flood'}}));
    status.textContent = 'PENDING: 40 messages sent; inspect bounded logs and host responsiveness.';
  }
};
for (const [name, probe] of Object.entries(probes)) {
  const button = document.createElement('button'); button.textContent = name;
  button.onclick = async () => {
    document.querySelectorAll('button').forEach(v => v.disabled = true);
    try { await record('PENDING: PROBE: ' + name); await probe(); }
    catch (_) { status.textContent = 'PENDING: probe rejected or module stopped; native verdict required.'; }
  };
  document.querySelector('#buttons').append(button);
}
