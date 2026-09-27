#!/usr/bin/env python3
"""Bootstrap signed local fixtures and example catalogs from this checkout, not private history."""
import argparse
import json
import shutil
import tempfile
from pathlib import Path
import build_demo
import prepare_vision
import prepare_opencv
from publish_module import build, publish

ROOT = Path(__file__).resolve().parents[1]

def prepare(output):
    prepare_vision.prepare()
    prepare_opencv.prepare()
    key = build_demo.signing_key()
    build_demo.main()
    def add(source, versions, *folders, fixture=False):
        for version in versions:
            blob, meta = build(ROOT/'examples'/source, key, version)
            for folder in folders:
                publish(output/folder,blob,meta,latest=not fixture,fixture=fixture)
    add('checklist-module',['0.1.0','0.2.0'],'remote-registry','home-registry')
    add('tone-module',['0.1.0','0.2.0'],'remote-registry','home-registry')
    # Relabeled current-source fixtures exercise version/grant/rollback behavior;
    # these are not redistributions of historical private release packages.
    add('contacts-module',['0.1.0','0.2.0'],'contacts-registry')
    add('fixtures/legacy-camera',['0.1.0'],'camera-registry')
    add('fixtures/legacy-measure',[None],'measure-legacy-registry')
    add('fixtures/legacy-sky-watch',[None],'sky-legacy-registry')
    add('isolation-probe',[None],'probe-registry','test-registry',fixture=True)
    for source in ('focus-module','snake-module','contacts-module','camera-module','measure-module','sky-watch-module'):
        add(source,[None],'home-registry','test-registry')
    prepare_transport(output, key)
    prepare_sensitive(output, key)
    prepare_photo_identity(output, key)
    prepare_capture_metadata(output, key)
    print('Prepared complete JVM fixtures plus home/test catalogs under the selected output.')

def prepare_sensitive(output, key):
    with tempfile.TemporaryDirectory() as tmp:
        probe=Path(tmp); (probe/'index.html').write_text('<p>Signed sensitive grant fixture</p>')
        for version in ('3.1.0','3.2.0','3.3.0','3.4.0'):
            caps=[] if version=='3.4.0' else [dict(id='storage.kv',reason='Keep synthetic counter data')]
            if version not in ('3.2.0','3.4.0'):
                caps += [dict(id=cap,reason='Verify explicit native consent') for cap in
                         ('device.tone','contacts.read','camera.photo','photos.library','image.analyze','image.read','image.markers','location.read')]
                caps.append(dict(id='net.http',reason='Verify explicit source consent',origins=['https://example.org']))
            manifest=dict(schemaVersion=1,id='dev.construct.sensitive-probe',name='Sensitive probe',version=version,
                constructApi=dict(min='0.11.0',target='0.11.0'),runtime=dict(kind='webview-js'),entry='index.html',capabilities=caps)
            (probe/'manifest.json').write_text(json.dumps(manifest))
            publish(output/'sensitive-registry',*build(probe,key),fixture=True)

def prepare_photo_identity(output, key):
    # 0.1.0 is the same UI on API 0.11 (legacy photos, no IDs); 0.2.0/0.3.0 are API 0.12
    # so the runner can prove backfill, then update and rollback between 0.12 versions.
    with tempfile.TemporaryDirectory() as tmp:
        probe=Path(tmp)/'photo-identity'; shutil.copytree(ROOT/'examples/fixtures/photo-identity',probe)
        manifest=json.loads((probe/'manifest.json').read_text())
        for version,api in [('0.1.0','0.11.0'),('0.2.0','0.12.0'),('0.3.0','0.12.0')]:
            if version == '0.2.2':
                js=probe/'ui/app.js';js.write_text(js.read_text().replace('r.deleted?', 'r.completed?'))
            (probe/'manifest.json').write_text(json.dumps({**manifest,'version':version,'constructApi':dict(min=api,target=api)}))
            publish(output/'photo-identity-registry',*build(probe,key),fixture=True)

def prepare_capture_metadata(output, key):
    # 0.1.0 is the same UI on API 0.12 (exact {op} request, {saved} result); 0.2.0 is
    # API 0.13 so the runner proves both the unchanged legacy shape and the metadata.
    with tempfile.TemporaryDirectory() as tmp:
        probe=Path(tmp)/'capture-metadata'; shutil.copytree(ROOT/'examples/fixtures/capture-metadata',probe)
        manifest=json.loads((probe/'manifest.json').read_text())
        for version,api in [('0.1.0','0.12.0'),('0.2.0','0.13.0'),('0.2.1','0.13.0'),('0.2.2','0.13.0')]:
            # Extend only a NEW signed fixture version; published 0.1.0/0.2.0 stay byte-identical.
            if version == '0.2.1':
                html=probe/'ui/index.html'
                html.write_text(html.read_text().replace('<p id="status"', '<button id="confirmation">Open photo confirmation</button><p id="status"'))
                js=probe/'ui/app.js'
                js.write_text(js.read_text()+'''\n$('confirmation').onclick=task(async()=>{
  const photos=(await call('photos.library',{op:'list'})).photos;
  if(!photos.length)return 'No photos.';
  const r=await call('photos.library',{op:'delete',ref:photos[0].ref});
  return r.deleted?'Deleted.':'Delete canceled.';
});\n''')
            if version == '0.2.2':
                js=probe/'ui/app.js';js.write_text(js.read_text().replace('r.deleted?', 'r.completed?'))
            (probe/'manifest.json').write_text(json.dumps({**manifest,'version':version,'constructApi':dict(min=api,target=api)}))
            publish(output/'capture-metadata-registry',*build(probe,key),fixture=True)

def prepare_transport(output, key):
    # Signed scopes exercise expansion, removal/reintroduction and rollback.
    with tempfile.TemporaryDirectory() as tmp:
        probe=Path(tmp); (probe/'index.html').write_text('<p>Signed HTTP scope fixture</p>')
        for version,origins in [('0.1.0',['https://example.org']), ('0.2.0',['https://example.org','https://www.example.org']),
                                ('0.3.0',None), ('0.4.0',['https://example.org'])]:
            manifest=dict(schemaVersion=1,id='dev.construct.transport-probe',name='Transport probe',version=version,
                constructApi=dict(min='0.9.0',target='0.9.0'),runtime=dict(kind='webview-js'),entry='index.html',
                capabilities=[dict(id='net.http',reason='Verify signed source consent',origins=origins),dict(id='location.read',reason='Verify foreground location consent'),dict(id='storage.kv',reason='Verify retained module data')])
            if origins is None:
                manifest['capabilities'] = [cap for cap in manifest['capabilities'] if cap['id'] != 'net.http']
            (probe/'manifest.json').write_text(json.dumps(manifest))
            publish(output/'transport-registry',*build(probe,key),fixture=True)

if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output',type=Path,default=ROOT/'dist/fixtures')
    a=p.parse_args();prepare(a.output.resolve())
