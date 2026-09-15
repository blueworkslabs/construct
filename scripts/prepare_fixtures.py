#!/usr/bin/env python3
"""Bootstrap signed local fixtures and example catalogs from this checkout, not private history."""
import argparse
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
    add('camera-module',['0.1.0'],'camera-registry')
    add('isolation-probe',[None],'probe-registry','test-registry',fixture=True)
    for source in ('focus-module','snake-module','contacts-module','camera-module','measure-module','sky-watch-module'):
        add(source,[None],'home-registry','test-registry')
    print('Prepared complete JVM fixtures plus home/test catalogs under the selected output.')

if __name__ == '__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--output',type=Path,default=ROOT/'dist/fixtures')
    a=p.parse_args();prepare(a.output.resolve())
