#!/usr/bin/env python3
"""Task-scoped, disposable Android acceptance for an exact old/new APK pair."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

from config import CONFIG, SERIAL, require_runner

p = argparse.ArgumentParser()
p.add_argument('--old', type=Path, required=True)
p.add_argument('--old-sha', required=True)
p.add_argument('--new', type=Path, required=True)
p.add_argument('--new-sha', required=True)
p.add_argument('--catalog', required=True)
p.add_argument('--candidates', type=Path, required=True)
a = p.parse_args()
candidates = json.loads(a.candidates.read_text())
from config import catalog
catalog(a.catalog)
require_runner()
for path, digest in [(a.old, a.old_sha), (a.new, a.new_sha)]:
    if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise RuntimeError('APK checksum mismatch')
lock = (CONFIG.root / 'suite.lock').open('a')
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
if subprocess.run(['systemctl', '--user', 'is-active', '--quiet', CONFIG.service]).returncode == 0:
    raise RuntimeError('Preserve already-running emulator')
devices = subprocess.check_output([str(CONFIG.sdk / 'platform-tools/adb'), 'devices'], text=True)
if any(line.startswith(SERIAL + '\t') for line in devices.splitlines()):
    raise RuntimeError('Emulator port occupied')
if (CONFIG.root / 'camera-emulated.flag').exists():
    raise RuntimeError('Expected normal app-free snapshot profile')
run = CONFIG.root / 'results' / (datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-retirement-' + uuid.uuid4().hex[:8])
run.mkdir(parents=True)
os.environ['CONSTRUCT_RESULTS'] = str(run)
import ui
from ui import adb, nodes, labels, tap, tap_node, find, capture
from host_ui import host_ready, catalog_settings, apply_catalog, library, select_after, installed_status, scroll_top, _stable_card, diagnostics

URL = a.catalog
receipt = {'scope': 'Native Measure retirement across exact alpha28-to-alpha29 upgrade',
           'oldSha256': a.old_sha, 'newSha256': a.new_sha, 'checks': [], 'complete': False, 'stopped': False}
started = False

def save():
    (run / 'result.json').write_text(json.dumps(receipt, indent=2) + '\n')

def done(name):
    receipt['checks'].append(name)
    save()
    print('PASS:', name, flush=True)

def launch():
    adb('shell', 'am', 'start', '-n', 'dev.construct.runtime/.MainActivity')
    host_ready()

def verify_installed(expected):
    entries = adb('shell', 'pm', 'path', 'dev.construct.runtime').splitlines()
    if len(entries) != 1 or not entries[0].startswith('package:/data/app/'):
        raise RuntimeError('Unexpected installed APK path')
    actual = adb('shell', 'sha256sum', entries[0].removeprefix('package:').strip()).split()[0]
    if actual != expected:
        raise RuntimeError('Installed APK differs from candidate')

def field_is(expected):
    values = [n.get('text') for n in nodes() if n.get('class') == 'android.widget.EditText' and n.get('package') == 'dev.construct.runtime']
    if values != [expected]:
        raise RuntimeError('Catalog field differs from expected value: ' + repr(values))

def consent_switch(label):
    find('Allow & install')
    deadline=time.monotonic()+20
    while time.monotonic()<deadline:
        matches=[n for n in nodes() if n.get('content-desc')==label and n.get('checkable')=='true']
        if len(matches)==1:
            before=matches[0].get('bounds')
            time.sleep(.4)
            matches=[n for n in nodes() if n.get('content-desc')==label and n.get('checkable')=='true']
            if len(matches)==1 and matches[0].get('bounds')==before:return matches[0]
        time.sleep(.3)
    raise RuntimeError('Trusted consent switch did not appear: '+label)

def settled_host_surface():
    # A version review closes a ModalBottomSheet asynchronously. Never swipe
    # its disappearing accessibility window or retry the preceding action.
    from host_cards import host_viewport
    deadline=time.monotonic()+20; previous=None
    while time.monotonic()<deadline:
        current=nodes()
        texts={n.get('text') for n in current}
        try: viewport=host_viewport(current)
        except RuntimeError: viewport=None
        if viewport and 'Close versions' not in texts and 'Browse' in texts and viewport==previous:
            return
        previous=viewport; time.sleep(.4)
    raise RuntimeError('Host did not settle after version review')

def install_hello(version):
    select_after('Hello Module · ' + version, ('Review & install',))
    tap('Allow & install')
    installed_status()

def open_hello(version):
    select_after('Hello Module · ' + version, ('Open',))
    find('Add one')

try:
    print('RESULTS:', run, flush=True)
    avd, snapshot, _ = CONFIG.profile(False)
    subprocess.run([str(CONFIG.root / 'runner.sh'), 'start'], check=True)
    started = True
    deadline = time.monotonic() + 180
    while True:
        try:
            if adb('shell', 'getprop', 'sys.boot_completed', timeout=10).strip() == '1':
                break
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            pass
        if time.monotonic() > deadline:
            raise RuntimeError('Boot timeout')
        time.sleep(2)
    invocation = subprocess.check_output(['systemctl', '--user', 'show', CONFIG.service, '-p', 'InvocationID', '--value'], text=True).strip()
    startup = subprocess.check_output(['journalctl', '--user', '_SYSTEMD_INVOCATION_ID=' + invocation, '--no-pager'], text=True)
    (run / 'startup.log').write_text(startup)
    if "Successfully loaded snapshot '" + snapshot + "'" not in startup:
        raise RuntimeError('No fresh snapshot restore evidence')
    if 'package:dev.construct.runtime' in adb('shell', 'pm', 'list', 'packages', 'dev.construct.runtime'):
        raise RuntimeError('Snapshot not app-free')
    receipt['snapshot'] = {'avd': avd, 'name': snapshot, 'loaded': True, 'invocation': invocation}
    receipt['apiLevel'] = adb('shell', 'getprop', 'ro.build.version.sdk').strip()
    receipt['shellIdentity'] = adb('shell', 'id').strip()
    if 'uid=2000(shell)' not in receipt['shellIdentity']:
        raise RuntimeError('ADB is not non-root shell')
    receipt['webview'] = adb('shell', 'dumpsys', 'webviewupdate')
    if receipt['apiLevel']!='37':raise RuntimeError('Expected Android17 upgrade fixture')
    from webview_provider import installed_provider_sha
    if installed_provider_sha(adb)!='e4ded2f4d0f22dce452fd0d9f485a9b78926a9e2c3d4ffe64f4a385346d20497':raise RuntimeError('Unexpected WebView bytes')
    if 'Current WebView package (name, version): (com.android.webview,' not in receipt['webview']:raise RuntimeError('Unexpected active WebView')
    # Explicit disposable-image-only override used by the established runner.
    wellbeing = 'com.google.android.apps.wellbeing'
    if 'package:' + wellbeing in adb('shell', 'pm', 'list', 'packages', wellbeing):
        adb('shell', 'pm', 'disable-user', '--user', '0', wellbeing)
        receipt['digitalWellbeingOverride'] = 'disabled-user on disposable image only'
    adb('logcat', '-c')
    adb('install', str(a.old.resolve()), timeout=120); verify_installed(a.old_sha); launch()
    catalog_settings(); tap('Use demo catalog'); apply_catalog(); find('Catalog refreshed.')
    install_hello('0.2.0'); open_hello('0.2.0')
    for _ in range(3): tap('Add one')
    find('3'); tap('Mark working')
    catalog_settings()
    from catalog_input import replace_text
    replace_text(nodes,lambda value:ui._device(className='android.widget.EditText',packageName='dev.construct.runtime').set_text(value),URL)
    apply_catalog(); find('Catalog refreshed.')
    select_after('Pocket Measure · 0.1.3', ('Review & install',))
    grant=consent_switch('Allow photo measurement')
    if grant.get('checked')!='false': raise RuntimeError('Expected default-off old grant')
    tap_node(grant); tap('Allow & install'); installed_status()
    select_after('Pocket Measure · 0.1.3', ('Open',)); tap('Open measurement workspace'); find('Choose photo')
    capture('old-native-workspace'); tap('Close measure'); tap('Construct menu'); tap('Close module'); library()
    # Leave the old version unconfirmed: it must remain replaceable after retirement.
    catalog_settings(); tap('Use demo catalog'); apply_catalog(); find('Catalog refreshed.')
    adb('shell','am','force-stop','dev.construct.runtime')
    adb('install','-r',str(a.new.resolve()),timeout=120); verify_installed(a.new_sha); launch()
    catalog_settings(); field_is('demo')
    library(); open_hello('0.2.0'); find('3'); tap('Close module')
    done('In-place host upgrade preserves selected catalog, unrelated installed module and saved counter')
    library(); _stable_card('Pocket Measure · 0.1.3', ('Find update',))
    find('Catalog refreshed.') # Saved demo catalog, no automatic substitution.
    library(); find('Update required')
    for scale,rotation,label in [('1.0','0','portrait'),('1.0','1','landscape'),('2.0','0','font2'),('2.0','1','font2-landscape')]:
        adb('shell','settings','put','system','font_scale',scale)
        adb('shell','settings','put','system','accelerometer_rotation','0')
        adb('shell','settings','put','system','user_rotation',rotation); time.sleep(2)
        library()
        from host_ui import reveal_host_control
        reveal_host_control('Find update'); capture('retired-'+label)
    adb('shell','settings','put','system','font_scale','1.0')
    adb('shell','settings','put','system','user_rotation','0'); time.sleep(2)
    library(); select_after('Pocket Measure · 0.1.3', ('Module access',))
    find('Retired · update this module')
    switches=[n for n in nodes() if n.get('checkable')=='true' and n.get('content-desc')=='photo.measure']
    if len(switches)!=1 or switches[0].get('checked')!='false' or switches[0].get('enabled')!='false':
        raise RuntimeError('Retired grant must be off and disabled')
    capture('retired-access'); tap('Back')
    done('Retired installed trial remains manageable with visible Find update and disabled old authority')
    catalog_settings()
    from catalog_input import replace_text
    replace_text(nodes,lambda value:ui._device(className='android.widget.EditText',packageName='dev.construct.runtime').set_text(value),URL)
    apply_catalog(); find('Catalog refreshed.')
    select_after('Pocket Measure · '+candidates['measure']['version'], ('Review & install',))
    for label in ('Allow selected image pixels','Allow local marker detection'):
        grant=consent_switch(label)
        if grant.get('checked')!='false': raise RuntimeError('Old native grant leaked into new image authority')
    capture('fresh-image-consent'); tap('Allow & install'); installed_status()
    events=diagnostics()
    if not any(e.get('code')=='INSTALLED_TRIAL' and e.get('packageDigest')==candidates['measure']['sha256'] for e in events):
        raise RuntimeError('Modern signed module digest not verified')
    library(); select_after('Pocket Measure · '+candidates['measure']['version'], ('Open',)); find('Choose photo')
    capture('modern-measure-after-upgrade'); tap('Construct menu'); tap('Close module'); library()
    done('Unconfirmed retired module updates to exact modern signed module without reusing legacy photo consent')
    select_after('Pocket Measure · '+candidates['measure']['version'], ('Roll back',)); tap('Restore'); library()
    error='[MODULE_UPDATE_REQUIRED] This version needs an update to run on this Construct release. Saved data is kept. Browse your catalog for a supported version.'
    find(error); capture('retired-rollback-blocked')
    select_after('Pocket Measure · '+candidates['measure']['version'], ('Open',)); find('Choose photo')
    tap('Construct menu'); tap('Mark working'); library()
    done('Rollback to retired native code is blocked and current modern module stays runnable')
    select_after('Pocket Measure · 0.1.3', ('Review & install',)); settled_host_surface(); scroll_top(); find(error)
    if 'Allow & install' in labels(): raise RuntimeError('Retired package reached install consent')
    capture('retired-install-blocked'); library(); open_hello('0.2.0'); find('3'); tap('Close module')
    done('Retired reinstallation rejected before consent; saved unrelated module data remains intact')
    receipt['complete'] = True
except Exception as e:
    receipt['error'] = str(e)
    try: capture('failure')
    except Exception: pass
    raise
finally:
    if started:
        try:
            (run / 'crash-buffer.txt').write_text(adb('logcat', '-b', 'crash', '-d'))
            (run / 'runtime.log').write_text(adb('logcat', '-d', '-t', '6000'))
        except Exception: pass
        subprocess.run([str(CONFIG.root / 'runner.sh'), 'stop'], check=True)
        receipt['stopped'] = subprocess.run(['systemctl', '--user', 'is-active', '--quiet', CONFIG.service]).returncode != 0
    save()
    print(json.dumps(receipt, indent=2), flush=True)
