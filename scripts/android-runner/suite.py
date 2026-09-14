#!/usr/bin/env python3
"""Clean-snapshot acceptance of an explicitly identified pilot APK on staging only."""
from config import CONFIG, SERIAL, require_runner
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import time
import uuid

require_runner()
BASE = CONFIG.root
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('apk', type=Path)
p.add_argument('sha256')
p.add_argument('--focus-sha256', help='Append exact signed Focus candidate acceptance')
p.add_argument('--focus-only', action='store_true', help='Run only Focus acceptance, not the host regression suite')
p.add_argument('--snake-sha256', help='Append exact signed Snake candidate acceptance')
p.add_argument('--snake-only', action='store_true', help='Run only Snake acceptance, not the host regression suite')
p.add_argument('--contacts-sha256', help='Append synthetic contacts and Android permission checks')
p.add_argument('--contacts-only', action='store_true', help='Only contacts; also require full regression for a host change')
p.add_argument('--camera-sha256', help='Exact signed native camera launcher acceptance')
p.add_argument('--camera-version', default='0.1.0', help='Exact camera launcher version paired with its hash')
p.add_argument('--camera-gallery-export', action='store_true', help='Also verify native gallery confirmation, exact copy and independent deletion (Android 10+)')
p.add_argument('--camera-only', action='store_true', help='Only synthetic camera; host changes also need baseline')
p.add_argument('--camera-vision-only', action='store_true', help='Only selected-photo face/object analysis using public-domain/CC0 fixtures; not full camera acceptance')
p.add_argument('--camera-reopen-only', action='store_true', help='Bounded dialog/Reopen reproduction; not full camera acceptance')
p.add_argument('--camera-fresh-launches', action='store_true', help='Camera regression with explicit host restarts after access changes; excludes known direct-Reopen accessibility issue')
p.add_argument('--tone-consent-only', action='store_true', help='Start clean with tone and consent, omitting checklist/probe/renderer checks; optional module suites may follow')
p.add_argument('--modules-only', action='store_true', help='Run explicitly supplied Focus/Snake/Contacts suites, excluding all host baseline checks')
p.add_argument('--disable-digital-wellbeing', action='store_true', help='Disable only Google Digital Wellbeing on this disposable image; record the environment change')
p.add_argument('--reliability-only', action='store_true', help='Repeated bundled-module lifecycle/accessibility checks only; not host or camera acceptance')
p.add_argument('--webview-apk', type=Path, help='Optional Chromium com.android.webview provider for this disposable userdebug run')
p.add_argument('--webview-sha256', help='Required checksum of the optional WebView provider APK')
a = p.parse_args()
if a.reliability_only and any((a.camera_sha256, a.focus_sha256, a.snake_sha256, a.contacts_sha256, a.tone_consent_only, a.modules_only)): p.error('Reliability scope cannot mix other module scopes')
if a.camera_vision_only and (not a.camera_only or not a.camera_sha256 or a.camera_gallery_export or a.camera_reopen_only): p.error('Vision scope requires camera-only/hash and cannot mix gallery or reopen scopes')
if a.camera_gallery_export and (not a.camera_only or not a.camera_sha256 or a.camera_reopen_only): p.error('Gallery export requires full camera-only/hash acceptance, not reopen-only')
if not __import__('re').fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', a.camera_version): p.error('Camera version must be a numeric release version')
os.environ['CONSTRUCT_CAMERA_VERSION'] = a.camera_version
os.environ['CONSTRUCT_CAMERA_GALLERY_EXPORT'] = '1' if a.camera_gallery_export else '0'
if a.modules_only and (a.tone_consent_only or a.focus_only or a.snake_only or a.contacts_only or a.camera_sha256 or not (a.focus_sha256 or a.snake_sha256 or a.contacts_sha256)): p.error('Modules-only requires explicit non-camera module hashes and no other scope flag')
if a.tone_consent_only and (a.focus_only or a.snake_only or a.contacts_only or a.camera_only or a.camera_sha256): p.error('Tone/consent scope cannot mix module-only or camera scope')
if a.camera_fresh_launches and (not a.camera_only or not a.camera_sha256 or a.camera_reopen_only): p.error('Fresh-launch camera scope requires camera-only/hash and excludes strict reopen-only')
os.environ['CONSTRUCT_CAMERA_FRESH_LAUNCHES']='1' if a.camera_fresh_launches else '0'
if a.camera_reopen_only and not (a.camera_only and a.camera_sha256): p.error('--camera-reopen-only also requires --camera-only and --camera-sha256')
os.environ['CONSTRUCT_CAMERA_REOPEN_ONLY']='1' if a.camera_reopen_only else '0'
if a.camera_only and not a.camera_sha256: p.error('--camera-only requires --camera-sha256')
if (a.camera_only and (a.focus_sha256 or a.snake_sha256 or a.contacts_sha256)) or ((a.focus_only or a.snake_only or a.contacts_only) and a.camera_sha256): p.error('Camera-only cannot mix module-only suites')
if a.focus_only and not a.focus_sha256: p.error('--focus-only requires --focus-sha256')
if a.snake_only and not a.snake_sha256: p.error('--snake-only requires --snake-sha256')
if (a.focus_only and a.snake_sha256) or (a.snake_only and a.focus_sha256): p.error('Module-only runs cannot include a second module')
if a.contacts_only and not a.contacts_sha256: p.error('--contacts-only requires --contacts-sha256')
if (a.contacts_only and (a.focus_sha256 or a.snake_sha256)) or ((a.focus_only or a.snake_only) and a.contacts_sha256): p.error('Module-only runs cannot include a second module')
if bool(a.webview_apk) != bool(a.webview_sha256): p.error('WebView APK and checksum are required together')
if a.webview_apk and hashlib.sha256(a.webview_apk.read_bytes()).hexdigest() != a.webview_sha256.lower(): p.error('WebView provider checksum mismatch')
actual = hashlib.sha256(a.apk.read_bytes()).hexdigest()
if actual != a.sha256.lower(): raise SystemExit('APK checksum mismatch; not starting emulator')
lock = (BASE/'suite.lock').open('a')
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
state = subprocess.run(['systemctl', '--user', 'is-active', '--quiet', CONFIG.service])
if state.returncode == 0: raise SystemExit('Emulator already running; stop it before starting a destructive clean-snapshot suite')
run = BASE/'results'/(datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+uuid.uuid4().hex[:8])
run.mkdir(parents=True)
os.environ['CONSTRUCT_RESULTS'] = str(run)
from ui import adb
receipt = {'started': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'apkSha256': actual,
           'complete': False, 'scope': 'Checklist regression, classified bounded probes, injected renderer loss, and tone grant lifecycle; not complete sandbox/egress proof'}

if a.reliability_only: receipt['scope'] = 'Repeated bundled Hello lifecycle/accessibility transitions; no remote module or camera acceptance'

if a.modules_only:
    receipt['scope'] = 'Only explicitly supplied Focus/Snake/Contacts module suites; no host baseline checks rerun'

if a.tone_consent_only:
    receipt['scope'] = 'Tone and consent on a clean snapshot, plus explicitly requested module suites; checklist/probes/renderer NOT rerun'

if a.focus_only:
    receipt['scope'] = 'Focus module only on the exact supplied APK; host regression checks not rerun in this receipt'

if a.snake_only:
    receipt['scope'] = 'Snake module only on the exact supplied APK; host regression checks not rerun in this receipt'

if a.contacts_only:
    receipt['scope'] = 'Synthetic contacts only; host regression not rerun in this receipt'

if a.camera_only:
    receipt['scope'] = 'Synthetic emulated camera only; separate baseline required for host changes'
if a.camera_gallery_export: receipt['scope'] += '; explicit gallery export, MediaStore publication and independent copy lifetime'
if a.camera_vision_only: receipt['scope'] = 'Native selected-photo face/object analysis only, offline with public-domain/CC0 fixtures; camera and host baselines separate'

if a.camera_reopen_only: receipt['scope']='Camera direct-Reopen only; not capture, quota or host regression acceptance'

if a.camera_fresh_launches:
    receipt['scope'] += '; fresh host launches after access changes: direct-Reopen accessibility is EXCLUDED, not passed'
    receipt['knownLimitations'] = ['Intermittent WebView accessibility descendants missing after native dialogs/direct Reopen']

def save(): (run/'suite-result.json').write_text(json.dumps(receipt, indent=2)+'\n')

def control(*args): subprocess.run([str(BASE/'runner.sh'), *args], check=True, timeout=90)

save()
print('RESULTS:', run, flush=True)
try:
    camera_flag = BASE/'camera-emulated.flag'
    if a.camera_sha256: camera_flag.write_text('emulated\n')
    else: camera_flag.unlink(missing_ok=True)
    snapshot = 'camera-clean' if a.camera_sha256 else 'clean'
    avd = 'construct-camera36' if a.camera_sha256 else 'construct-api36'
    if not (CONFIG.avd/(avd+'.avd')/'snapshots'/snapshot/'snapshot.pb').is_file():
        raise RuntimeError('Required clean snapshot missing: '+snapshot)
    control('start')
    deadline = time.monotonic()+180
    while True:
        try:
            if adb('shell', 'getprop', 'sys.boot_completed', timeout=10).strip() == '1': break
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired): pass
        if time.monotonic() > deadline: raise RuntimeError('Android boot timed out')
        time.sleep(2)
    invocation=subprocess.check_output(['systemctl','--user','show',CONFIG.service,'-p','InvocationID','--value'],text=True).strip()
    startup=subprocess.check_output(['journalctl','--user','_SYSTEMD_INVOCATION_ID='+invocation,'--no-pager'],text=True)
    (run/'emulator-startup.log').write_text(startup)
    if "Successfully loaded snapshot '"+snapshot+"'" not in startup:
        raise RuntimeError('No fresh evidence of successful clean snapshot restore')
    receipt['snapshot']={'avd':avd,'name':snapshot,'invocation':invocation,'loaded':True}
    # Also prove the restored snapshot is app-free, not stale acceptance state.
    if 'package:dev.construct.runtime' in adb('shell', 'pm', 'list', 'packages', 'dev.construct.runtime'):
        raise RuntimeError('Clean snapshot contains Construct; refusing stale-state acceptance')
    if a.disable_digital_wellbeing:
        package = 'com.google.android.apps.wellbeing'
        present = 'package:'+package in adb('shell', 'pm', 'list', 'packages', package).splitlines()
        if present:
            adb('shell', 'pm', 'disable-user', '--user', '0', package)
            if 'package:'+package not in adb('shell', 'pm', 'list', 'packages', '-d', package).splitlines():
                raise RuntimeError('Digital Wellbeing environment override did not apply')
        receipt['environmentOverrides'] = {'digitalWellbeing': 'disabled-user' if present else 'not installed'}
    receipt['fingerprint'] = adb('shell', 'getprop', 'ro.build.fingerprint').strip()
    receipt['webviewBefore'] = adb('shell', 'dumpsys', 'webviewupdate')
    if a.webview_apk:
        if adb('shell', 'getprop', 'ro.debuggable').strip() != '1':
            raise RuntimeError('Development WebView comparison requires a disposable userdebug image')
        adb('install', '-r', str(a.webview_apk.resolve()), timeout=180)
        selection = adb('shell', 'cmd', 'webviewupdate', 'set-webview-implementation', 'com.android.webview')
        if 'Success' not in selection: raise RuntimeError('Chromium WebView provider selection failed: '+selection)
        receipt['webviewOverride'] = {'package': 'com.android.webview', 'sha256': a.webview_sha256.lower(), 'selection': selection.strip()}
    receipt['webview'] = adb('shell', 'dumpsys', 'webviewupdate')
    if a.webview_apk and 'Current WebView package (name, version): (com.android.webview,' not in receipt['webview']:
        raise RuntimeError('Selected WebView is not the requested Chromium provider')
    receipt['emulatorVersion'] = subprocess.check_output([str(CONFIG.sdk/'emulator/emulator'), '-version'], text=True)
    adb('install', '-r', str(a.apk.resolve()), timeout=90)
    receipt['package'] = adb('shell', 'dumpsys', 'package', 'dev.construct.runtime')
    children = [('smoke.py', 'smoke-result.json'), ('probes.py', 'probe-summary.json'), ('renderer.py', 'renderer-result.json'), ('tone.py', 'tone-result.json'), ('consent.py', 'consent-result.json')]
    if a.tone_consent_only: children = children[3:]
    if a.reliability_only: children = [('reliability.py', 'reliability-result.json')]
    if a.modules_only or a.focus_only or a.snake_only or a.contacts_only or a.camera_only: children = []
    if a.focus_sha256:
        os.environ['CONSTRUCT_FOCUS_SHA256'] = a.focus_sha256
        children.append(('focus.py', 'focus-result.json'))
    if a.snake_sha256:
        os.environ['CONSTRUCT_SNAKE_SHA256'] = a.snake_sha256
        children.append(('snake.py', 'snake-result.json'))
    if a.contacts_sha256:
        os.environ['CONSTRUCT_CONTACTS_SHA256'] = a.contacts_sha256
        children.append(('contacts.py', 'contacts-result.json'))
    if a.camera_sha256:
        os.environ['CONSTRUCT_CAMERA_SHA256'] = a.camera_sha256
        children.append(('vision.py' if a.camera_vision_only else 'camera.py', 'camera-result.json'))
    for script, result in children:
        with (run/(script+'.log')).open('w') as log:
            subprocess.run([str(BASE/'venv/bin/python'), str(BASE/script)], check=True,
                           stdout=log, stderr=subprocess.STDOUT, timeout=900)
        if not json.loads((run/result).read_text()).get('complete'):
            raise RuntimeError('Incomplete child receipt: '+result)
    if not (a.reliability_only or a.modules_only or a.focus_only or a.snake_only or a.contacts_only or a.camera_only):
        if not a.tone_consent_only:
            receipt['probeCounts'] = json.loads((run/'probe-summary.json').read_text())['counts']
            receipt['rendererVerdict'] = json.loads((run/'renderer-result.json').read_text())['verdict']
        receipt['toneChecks'] = json.loads((run/'tone-result.json').read_text())['checks']
        receipt['consentChecks'] = json.loads((run/'consent-result.json').read_text())['checks']
        if json.loads((run/'consent-result.json').read_text())['environment']['apkSha256'] != actual:
            raise RuntimeError('In-app APK hash does not match installed artifact')
    if a.focus_sha256:
        receipt['focus'] = json.loads((run/'focus-result.json').read_text())
        if receipt['focus']['environment']['apkSha256'] != actual:
            raise RuntimeError('Focus report APK hash does not match installed artifact')
    if a.snake_sha256:
        receipt['snake'] = json.loads((run/'snake-result.json').read_text())
        if receipt['snake']['environment']['apkSha256'] != actual:
            raise RuntimeError('Snake report APK hash does not match installed artifact')
    if a.contacts_sha256:
        receipt['contacts'] = json.loads((run/'contacts-result.json').read_text())
        if receipt['contacts']['environment']['apkSha256'] != actual:
            raise RuntimeError('Contacts report APK hash mismatch')
    if a.camera_sha256:
        receipt['camera'] = json.loads((run/'camera-result.json').read_text())
        if receipt['camera']['environment']['apkSha256'] != actual:
            raise RuntimeError('Camera report APK hash mismatch')
    receipt['complete'] = True
except Exception as error:
    receipt['error'] = str(error)
    raise
finally:
    try:
        receipt['resources'] = subprocess.check_output(['systemctl','--user','show',CONFIG.service,'-p','MemoryPeak','-p','MemoryCurrent','-p','NRestarts'],text=True)
        control('stop')
        receipt['stopped'] = subprocess.run(['systemctl','--user','is-active','--quiet',CONFIG.service]).returncode != 0
        if not receipt['stopped']: receipt['complete'] = False
    except Exception as error:
        receipt['complete'] = False
        receipt['cleanupError'] = str(error)
    (BASE/'camera-emulated.flag').unlink(missing_ok=True)
    receipt['finished'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    save()
    print(json.dumps({'results':str(run), 'complete':receipt['complete'], 'stopped':receipt.get('stopped')}),flush=True)
if not receipt['complete']: raise SystemExit(1)
