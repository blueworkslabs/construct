#!/usr/bin/env python3
"""Two signed synthetic Sky versions: real module parser/UI, changed module glossary.

Disposable acceptance only. Never promote these fixtures as production Sky Watch.
Network fixture values contain no personal location or live aircraft identity.
"""
import argparse
import json
from pathlib import Path
import shutil
import tempfile
from build_demo import signing_key
from publish_module import build, publish

ROOT = Path(__file__).resolve().parents[1]
STUB = """'use strict';
// Clearly synthetic data for an independent-module-update test, not live traffic.
const realBridgeCall = call;
call = function(method, params) {
  if (method === 'net.http' && params.url.startsWith('https://api.adsb.lol/')) {
    return Promise.resolve({status:200,headers:{},text:JSON.stringify({now:Date.now(),ac:[
      {hex:'abc123',flight:'SYNTHETIC',r:'TEST-ONLY',t:'BE30',category:'A1',
       lat:50.05,lon:8.56,alt_baro:6000,gs:180,track:90,seen_pos:0}
    ]})});
  }
  return realBridgeCall(method, params);
};
"""

def prepare(output):
    key=signing_key()
    with tempfile.TemporaryDirectory() as temp:
        source=Path(temp)/'sky'
        shutil.copytree(ROOT/'examples/sky-watch-module',source)
        manifest=json.loads((source/'manifest.json').read_text())
        manifest.update(id='dev.construct.sky-fixture',name='Synthetic Sky',description='Disposable synthetic Sky module-update proof. Not live aircraft.')
        (source/'ui/update-fixture.js').write_text(STUB)
        html=(source/'ui/index.html').read_text().replace('<h1>Sky Watch</h1>','<h1>Synthetic Sky</h1>').replace('<script src="app.js"></script>','<script src="update-fixture.js"></script><script src="app.js"></script>')
        (source/'ui/index.html').write_text(html)
        models=(source/'ui/models.js').read_text()
        for version in ('0.1.0','0.2.0'):
            manifest['version']=version
            (source/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
            (source/'ui/models.js').write_text(models.replace('Beechcraft King Air 300','Beechcraft King Air') if version=='0.1.0' else models)
            publish(output,*build(source,key),fixture=True)
    print('Prepared two synthetic signed module versions; only version and glossary differ.')

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output',type=Path,required=True)
    prepare(p.parse_args().output.resolve())
