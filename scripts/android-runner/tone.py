#!/usr/bin/env python3
"""Tone grant lifecycle on disposable staging. Native submission is not audibility proof."""
from config import CONFIG, SERIAL, require_runner
import json
import socket
import time
from ui import adb, labels, tap, tap_node, find, capture, RESULTS
from host_ui import restart, diagnostics, select_after, installed_status, catalog_settings, apply_catalog, configured_catalog, library, host_ready, modern

require_runner()
result = {'complete': False, 'scope': 'Grant/revoke lifecycle and native short-tone submission, not physical audibility', 'checks': []}
version = '0.1.0'

def done(name):
    result['checks'].append(name)
    print('PASS:', name, flush=True)

def top():
    if modern(): return library()
    for _ in range(6):
        if 'Use configured registry' in labels(): return
        adb('shell', 'input', 'swipe', '360', '450', '360', '1050', '250')
    raise RuntimeError('Host catalog controls unavailable')

def card(action):
    top()
    select_after('Pocket Tones · '+version, (action,))

def opened():
    card('Open'); find('Pocket Tones'); find('Ready. No sound until you press Play.')

def status(prefix):
    deadline = time.monotonic()+10
    while time.monotonic() < deadline:
        found = [text for text in labels() if text.startswith(prefix)]
        if found: return found[0]
        time.sleep(.25)
    raise RuntimeError('Missing tone status: '+prefix)

def access(allowed):
    if ('Construct menu' in labels() or 'Close module' in labels()) and 'Library' not in labels(): tap('Module access')
    else: card('Module access')
    switch = find('Allow short tones')
    # Text and switch share a label: require the actual checkable switch.
    from ui import nodes, tap_node
    matches = [n for n in nodes() if n.attrib.get('content-desc') == 'Allow short tones' and n.attrib.get('checkable') == 'true']
    if len(matches) != 1: raise RuntimeError('Cannot uniquely identify tone grant switch')
    switch = matches[0]
    checked = switch.attrib.get('checked') == 'true'
    if checked != allowed:
        tap_node(switch)
        if not allowed: tap('Turn off')  # Published tone fixtures declare this capability required.
        find('Allow short tones: '+('on.' if allowed else 'off.'))
    tap('Back')

def fresh_since(before):
    return [e for e in diagnostics() if json.dumps(e, sort_keys=True) not in before and e.get('moduleId') == 'dev.construct.tone']

def snapshot_events():
    top()
    return {json.dumps(e, sort_keys=True) for e in diagnostics()}

try:
    restart(); configured_catalog(); find('Catalog refreshed.')
    select_after('Pocket Tones · 0.1.0', ('Review & install',))
    tap('Allow & install'); installed_status()
    before = snapshot_events()
    opened(); tap('Play beep'); status('CAPABILITY_DENIED:')
    capture('tone-default-denied'); tap('Close module')
    events = fresh_since(before)
    if any(e.get('code') == 'TONE_STARTED' for e in events): raise RuntimeError('Denied tone produced native audio')
    done('Fresh install cannot play before an explicit grant')
    access(True)
    before = snapshot_events()
    opened(); tap('Play beep'); status('TONE_ACCEPTED:')
    time.sleep(.5)
    capture('tone-granted'); tap('Close module')
    events = fresh_since(before)
    codes = [e.get('code') for e in events]
    if codes.count('TONE_STARTED') != 1 or codes.count('TONE_STOPPED') != 1:
        raise RuntimeError('Expected exactly one native start and stop')
    result['playbackEvents'] = events
    done('Explicit grant permits one bounded native start/stop')
    before = snapshot_events()
    opened()
    button = find('Play beep')
    tap_node(button); tap_node(button)
    status('RATE_LIMIT:')
    time.sleep(.5)
    tap('Close module')
    events = fresh_since(before)
    if sum(e.get('code') == 'TONE_STARTED' for e in events) != 1:
        raise RuntimeError('Rapid requests did not produce exactly one tone')
    done('Rapid repeated requests are rate-limited without overlapping playback')
    before = snapshot_events()
    adb('shell', 'cmd', 'notification', 'set_dnd', 'none')
    try:
        opened(); tap('Play beep'); status('AUDIO_MUTED:'); tap('Close module')
        if any(e.get('code') == 'TONE_STARTED' for e in fresh_since(before)):
            raise RuntimeError('Do Not Disturb allowed native tone')
    finally:
        adb('shell', 'cmd', 'notification', 'set_dnd', 'all')
    done('Do Not Disturb rejects playback without native start')
    opened(); tap('Mark working')
    access(False)
    restart()
    before = snapshot_events()
    opened(); tap('Play beep'); status('CAPABILITY_DENIED:'); tap('Close module')
    if any(e.get('code') == 'TONE_STARTED' for e in fresh_since(before)): raise RuntimeError('Revoked tone started after restart')
    done('Revocation survives host process restart')
    top(); select_after('Pocket Tones · 0.2.0', ('Review version',))
    tap('Allow & install'); installed_status()
    version = '0.2.0'
    opened(); find('Play double beep'); tap('Play double beep'); status('CAPABILITY_DENIED:'); tap('Close module')
    done('Update adds double-beep UI but cannot restore revoked access')
    card('Roll back'); tap('Restore'); find('Previous working code restored. Module data kept.')
    version = '0.1.0'
    opened(); tap('Play beep'); status('CAPABILITY_DENIED:')
    if 'Play double beep' in labels(): raise RuntimeError('Update control survived rollback')
    capture('tone-rollback-denied')
    # Entering native access controls from a running module closes its WebView.
    access(True)
    before = snapshot_events()
    opened(); tap('Play beep'); status('TONE_ACCEPTED:')
    adb('shell', 'input', 'keyevent', '3')
    # HOME dispatch can return before the launcher transition completes. Observe
    # a genuine background interval instead of foregrounding after a fixed 600ms.
    deadline = time.monotonic() + 10
    while True:
        activity_state = adb('shell', 'dumpsys', 'activity', 'activities')
        resumed = [line for line in activity_state.splitlines()
                   if 'ResumedActivity:' in line or 'topResumedActivity=' in line]
        if resumed and all('dev.construct.runtime' not in line for line in resumed):
            break
        if time.monotonic() > deadline:
            raise RuntimeError('HOME did not move Construct out of the resumed activity')
        time.sleep(.25)
    (RESULTS/'tone-after-home.txt').write_text(activity_state)
    # Leave the app in the background long enough for the stop transition;
    # the following original checks still require actual session/native cleanup.
    time.sleep(2)
    (RESULTS/'tone-before-return.txt').write_text(adb('shell', 'dumpsys', 'activity', 'activities'))
    adb('shell', 'am', 'start', '-n', 'dev.construct.runtime/.MainActivity')
    find('Module stopped.')
    top(); host_ready()
    events = fresh_since(before)
    if not any(e.get('code') == 'TONE_STOPPED' for e in events): raise RuntimeError('No native stop before/after background')
    if ('Construct menu' in labels() or 'Close module' in labels()) and 'Library' not in labels(): raise RuntimeError('Background left module running')
    done('Rollback retains revocation; regrant works and background closes module')
    access(False)
    result['complete'] = True
except Exception as error:
    result['error'] = str(error)
    try: capture('tone-failure')
    except Exception: pass
    raise
finally:
    (RESULTS/'tone-result.json').write_text(json.dumps(result, indent=2)+'\n')
