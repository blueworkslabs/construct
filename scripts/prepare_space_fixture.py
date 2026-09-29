#!/usr/bin/env python3
"""Signed Space Watch package plus the Synthetic Space Watch acceptance fixture.

Synthetic Space Watch is the real module UI with scripts/space-fixture/synthetic-space.js
loaded before app.js: a pinned clock (2026-09-28 17:50:40 UTC, running), a fixed
Berlin viewpoint and a captured CelesTrak subset replace those answers so the dome
and the pointing words have known values. Storage, same-launch lookups and Wikipedia use the real host. Synthetic
location and orbit answers bypass those native gates; test grants with the real
module, not this fixture. Disposable acceptance only; never promote the fixture as
production Space Watch.
"""
import argparse
import json
from pathlib import Path
import shutil
import tempfile
from publish_module import build, publish

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / 'examples/space-watch-module'
FIXTURE = ROOT / 'scripts/space-fixture'


def stub():
    """The fixture script with the captured CelesTrak subset inlined."""
    text = (FIXTURE / 'synthetic-space.js').read_text()
    for marker, name in (('/*ELEMENTS*/ null', 'elements.json'), ('/*SATCAT*/ null', 'satcat.json'),
                         ('/*RECENT*/ null', 'recent.json'), ('/*RECENT_SATCAT*/ null', 'recent-satcat.json'),
                         ('/*GNSS*/ null', 'gnss.json'), ('/*GNSS_SATCAT*/ null', 'gnss-satcat.json'),
                         ('/*GEO*/ null', 'geo.json'), ('/*GEO_SATCAT*/ null', 'geo-satcat.json')):
        data = json.loads((FIXTURE / name).read_text())
        assert isinstance(data, list) and data and text.count(marker) == 1
        text = text.replace(marker, json.dumps(data, separators=(',', ':')))
    return text


def fixture_source(target):
    """Copy the module to target and turn it into Synthetic Space Watch."""
    shutil.copytree(MODULE, target)
    manifest = json.loads((target / 'manifest.json').read_text())
    manifest.update(id='dev.construct.space-watch-fixture', name='Synthetic Space Watch',
                    description='Disposable synthetic Space Watch acceptance fixture: pinned clock, Berlin viewpoint and captured orbits. Not the real sky.')
    (target / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    (target / 'ui/synthetic-space.js').write_text(stub())
    html = (target / 'ui/index.html').read_text()
    assert html.count('<h1>Space Watch</h1>') == 1 and html.count('<script src="app.js"></script>') == 1
    html = html.replace('<h1>Space Watch</h1>', '<h1>Synthetic Space Watch</h1>').replace(
        '<script src="app.js"></script>', '<script src="synthetic-space.js"></script>\n    <script src="app.js"></script>')
    (target / 'ui/index.html').write_text(html)


def packages(key):
    """(blob, metadata) for Space Watch and Synthetic Space Watch."""
    out = [build(MODULE, key)]
    with tempfile.TemporaryDirectory() as temp:
        source = Path(temp) / 'space-watch'
        fixture_source(source)
        out.append(build(source, key))
    return out


def prepare(output, key=None):
    if key is None:
        from build_demo import signing_key
        key = signing_key()
    for blob, meta in packages(key):
        publish(output, blob, meta, fixture=meta['id'] == 'dev.construct.space-watch-fixture')
    print('Prepared signed Space Watch and Synthetic Space Watch under', output)


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output', type=Path, required=True)
    prepare(p.parse_args().output.resolve())
