#!/usr/bin/env python3
"""Alpha6 consent/revoke UX; requires the full suite's confirmed tone0.1 with revoked access."""
from config import CONFIG, SERIAL, require_runner
import json
import socket
import time
from ui import adb, nodes, labels, tap, tap_node, find, capture, RESULTS
from host_ui import restart, diagnostics, select_after, installed_status, catalog_settings, apply_catalog, configured_catalog, library, host_ready, modern
require_runner()
result = {'complete': False, 'checks': []}

def done(name):
    result['checks'].append(name); print('PASS:', name, flush=True)

def top():
    if modern(): return library()
    for _ in range(6):
        if 'Use configured registry' in labels(): return
        adb('shell', 'input', 'swipe', '360', '450', '360', '1050', '300')
    raise RuntimeError('Catalog controls missing')

def switch():
    find('Allow short tones')
    previous = None
    until = time.monotonic()+8
    while time.monotonic() < until:
        matches = [n for n in nodes() if n.get('content-desc') == 'Allow short tones' and n.get('checkable') == 'true']
        if len(matches) == 1:
            current = matches[0]
            if previous is not None and current.get('bounds') == previous.get('bounds'): return current
            previous = current
        time.sleep(.25)
    raise RuntimeError('Tone switch not uniquely identified at stable bounds')

def checked(expected):
    until = time.monotonic()+8
    while time.monotonic() < until:
        if (switch().get('checked') == 'true') == expected: return
        time.sleep(.25)
    raise RuntimeError('Unexpected saved/consent grant')

def status(prefix):
    until = time.monotonic()+10
    while time.monotonic() < until:
        if any(t.startswith(prefix) for t in labels()): return
        time.sleep(.3)
    raise RuntimeError('Missing result: '+prefix)

try:
    restart(); configured_catalog(); find('Catalog refreshed.')
    select_after('Pocket Tones · 0.2.0', ('Review version',))
    find('Allow short tones'); find('Required for this module'); find('device.tone')
    checked(False); tap_node(switch()); checked(True); capture('consent-tone-on')
    tap('Cancel')
    top(); select_after('Pocket Tones · 0.1.0', ('Module access',)); checked(False); tap('Back')
    done('Canceling consent does not change the installed grant')
    top(); baseline = {json.dumps(e, sort_keys=True) for e in diagnostics()}
    top(); select_after('Pocket Tones · 0.2.0', ('Review version',))
    checked(False); tap_node(switch()); checked(True); tap('Allow & install')
    installed_status()
    top(); select_after('Pocket Tones · 0.2.0', ('Module access',)); checked(True)
    tap('Reopen module'); find('Pocket Tones'); tap('Play double beep'); status('TONE_ACCEPTED: double')
    capture('consent-double-accepted'); tap('Module access')
    done('Explicit consent grants access atomically; Reopen plays the double pattern')
    tap_node(switch()); find('Turn off required access?'); tap('Keep access'); checked(True)
    done('Canceling required-access revocation retains the grant')
    tap_node(switch()); find('Turn off required access?'); tap('Turn off'); find('Allow short tones: off.'); checked(False)
    tap('Reopen module'); tap('Play beep'); status('CAPABILITY_DENIED:'); capture('consent-revoked'); tap('Close module')
    done('Confirmed required-access revocation applies before reopening')
    top(); events = diagnostics()
    environment = [e for e in events if e.get('code') == 'ENVIRONMENT']
    if len(environment) != 1: raise RuntimeError('Missing unique environment report')
    meta = environment[0]
    if not meta.get('apkSha256') or not meta.get('deviceModel') or not meta.get('webviewVersion'):
        raise RuntimeError('Incomplete device/build metadata')
    result['environment'] = meta
    fresh = [e for e in events if e.get('moduleId') == 'dev.construct.tone' and json.dumps(e, sort_keys=True) not in baseline]
    codes = [e.get('code') for e in fresh]
    if codes.count('TONE_STARTED') != 1 or codes.count('TONE_STOPPED') != 1:
        raise RuntimeError('Expected only the granted double-tone start/stop, none after revocation')
    result['events'] = fresh
    done('Diagnostics include real APK/device/WebView metadata, not an audibility claim')
    result['complete'] = True
except Exception as error:
    result['error'] = str(error)
    try: capture('consent-failure')
    except Exception: pass
    raise
finally:
    (RESULTS/'consent-result.json').write_text(json.dumps(result, indent=2)+'\n')
