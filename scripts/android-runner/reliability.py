#!/usr/bin/env python3
"""Repeated native/WebView transitions; no automatic app restart or viewport recovery."""
import json
import time
import ui
from config import require_runner
from ui import adb, labels, tap, find, capture, RESULTS
from host_ui import select_after

require_runner()
result = {'complete': False, 'checks': []}
phase = 'setup'

def check(name, count):
    global phase
    phase = name
    find('Add one', timeout=10)
    find('Ready. The counter is stored only for this module.', timeout=10)
    find(str(count), timeout=5)
    result['checks'].append(name)
    print('PASS:', name, flush=True)
    (RESULTS/'reliability-result.json').write_text(json.dumps(result, indent=2)+'\n')

try:
    adb('shell', 'am', 'start', '-n', 'dev.construct.runtime/.MainActivity')
    tap('Use demo catalog'); tap('Refresh catalog')
    select_after('Hello Module · 0.1.0', ('Review & install',))
    tap('Allow & install'); tap('Open')
    check('initial', 0)
    pid = adb('shell', 'pidof', 'dev.construct.runtime').strip()
    for cycle in range(1, 11):
        tap('Add one'); check(f'{cycle}: saved count', cycle)
        tap('Construct menu'); tap('Return to module')
        check(f'{cycle}: menu return', cycle)
        tap('Diagnostics'); find('Copy diagnostics'); tap('Back to menu'); tap('Return to module')
        check(f'{cycle}: diagnostics return', cycle)
        tap('Module access'); tap('Reopen module')
        check(f'{cycle}: access reopen', cycle)
        tap('Close module'); tap('Open')
        check(f'{cycle}: close reopen', cycle)
        if adb('shell', 'pidof', 'dev.construct.runtime').strip() != pid:
            raise RuntimeError('Construct process changed during repeated transitions')
    result['complete'] = True
except Exception as error:
    result.update(error=str(error), phase=phase)
    for name, command in [('accessibility', ('shell','dumpsys','accessibility')),
                          ('activity', ('shell','dumpsys','activity','activities')),
                          ('window', ('shell','dumpsys','window')),
                          ('logcat', ('logcat','-d','-t','2000'))]:
        try: (RESULTS/(name+'.txt')).write_text(adb(*command))
        except Exception: pass
    try:
        capture('reliability-failure')
        (RESULTS/'hierarchy.xml').write_text(ui._device.dump_hierarchy(compressed=False))
    except Exception: pass
    raise
finally:
    try:
        warnings = adb('logcat', '-d', '-s', 'cr_AwContents:W')
        result['attachedDestroyWarnings'] = sum('destroy() called while WebView is still attached' in line for line in warnings.splitlines())
    except Exception as error:
        result['teardownObservationError'] = str(error)
    (RESULTS/'reliability-result.json').write_text(json.dumps(result, indent=2)+'\n')
