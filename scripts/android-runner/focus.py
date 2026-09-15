#!/usr/bin/env python3
"""Real WebView focus acceptance. Exact signed candidate; no physical-audibility claim."""
from config import CONFIG, SERIAL, require_runner
import json
import os
import socket
import time
from ui import adb, nodes, labels, tap, tap_node, find, capture, RESULTS
from host_ui import restart, diagnostics, select_after, installed_status
from focus_clock import clock_value
require_runner()
expected = os.environ['CONSTRUCT_FOCUS_SHA256']
result = {'complete':False, 'checks':[], 'moduleSha256':expected}
heading = 'Pocket Focus · 0.1.2'

def done(name):
    result['checks'].append(name); print('PASS:',name,flush=True)

def wait_clock(expected):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        try:
            if clock_value(nodes()) == expected: return
        except RuntimeError: pass
        time.sleep(.25)
    raise RuntimeError('Expected exact Focus clock: ' + expected)

def top():
    for _ in range(8):
        if 'Use configured registry' in labels(): return
        adb('shell','input','swipe','360','450','360','1050','300')
    raise RuntimeError('Host controls missing')

def card(action):
    top(); select_after(heading,(action,))

def opened():
    card('Open'); find('Pocket Focus')

def events():
    top(); return [e for e in diagnostics() if e.get('moduleId') == 'dev.construct.focus']

def native_counts():
    es=events(); return tuple(sum(e.get('code')==c for e in es) for c in ('TONE_STARTED','TONE_STOPPED'))

def access(label,on,required=False):
    if 'Construct menu' in labels() or 'Close module' in labels(): tap('Module access')
    else: card('Module access')
    find(label)
    previous=None
    for _ in range(20):
        choices=[n for n in nodes() if n.get('content-desc')==label and n.get('checkable')=='true']
        if len(choices)==1:
            n=choices[0]
            if n.get('bounds')==previous: break
            previous=n.get('bounds')
        time.sleep(.25)
    else: raise RuntimeError('Unstable access toggle')
    if (n.get('checked')=='true') != on:
        tap_node(n)
        if required and not on: tap('Turn off')
        find(label+': '+('on.' if on else 'off.'))
    tap('Reopen module'); find('Pocket Focus')

try:
    restart()
    for n in nodes():
        if n.get('class')=='android.widget.EditText':
            tap_node(n); adb('shell','input','keycombination','113','29')
            adb('shell','input','text',CONFIG.test_catalog); break
    else: raise RuntimeError('No catalog field')
    adb('shell','input','keyevent','111'); tap('Refresh catalog')
    select_after(heading,('Review & install',))
    find('Optional'); tap('Allow & install'); installed_status()
    es=events()
    installs=[e for e in es if e.get('code')=='INSTALLED_TRIAL']
    if len(installs)!=1 or installs[0].get('packageDigest') != expected: raise RuntimeError('Wrong focus package')
    opened(); wait_clock('25:00'); tap('10-second check'); find('Duration saved.')
    tap('Start timer'); find('Finished quietly — tone access is off.',timeout=25); find('Session finished')
    capture('focus-quiet'); tap('Close module')
    if native_counts() != (0,0): raise RuntimeError('Default denial produced native sound')
    done('Exact HTTPS candidate completes silently without optional tone access')
    opened(); tap('Reset timer'); find('Timer reset.'); tap('5-minute break'); wait_clock('05:00')
    tap('Start timer'); time.sleep(1); tap('Pause timer'); find('Timer paused')
    saved_clock=clock_value(nodes()); tap('Close module'); restart(); opened(); find('Timer paused'); wait_clock(saved_clock)
    tap('Resume timer'); find('Focus in progress'); tap('Pause timer'); find('Timer paused')
    capture('focus-paused'); tap('Close module')
    done('Pause survives process restart; resume works from saved remainder')
    access('Allow short tones',True); tap('Reset timer'); find('Timer reset.')
    tap('10-second check'); find('Duration saved.'); tap('Start timer')
    find('Session finished. Completion tone requested.',timeout=25); time.sleep(.5)
    capture('focus-tone'); tap('Close module')
    if native_counts() != (1,1): raise RuntimeError('Expected exactly one bounded completion tone')
    opened(); find('Session finished'); tap('Close module')
    if native_counts() != (1,1): raise RuntimeError('Reopening replayed completion')
    done('Granted foreground completion submits one native start/stop, never replayed')
    opened();tap('Reset timer');find('Timer reset.');tap('Start timer');find('Focus in progress')
    tap('Construct menu');find('Return to module');time.sleep(12)
    tap('Return to module');find('Session finished')
    result['menuCompletionLabels']=labels()
    if 'Session finished. Completion tone requested.' in result['menuCompletionLabels']:raise RuntimeError('Menu completion unexpectedly requested sound')
    capture('focus-menu-quiet');tap('Close module')
    if native_counts()!=(1,1):raise RuntimeError('Timer produced sound while menu was open or on return')
    done('Legacy timer finishes quietly under native menu; no additional native start/stop or late replay')
    opened(); tap('Reset timer'); find('Timer reset.'); tap('Start timer'); find('Focus in progress')
    adb('shell','input','keyevent','3'); time.sleep(12)
    adb('shell','svc','wifi','disable'); adb('shell','svc','data','disable')
    try:
        restart(); opened(); find('Finished while away. No late sound played.')
        capture('focus-offline-expired'); tap('Close module')
        if native_counts() != (1,1): raise RuntimeError('Late/background completion produced sound')
    finally:
        adb('shell','svc','wifi','enable'); adb('shell','svc','data','enable')
    done('Expired deadline catches up offline after background without a late alarm')
    opened(); tap('Reset timer'); find('Timer reset.'); tap('25-minute focus'); wait_clock('25:00')
    tap('Start timer'); find('Focus in progress')
    access('Allow saving data on this phone',False,required=True)
    find('Saved timer unavailable'); capture('focus-storage-denied')
    if not any('CAPABILITY_DENIED' in s for s in labels()): raise RuntimeError('Missing storage denial wording')
    access('Allow saving data on this phone',True)
    find('Continuing saved countdown. Keep open for sound.'); find('Focus in progress')
    tap('Pause timer'); find('Timer paused'); tap('Close module')
    done('Storage revocation is recoverable; regrant preserves the saved running session')
    es=events(); result['events']=es
    report = diagnostics()
    metadata = [e for e in report if e.get('code') == 'ENVIRONMENT']
    if len(metadata) != 1: raise RuntimeError('Missing environment metadata')
    result['environment'] = metadata[0]
    if any(e.get('code') in ('JAVASCRIPT_ERROR','RENDERER_STOPPED') for e in es): raise RuntimeError('Unexpected Focus runtime stop')
    if native_counts() != (1,1): raise RuntimeError('Unexpected extra tone')
    result['complete']=True
except Exception as error:
    result['error']=str(error)
    try: capture('focus-failure')
    except Exception: pass
    raise
finally:
    (RESULTS/'focus-result.json').write_text(json.dumps(result,indent=2)+'\n')
