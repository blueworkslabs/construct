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
p.add_argument('--camera-ux-layouts', action='store_true', help='Also exercise redesigned native camera controls at Android 2x font in portrait/landscape')
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
p.add_argument('--measure-only', action='store_true', help='Only synthetic native photo measurement; separate host baseline required')
p.add_argument('--measure-sha256', help='Exact signed Pocket Measure launcher')
for module, default in [('focus','0.1.2'),('snake','0.1.5'),('contacts','0.2.1'),('measure','0.1.2')]:
    p.add_argument('--'+module+'-version', default=default, help='Exact numeric version paired with the module hash')
p.add_argument('--ux-layouts-only', action='store_true', help='Only native font/landscape continuation with the pinned Checklist fixture; other UX checks excluded')
p.add_argument('--ux-candidates', type=Path, help='Only Library/Browse and eight refreshed package UI checks; JSON exact candidate metadata')
p.add_argument('--sky-only', action='store_true', help='Foreground Sky Watch map, provider, location and lifecycle acceptance only')
p.add_argument('--sky-details', action='store_true', help='Also exercise alpha25 aircraft identity and opt-in metadata dialog')
p.add_argument('--sky-location-only', action='store_true', help='Only Sky Watch location/lifecycle continuation, excluding map/source/layout acceptance')
p.add_argument('--sky-sha256', help='Exact signed Sky Watch 0.1.0 launcher')
p.add_argument('--sky-module-candidates', type=Path, help='Exact module-owned Sky and synthetic update artifact metadata; separate scope')
p.add_argument('--http-consent-candidates', type=Path, help='Only signed HTTP/location consent regressions and old-to-new APK upgrade; disposable app data')
a = p.parse_args()
if a.http_consent_candidates:
    if any((a.sky_module_candidates,a.sky_only,a.ux_candidates,a.measure_only,a.reliability_only,a.modules_only,a.tone_consent_only,a.focus_sha256,a.snake_sha256,a.contacts_sha256,a.camera_sha256,a.camera_only,a.focus_only,a.snake_only,a.contacts_only)):
        p.error('HTTP consent cannot mix scopes')
    consent=json.loads(a.http_consent_candidates.read_text())
    from config import catalog as validate_catalog
    validate_catalog(consent['catalog'])
    validate_catalog(consent['locationCatalog'])
    if hashlib.sha256(Path(consent['oldApk']).read_bytes()).hexdigest()!=consent['oldSha256']:
        p.error('Old consent APK checksum mismatch')
    for item in [*consent['versions'],*consent['locationVersions']]:
        if not __import__('re').fullmatch(r'[0-9a-f]{64}',item['sha256']): p.error('Invalid consent artifact hash')
        if not __import__('re').fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',item['version']): p.error('Invalid consent artifact version')
    consent.update(newApk=str(a.apk.resolve()),newSha256=a.sha256.lower())
    os.environ['CONSTRUCT_HTTP_CONSENT_CANDIDATES']=json.dumps(consent)
if a.sky_module_candidates:
    if any((a.sky_only,a.ux_candidates,a.measure_only,a.reliability_only,a.modules_only,a.tone_consent_only,a.focus_sha256,a.snake_sha256,a.contacts_sha256,a.camera_sha256,a.camera_only,a.focus_only,a.snake_only,a.contacts_only)):
        p.error('Modular Sky cannot mix scopes')
    modular=json.loads(a.sky_module_candidates.read_text())
    # Each catalog is an explicit operator-selected HTTPS source, not a module URL.
    from config import catalog as validate_catalog
    for key in ('catalog','updateCatalog'):
        validate_catalog(modular[key])
    for item in [modular['sky'],*modular['updates']]:
        if not __import__('re').fullmatch(r'[0-9a-f]{64}',item['sha256']): p.error('Invalid modular artifact hash')
        if not __import__('re').fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+',item['version']): p.error('Invalid modular artifact version')
    if len(modular['updates'])!=2: p.error('Two signed update fixture versions required')
    os.environ['CONSTRUCT_SKY_MODULE_CANDIDATES']=json.dumps(modular)

if a.sky_details and (not a.sky_only or a.sky_location_only): p.error('Sky details requires the full sky-only run')
os.environ['CONSTRUCT_SKY_DETAILS']='1' if a.sky_details else '0'
if a.sky_location_only and not a.sky_only: p.error('Sky location continuation requires sky-only')
os.environ['CONSTRUCT_SKY_LOCATION_ONLY']='1' if a.sky_location_only else '0'
if a.sky_only != bool(a.sky_sha256): p.error('Sky scope requires both sky-only and sky-sha256')
if a.sky_only and any((a.ux_candidates,a.measure_only,a.reliability_only,a.modules_only,a.tone_consent_only,a.focus_sha256,a.snake_sha256,a.contacts_sha256,a.camera_sha256,a.camera_only,a.focus_only,a.snake_only,a.contacts_only)): p.error('Sky-only cannot mix scopes')
if a.sky_sha256 and not __import__('re').fullmatch(r'[0-9a-f]{64}',a.sky_sha256): p.error('Invalid Sky Watch hash')
if a.ux_layouts_only and not a.ux_candidates: p.error('UX layout scope requires exact candidate metadata')
os.environ['CONSTRUCT_UX_LAYOUTS_ONLY']='1' if a.ux_layouts_only else '0'
if a.ux_candidates:
    if any((a.measure_only,a.camera_sha256,a.focus_sha256,a.snake_sha256,a.contacts_sha256,a.reliability_only,a.modules_only,a.tone_consent_only,a.camera_only,a.focus_only,a.snake_only,a.contacts_only)): p.error('UX-only cannot mix other scopes')
    ux_candidates=json.loads(a.ux_candidates.read_text())
    if not isinstance(ux_candidates,list) or len(ux_candidates)!=8: p.error('UX requires eight exact candidate entries')
    if len({entry['id'] for entry in ux_candidates})!=8: p.error('Duplicate UX module identity')
    for entry in ux_candidates:
        if not __import__('re').fullmatch(r'[0-9a-f]{64}',entry['sha256']): p.error('Invalid UX candidate hash')
    os.environ['CONSTRUCT_UX_CANDIDATES']=json.dumps([{k:e[k] for k in ('id','name','version','sha256')} for e in ux_candidates])
if a.measure_only != bool(a.measure_sha256): p.error('Measure scope requires both measure-only and measure-sha256')
if a.measure_only and any((a.camera_sha256,a.focus_sha256,a.snake_sha256,a.contacts_sha256,a.reliability_only,a.modules_only,a.tone_consent_only,a.camera_only,a.focus_only,a.snake_only,a.contacts_only)): p.error('Measure-only cannot mix other scopes')
if a.reliability_only and any((a.camera_sha256, a.focus_sha256, a.snake_sha256, a.contacts_sha256, a.tone_consent_only, a.modules_only)): p.error('Reliability scope cannot mix other module scopes')
if a.camera_vision_only and (not a.camera_only or not a.camera_sha256 or a.camera_gallery_export or a.camera_reopen_only): p.error('Vision scope requires camera-only/hash and cannot mix gallery or reopen scopes')
if a.camera_gallery_export and (not a.camera_only or not a.camera_sha256 or a.camera_reopen_only): p.error('Gallery export requires full camera-only/hash acceptance, not reopen-only')
if not __import__('re').fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+', a.camera_version): p.error('Camera version must be a numeric release version')
if a.camera_ux_layouts and (not a.camera_only or not a.camera_gallery_export or a.camera_vision_only): p.error('Camera UX layouts require full camera/gallery scope')
os.environ['CONSTRUCT_CAMERA_UX_LAYOUTS']='1' if a.camera_ux_layouts else '0'
os.environ['CONSTRUCT_CAMERA_VERSION'] = a.camera_version
for module in ('focus','snake','contacts','measure'):
    version = getattr(a, module+'_version')
    if not __import__('re').fullmatch(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)', version): p.error('Module version must be a canonical numeric release')
    os.environ['CONSTRUCT_'+module.upper()+'_VERSION'] = version
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

if a.sky_module_candidates: receipt['scope']='Module-owned Sky live providers, native HTTP/location grants, lifecycle, layouts and separate synthetic module-only update/rollback; not physical GPS or full host baseline'
if a.http_consent_candidates: receipt['scope']='Signed synthetic HTTP/location consent removal/narrowing, rollback and old-to-new APK upgrade; no live provider or full host baseline checks'

if a.sky_only: receipt['scope']='Sky Watch native foreground map, source switching, live provider responses, optional synthetic location and lifecycle; not physical GPS accuracy or host baseline'

if a.sky_location_only: receipt['scope']='Sky Watch synthetic foreground location, denial, background, offline and revoke continuation only; map/source/layout checks excluded'

if a.ux_layouts_only: receipt['scope']='Native font and landscape UX continuation only; previous Library/catalog/package/task checks are EXCLUDED, not rerun'

if a.ux_candidates and not a.ux_layouts_only: receipt['scope']='Library/Browse latest-first, explicit signed versions, refreshed package identity, module layout and native font/rotation; not full module/native capability regression'

if a.measure_only: receipt['scope'] = 'Synthetic selected-photo planar measurement only; no real-camera accuracy claim or host baseline'

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
    avd,snapshot,_ = CONFIG.profile(bool(a.camera_sha256))
    if not (CONFIG.avd/(avd+'.avd')/'snapshots'/snapshot/'snapshot.pb').is_file():
        raise RuntimeError('Required clean snapshot missing: '+snapshot)
    control('start')
    deadline = time.monotonic()+180
    while True:
        try:
            if adb('shell', 'getprop', 'sys.boot_completed', timeout=10).strip() == '1': break
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired): pass
        service_state = subprocess.check_output(['systemctl','--user','show',CONFIG.service,'-p','ActiveState','--value'],text=True).strip()
        if service_state == 'failed': raise RuntimeError('Emulator service failed during startup; inspect its journal')
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
    receipt['apiLevel'] = int(adb('shell','getprop','ro.build.version.sdk').strip())
    if receipt['apiLevel'] != CONFIG.api_level: raise RuntimeError('Restored Android API differs from configured test platform')
    receipt['guestMemoryMiB'] = CONFIG.memory_mb
    receipt['directMemory'] = CONFIG.direct_memory
    receipt['pageSize'] = int(adb('shell','getconf','PAGESIZE').strip())
    receipt['memoryLimiter'] = adb('shell','am','memory-limiter','status') if CONFIG.api_level >= 37 else 'not queried'
    receipt['fingerprint'] = adb('shell', 'getprop', 'ro.build.fingerprint').strip()
    receipt['webviewBefore'] = adb('shell', 'dumpsys', 'webviewupdate')
    if a.webview_apk:
        if adb('shell', 'getprop', 'ro.debuggable').strip() != '1':
            raise RuntimeError('Development WebView comparison requires a disposable userdebug image')
        # Preserve a settled, precompiled provider only when its installed bytes
        # match the requested artifact. A matching version alone is insufficient.
        from webview_provider import installed_provider_sha
        installed_sha = installed_provider_sha(adb)
        reused = installed_sha == a.webview_sha256.lower()
        if not reused:
            adb('install', '-r', str(a.webview_apk.resolve()), timeout=180)
        selection = adb('shell', 'cmd', 'webviewupdate', 'set-webview-implementation', 'com.android.webview')
        if 'Success' not in selection: raise RuntimeError('Chromium WebView provider selection failed: '+selection)
        receipt['webviewOverride'] = {'package': 'com.android.webview', 'sha256': a.webview_sha256.lower(), 'selection': selection.strip(), 'installation': 'reused-verified' if reused else 'installed'}
    receipt['webview'] = adb('shell', 'dumpsys', 'webviewupdate')
    if a.webview_apk and 'Current WebView package (name, version): (com.android.webview,' not in receipt['webview']:
        raise RuntimeError('Selected WebView is not the requested Chromium provider')
    receipt['emulatorVersion'] = subprocess.check_output([str(CONFIG.sdk/'emulator/emulator'), '-version'], text=True)
    adb('install', '-r', str(a.apk.resolve()), timeout=90)
    receipt['package'] = adb('shell', 'dumpsys', 'package', 'dev.construct.runtime')
    # A RAM snapshot can retain logcat from before it became app-free. Do not
    # attribute those historical warnings to the newly installed candidate.
    adb('logcat', '-c')
    receipt['logcatResetBeforeChildren'] = True
    children = [('smoke.py', 'smoke-result.json'), ('probes.py', 'probe-summary.json'), ('renderer.py', 'renderer-result.json'), ('tone.py', 'tone-result.json'), ('consent.py', 'consent-result.json')]
    if a.tone_consent_only: children = children[3:]
    if a.reliability_only: children = [('reliability.py', 'reliability-result.json')]
    if a.measure_only or a.modules_only or a.focus_only or a.snake_only or a.contacts_only or a.camera_only: children = []
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
    if a.measure_only:
        os.environ['CONSTRUCT_MEASURE_SHA256'] = a.measure_sha256
        children.append(('measure.py', 'measure-result.json'))
    if a.ux_candidates: children=[('ux.py','ux-result.json')]
    if a.sky_only:
        os.environ['CONSTRUCT_SKY_SHA256']=a.sky_sha256
        children=[('sky.py','sky-result.json')]
    if a.sky_module_candidates: children=[('sky_module.py','sky-module-result.json')]
    if a.http_consent_candidates: children=[('http_consent.py','http-consent-result.json')]
    for script, result in children:
        with (run/(script+'.log')).open('w') as log:
            subprocess.run([str(BASE/'venv/bin/python'), str(BASE/script)], check=True,
                           stdout=log, stderr=subprocess.STDOUT, timeout=1800 if script in ('ux.py','sky_module.py') else 900)
        if not json.loads((run/result).read_text()).get('complete'):
            raise RuntimeError('Incomplete child receipt: '+result)
    if not (a.http_consent_candidates or a.sky_module_candidates or a.sky_only or a.ux_candidates or a.measure_only or a.reliability_only or a.modules_only or a.focus_only or a.snake_only or a.contacts_only or a.camera_only):
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
    if a.measure_only:
        receipt['measure'] = json.loads((run/'measure-result.json').read_text())
        if receipt['measure']['environment']['apkSha256'] != actual: raise RuntimeError('Measure APK hash mismatch')
    if a.ux_candidates:
        receipt['ux']=json.loads((run/'ux-result.json').read_text())
        if receipt['ux']['environment']['apkSha256'] != actual: raise RuntimeError('UX APK hash mismatch')
    if a.sky_only:
        receipt['sky']=json.loads((run/'sky-result.json').read_text())
        if receipt['sky']['environment']['apkSha256'] != actual: raise RuntimeError('Sky APK hash mismatch')
    if a.sky_module_candidates:
        receipt['skyModule']=json.loads((run/'sky-module-result.json').read_text())
        if receipt['skyModule']['environment']['apkSha256'] != actual: raise RuntimeError('Modular Sky APK hash mismatch')
    if a.http_consent_candidates:
        receipt['httpConsent']=json.loads((run/'http-consent-result.json').read_text())
        if receipt['httpConsent']['environment']['apkSha256'] != actual: raise RuntimeError('HTTP consent APK hash mismatch')
    receipt['complete'] = True
except Exception as error:
    receipt['error'] = str(error)
    raise
finally:
    if receipt.get('logcatResetBeforeChildren'):
        try:
            (run/'android-crashes.log').write_text(adb('logcat','-b','crash','-d'))
            (run/'android-runtime.log').write_text(adb('logcat','-d','-t','10000'))
            (run/'process-exits.txt').write_text(adb('shell','dumpsys','activity','exit-info','dev.construct.runtime'))
            (run/'memory-at-end.txt').write_text(adb('shell','dumpsys','meminfo','dev.construct.runtime'))
            warnings = adb('logcat', '-d', '-s', 'cr_AwContents:W')
            (run/'webview-warnings.log').write_text(warnings)
            receipt['attachedDestroyWarnings'] = sum('destroy() called while WebView is still attached' in line for line in warnings.splitlines())
        except Exception as error:
            receipt['warningObservationError'] = str(error)
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
