#!/usr/bin/env python3
"""Signed Aimé package plus the Synthetic Aimé acceptance fixture.

Synthetic Aimé is the real module UI with scripts/aime-fixture/synthetic-aime.js
loaded before app.js: a fixed viewpoint, a fixed Overpass feature set and a
rendered scene replace those host answers so taps have known answers. Capture,
list, delete, storage and grants stay real. Disposable acceptance only; never
promote the fixture as production Aimé.
"""
import argparse
import json
from pathlib import Path
import shutil
import tempfile
from publish_module import build, publish

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / 'examples/aime-module'
STUB = ROOT / 'scripts/aime-fixture/synthetic-aime.js'

def packages(key):
    """(blob, metadata) for Aimé and Synthetic Aimé, from the checked-in source."""
    out = [build(MODULE, key)]
    with tempfile.TemporaryDirectory() as temp:
        source = Path(temp) / 'aime'
        shutil.copytree(MODULE, source)
        manifest = json.loads((source / 'manifest.json').read_text())
        manifest.update(id='dev.construct.aime-fixture', name='Synthetic Aimé',
                        description='Disposable synthetic Aimé acceptance fixture: fixed viewpoint, features and scene. Not a real view.')
        (source / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
        shutil.copy(STUB, source / 'ui/synthetic-aime.js')
        html = (source / 'ui/index.html').read_text()
        assert html.count('<h1>Aimé</h1>') == 1 and html.count('<script src="app.js"></script>') == 1
        html = html.replace('<h1>Aimé</h1>', '<h1>Synthetic Aimé</h1>').replace(
            '<script src="app.js"></script>', '<script src="synthetic-aime.js"></script>\n    <script src="app.js"></script>')
        (source / 'ui/index.html').write_text(html)
        out.append(build(source, key))
    return out

def prepare(output, key=None):
    if key is None:
        from build_demo import signing_key
        key = signing_key()
    for blob, meta in packages(key):
        publish(output, blob, meta, fixture=meta['id'] == 'dev.construct.aime-fixture')
    print('Prepared signed Aimé and Synthetic Aimé under', output)

if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output', type=Path, required=True)
    prepare(p.parse_args().output.resolve())
