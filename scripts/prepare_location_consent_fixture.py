#!/usr/bin/env python3
"""Signed location-grant regression; never requests actual position data."""
import argparse
import json
from pathlib import Path
import tempfile
from build_demo import signing_key
from publish_module import build, publish
from prepare_http_consent_fixture import HTML, JS, ROOT

def prepare(output):
    key=signing_key()
    html=HTML.replace('Consent Probe','Location Probe').replace('HTTP','Location').replace('No request leaves the host.','No position is requested.')
    js=JS.replace("await call('net.http',{op:'get',url:'https://example.net/consent-probe',format:'json'});",
                  "await call('location.read',{op:'invalid'});").replace('HTTP result:','Location result:')
    js=js.replace('// Authorization is checked before origin validation. This deliberately\n  // undeclared destination is rejected locally even when HTTP is granted.',
                  '// No OS permission is granted in this fixture. An invalid op also\n  // prevents a position request if permission were already present.')
    assert 'net.http' not in js and 'https://' not in js
    with tempfile.TemporaryDirectory() as tmp:
        source=Path(tmp)
        (source/'index.html').write_text(html);(source/'app.js').write_text(js)
        (source/'bridge.js').write_bytes((ROOT/'examples/sky-watch-module/ui/bridge.js').read_bytes())
        for version in ('0.1.0','0.2.0','0.3.0'):
            caps=[dict(id='storage.kv',reason='Keep a synthetic counter across updates')]
            if version!='0.2.0':caps.insert(0,dict(id='location.read',reason='Verify the native grant without requesting a position'))
            manifest=dict(schemaVersion=1,id='dev.construct.location-fixture',name='Location Probe',version=version,
                          description='Synthetic location-consent regression. No position is requested.',
                          constructApi=dict(min='0.9.0',target='0.9.0'),runtime=dict(kind='webview-js'),entry='index.html',capabilities=caps)
            (source/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
            publish(output,*build(source,key),fixture=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--output',type=Path,required=True)
    prepare(parser.parse_args().output.resolve())
