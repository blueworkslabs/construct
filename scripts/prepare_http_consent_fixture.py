#!/usr/bin/env python3
"""Signed synthetic HTTP consent transitions; disposable acceptance only."""
import argparse
import json
from pathlib import Path
import tempfile
from build_demo import signing_key
from publish_module import build, publish

ROOT = Path(__file__).resolve().parents[1]
HTML = '''<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{font:20px sans-serif;padding:24px;background:#fafafa;color:#161616}button{font:inherit;padding:16px;margin:12px 0;display:block}</style></head>
<body><h1>Consent Probe</h1><p>Synthetic consent test. No request leaves the host.</p>
<button id="probe">Check HTTP access</button><p id="result">HTTP result: not checked</p>
<button id="add">Add one</button><p id="count">Counter: loading</p>
<script src="bridge.js"></script><script src="app.js"></script></body></html>'''
JS = ''''use strict';
let count = 0;
const countView = document.getElementById('count');
call('storage.kv',{op:'get',key:'counter'}).then(value=>{
  count = typeof value === 'number' ? value : 0;
  countView.textContent = 'Counter: ' + count;
}).catch(error=>{countView.textContent='Storage error: '+error.code;});
document.getElementById('add').onclick=async()=>{
  await call('storage.kv',{op:'set',key:'counter',value:++count});
  countView.textContent='Counter: '+count;
};
document.getElementById('probe').onclick=async()=>{
  const result=document.getElementById('result');
  // Authorization is checked before origin validation. This deliberately
  // undeclared destination is rejected locally even when HTTP is granted.
  try {
    await call('net.http',{op:'get',url:'https://example.net/consent-probe',format:'json'});
    result.textContent='HTTP result: UNEXPECTED SUCCESS';
  } catch(error) { result.textContent='HTTP result: '+error.code; }
};
'''

def prepare(output):
    key = signing_key()
    with tempfile.TemporaryDirectory() as tmp:
        source = Path(tmp)
        (source/'index.html').write_text(HTML)
        (source/'app.js').write_text(JS)
        (source/'bridge.js').write_bytes((ROOT/'examples/sky-watch-module/ui/bridge.js').read_bytes())
        for version, origins in [('0.1.0',['https://example.org','https://www.example.org']),
                                 ('0.2.0',['https://example.org']), ('0.3.0',[]),
                                 ('0.4.0',['https://example.org'])]:
            caps = [dict(id='storage.kv',reason='Keep a synthetic counter across updates')]
            if origins:
                caps.insert(0,dict(id='net.http',reason='Verify consent enforcement without making a network request',origins=origins))
            manifest = dict(schemaVersion=1,id='dev.construct.consent-fixture',name='Consent Probe',
                            version=version,description='Synthetic HTTP consent regression. Not a production tool.',
                            constructApi=dict(min='0.9.0',target='0.9.0'),runtime=dict(kind='webview-js'),
                            entry='index.html',capabilities=caps)
            (source/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
            publish(output,*build(source,key),fixture=True)

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,required=True)
    prepare(parser.parse_args().output.resolve())
