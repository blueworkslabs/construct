#!/usr/bin/env python3
"""Real native consent and bridge checks on a disposable old/new APK pair.

Run only through suite.py's locked, app-free snapshot lifecycle. Resets only the
disposable Construct app to reproduce historical consent state twice.
"""
import hashlib
import json
import os
from pathlib import Path
import time
from config import require_runner
import ui
from ui import adb,nodes,find,tap,tap_node,capture,RESULTS
from host_ui import restart,diagnostics,select_after,installed_status,catalog_settings,apply_catalog,library
from catalog_input import replace_text

require_runner()
C=json.loads(os.environ['CONSTRUCT_HTTP_CONSENT_CANDIDATES'])
versions={v['version']:v['sha256'] for v in C['versions']}
NAME='Consent Probe'; SWITCH='Allow approved internet sources'
PROBE='Check HTTP access'; PREFIX='HTTP result: '
result={'complete':False,'checks':[],'oldSha256':C['oldSha256'],
        'scope':'Synthetic HTTP/location consent plus a coarse-only mock network fix; HTTP probes are rejected locally; no real position or outbound request'}
for path,digest in [(C['oldApk'],C['oldSha256']),(C['newApk'],C['newSha256'])]:
    if hashlib.sha256(Path(path).read_bytes()).hexdigest()!=digest:raise RuntimeError('APK checksum mismatch')

def done(name):
    result['checks'].append(name)
    (RESULTS/'http-consent-result.json').write_text(json.dumps(result,indent=2)+'\n')
    print('PASS:',name,flush=True)

def verify_apk(expected):
    paths=adb('shell','pm','path','dev.construct.runtime').splitlines()
    if len(paths)!=1 or not paths[0].startswith('package:/data/app/'):raise RuntimeError('Unexpected installed APK path')
    actual=adb('shell','sha256sum',paths[0].removeprefix('package:')).split()[0]
    if actual!=expected:raise RuntimeError('Installed APK checksum mismatch')

def use_catalog():
    catalog_settings()
    replace_text(nodes,lambda value:ui._device(className='android.widget.EditText',packageName='dev.construct.runtime').set_text(value),C['catalog'])
    adb('shell','input','keyevent','111');apply_catalog();find('Catalog refreshed.')

def install(version,expected=None,approve=False):
    select_after(NAME+' · '+version,('Review & install',));find('Allow & install')
    if expected is not None:
        deadline=time.monotonic()+20
        while time.monotonic()<deadline:
            matches=[n for n in nodes() if n.get('content-desc')==SWITCH and n.get('checkable')=='true']
            if len(matches)==1:
                before=matches[0].get('bounds');time.sleep(.4)
                stable=[n for n in nodes() if n.get('content-desc')==SWITCH and n.get('checkable')=='true' and n.get('bounds')==before]
                if len(stable)==1:break
            time.sleep(.3)
        else:raise RuntimeError('Trusted HTTP switch did not settle')
        if stable[0].get('checked')!=str(expected).lower():raise RuntimeError('Unexpected prior consent state')
        if approve:
            if expected:raise RuntimeError('Fixture must not toggle an already enabled switch')
            tap_node(stable[0])
    capture('consent-install-'+version+'-'+str(len(result['checks'])))
    tap('Allow & install');installed_status()
    events=diagnostics()
    if not any(e.get('code')=='INSTALLED_TRIAL' and e.get('moduleVersion')==version and e.get('packageDigest')==versions[version] for e in events):
        raise RuntimeError('Signed installed package digest missing from native diagnostics')
    library()

def probe(version,expected,count=3,keep=False):
    restart();library();select_after(NAME+' · '+version,('Open',))
    find(PROBE);find('Counter: '+str(count));tap(PROBE)
    find(PREFIX+expected);capture('consent-runtime-'+version+'-'+str(len(result['checks'])))
    tap('Construct menu');tap('Mark working' if keep else 'Close module');library()

def rollback(version):
    library();select_after(NAME+' · '+version,('Roll back',));tap('Restore');library()

def old_setup():
    # suite.py established an isolated app-free snapshot and owns the emulator lock.
    adb('uninstall','dev.construct.runtime')
    adb('install',str(Path(C['oldApk']).resolve()),timeout=120)
    verify_apk(C['oldSha256']);restart();use_catalog()
    install('1.1.0',expected=False,approve=True)
    select_after(NAME+' · 1.1.0',('Open',));find('Counter: 0')
    for value in range(1,4):tap('Add one');find('Counter: '+str(value))
    tap('Construct menu');tap('Mark working');library()

def upgrade():
    adb('shell','am','force-stop','dev.construct.runtime')
    adb('install','-r',str(Path(C['newApk']).resolve()),timeout=120)
    verify_apk(C['newSha256']);restart()

try:
    old_setup()
    install('1.2.0',expected=True);probe('1.2.0','HTTP_SOURCE',keep=True)
    rollback('1.2.0');probe('1.1.0','HTTP_SOURCE')
    done('Old APK reproduces wider HTTP consent resurrection after untouched-switch narrowing and rollback')
    install('1.2.0',expected=True);probe('1.2.0','HTTP_SOURCE',keep=True)
    upgrade();probe('1.2.0','HTTP_SOURCE')
    rollback('1.2.0');probe('1.1.0','CAPABILITY_DENIED')
    done('In-place host upgrade preserves counter and allowed narrow scope; rollback cannot revive removed origin')

    old_setup()
    install('1.3.0');probe('1.3.0','CAPABILITY_DENIED',keep=True)
    install('1.4.0',expected=False);probe('1.4.0','HTTP_SOURCE')
    done('Old APK reproduces hidden HTTP grant after capability removal and reintroduction despite off install switch')
    rollback('1.4.0');probe('1.3.0','CAPABILITY_DENIED')
    upgrade()
    install('1.4.0',expected=False);probe('1.4.0','CAPABILITY_DENIED',keep=True)
    done('In-place host upgrade blocks stale removed-capability consent on reintroduction; counter remains intact')

    # Fresh transitions on the corrected host, plus an explicit reapproval.
    install('1.1.0',expected=False,approve=True);probe('1.1.0','HTTP_SOURCE',keep=True)
    install('1.2.0',expected=True);probe('1.2.0','HTTP_SOURCE')
    rollback('1.2.0');probe('1.1.0','CAPABILITY_DENIED')
    done('Corrected host allows explicit HTTP approval but untouched-switch narrowing revokes removed origins on rollback')
    install('1.2.0',expected=False,approve=True);probe('1.2.0','HTTP_SOURCE',keep=True)
    install('1.3.0');probe('1.3.0','CAPABILITY_DENIED')
    rollback('1.3.0');probe('1.2.0','CAPABILITY_DENIED')
    done('Corrected host clears HTTP consent on capability removal, including rollback, without losing counter data')
    # Repeat with location; Android permission stays off, so no position is read.
    C['catalog']=C['locationCatalog']
    versions={v['version']:v['sha256'] for v in C['locationVersions']}
    NAME='Location Probe'; SWITCH='Allow reading phone location'
    PROBE='Check Location access'; PREFIX='Location result: '
    old_setup()
    install('1.2.0');probe('1.2.0','CAPABILITY_DENIED',keep=True)
    install('1.3.0',expected=False);probe('1.3.0','LOCATION_PERMISSION')
    done('Old APK reproduces hidden location module grant after removal and reintroduction; Android permission stays off')
    rollback('1.3.0');probe('1.2.0','CAPABILITY_DENIED')
    upgrade()
    install('1.3.0',expected=False);probe('1.3.0','CAPABILITY_DENIED',keep=True)
    done('In-place host upgrade blocks stale location consent on reintroduction and preserves counter data')
    install('1.1.0',expected=False,approve=True);probe('1.1.0','LOCATION_PERMISSION',keep=True)
    install('1.2.0');probe('1.2.0','CAPABILITY_DENIED',keep=True)
    install('1.3.0',expected=False);probe('1.3.0','CAPABILITY_DENIED')
    done('Corrected host permits explicit location grant but defaults reintroduced location off; no OS permission or position requested')
    # Separate, explicitly synthetic position test. GPS is enabled, but only the
    # coarse Android permission is granted; a network fix arrives after registration.
    install('1.5.0',expected=False,approve=True)
    mock_added=False
    try:
        adb('shell','appops','set','com.android.shell','android:mock_location','allow')
        adb('shell','cmd','location','providers','add-test-provider','network','--accuracy','2')
        mock_added=True
        adb('shell','cmd','location','providers','set-test-provider-enabled','network','true')
        adb('shell','pm','grant','dev.construct.runtime','android.permission.ACCESS_COARSE_LOCATION')
        permissions=adb('shell','dumpsys','package','dev.construct.runtime')
        if 'android.permission.ACCESS_FINE_LOCATION: granted=true' in permissions:raise RuntimeError('Expected coarse-only location permission')
        restart();select_after(NAME+' · 1.5.0',('Open',));find('Counter: 3');tap(PROBE);time.sleep(1)
        adb('shell','cmd','location','providers','set-test-provider-location','network','--location','50.0,8.0','--accuracy','5000')
        find('Location result: APPROXIMATE');capture('coarse-only-network-fix')
        tap('Construct menu');tap('Close module');library()
        done('Coarse-only Android permission delivers an approximate synthetic network fix without requiring fine/GPS access')
    finally:
        if mock_added:adb('shell','cmd','location','providers','remove-test-provider','network')
        adb('shell','appops','set','com.android.shell','android:mock_location','default')
    verify_apk(C['newSha256'])
    result['environment']={'apkSha256':C['newSha256']};result['complete']=True
except Exception as error:
    result['error']=str(error)
    try:capture('http-consent-failure')
    except Exception:pass
    raise
finally:
    (RESULTS/'http-consent-result.json').write_text(json.dumps(result,indent=2)+'\n')
