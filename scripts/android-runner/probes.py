#!/usr/bin/env python3
"""Run one probe per launch and require fresh host/fixture evidence for scoped verdicts."""
from config import CONFIG, SERIAL, require_runner
import json
import socket
import time
from ui import adb, nodes, labels, tap, tap_node, find, capture, RESULTS
from verdicts import PROBES, VERSION, verdict, counts
require_runner()
RESULTS.mkdir(parents=True, exist_ok=True)

from host_ui import restart, diagnostics, select_after, installed_status

results = []
try:
    restart()
    for node in nodes():
        if node.attrib.get('class') == 'android.widget.EditText':
            tap_node(node)
            adb('shell', 'input', 'keycombination', '113', '29')
            adb('shell', 'input', 'text', CONFIG.test_catalog)
            break
    else: raise RuntimeError('Catalog field missing')
    adb('shell', 'input', 'keyevent', '111')
    tap('Refresh catalog')
    # Select an exact version, never whichever catalog card happens to come first.
    select_after('Isolation probes (test only) · ' + VERSION, ('Review & install', 'Review version'))
    tap('Allow & install')
    installed_status()
    restart()
    previous = {json.dumps(e, sort_keys=True) for e in diagnostics()}
    for index, name in enumerate(PROBES):
        select_after('Isolation probes (test only) · ' + VERSION, ('Open', 'Retry'))
        find('Isolation probes')
        for _ in range(3):
            if name in labels(): break
            adb('shell', 'input', 'swipe', '360', '1050', '360', '550', '400')
        tap(name)
        time.sleep(6 if name == 'Undeclared toast' else 2)
        observed = labels()
        capture('probe-' + str(index))
        activity = adb('shell', 'dumpsys', 'activity', 'activities')
        resumed = [line for line in activity.splitlines() if 'mResumedActivity:' in line or 'topResumedActivity=' in line]
        foreground = any(any(name in line for name in ('dev.construct.runtime/.MainActivity', 'dev.construct.runtime/.ModuleActivity')) for line in resumed)
        if 'Construct menu' in observed or 'Close module' in observed: tap('Close module')
        # Read diagnostics before restarting: restart must not mask a hang.
        events = diagnostics()
        fresh = [e for e in events if json.dumps(e, sort_keys=True) not in previous]
        previous = {json.dumps(e, sort_keys=True) for e in events}
        classification, reason = verdict(name, observed, fresh, foreground, True)
        results.append({'probe': name, 'verdict': classification, 'reason': reason,
                        'observed': observed, 'events': fresh, 'resumedActivity': resumed})
        (RESULTS/'probe-results.json').write_text(json.dumps(results, indent=2)+'\n')
        (RESULTS/'diagnostics.jsonl').write_text(''.join(json.dumps(e)+'\n' for e in events))
        print(classification + ': ' + name + ' — ' + reason, flush=True)
        restart()
    if any(r['verdict'] == 'FAIL' for r in results):
        raise RuntimeError('One or more bounded probe checks failed; inspect probe-results.json')
    print('VERDICT COUNTS:', counts(results), flush=True)
    (RESULTS/'probe-summary.json').write_text(json.dumps({'complete': True, 'counts': counts(results), 'version': VERSION})+'\n')
except Exception as error:
    print('VERDICT COUNTS:', counts(results), flush=True)
    (RESULTS/'probe-summary.json').write_text(json.dumps({'complete': False, 'counts': counts(results), 'error': str(error), 'version': VERSION})+'\n')
    try: capture('probe-failure')
    except Exception: pass
    raise
