#!/usr/bin/env python3
"""Inspect the actual standalone pilot, not just its source manifest."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('apk', type=Path)
a = p.parse_args()
sdk = Path(os.environ.get('ANDROID_HOME') or os.environ.get('ANDROID_SDK_ROOT') or '')
tool = sdk / 'build-tools/35.0.0/aapt'
if not tool.is_file():
    raise SystemExit('Set ANDROID_HOME to a SDK with build-tools 35.0.0')
def dump(*args):
    return subprocess.check_output([str(tool), 'dump', *args], text=True)
permissions = set(re.findall(r"uses-permission: name='([^']+)'", dump('permissions', str(a.apk))))
allowed = {'com.google.android.apps.aicore.service.BIND_SERVICE',
           'android.permission.ACCESS_NETWORK_STATE',
           'dev.construct.nanolab.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'}
if permissions != allowed:
    raise SystemExit('Unexpected APK permission set: ' + repr(permissions))
manifest = dump('xmltree', str(a.apk), 'AndroidManifest.xml')
if re.search(r'android:debuggable[^\n]*0xffffffff', manifest):
    raise SystemExit('Pilot must be non-debuggable')
if 'dev.construct.nanolab' not in dump('badging', str(a.apk)).splitlines()[0]:
    raise SystemExit('Wrong package: do not replace Construct')
if a.apk.stat().st_size > 10_000_000:
    raise SystemExit('Unexpected size: Nano model must not be bundled')
subprocess.run([str(sdk/'build-tools/35.0.0/apksigner'), 'verify', str(a.apk)], check=True)
print(json.dumps({'bytes': a.apk.stat().st_size,
                  'sha256': hashlib.sha256(a.apk.read_bytes()).hexdigest(),
                  'permissions': sorted(permissions), 'debuggable': False}, indent=2))
