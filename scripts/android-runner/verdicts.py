"""Evidence classes: BLOCKED, CONTAINED, FAIL. No blanket isolation verdict."""
from collections import Counter
PROBES = ['Undeclared toast', 'Fetch', 'WebSocket', 'Iframe / nested bridge',
          'Popup', 'External navigation', 'Data navigation', 'File navigation',
          'Content navigation', 'Bounded bridge flood (40)', 'Native resource denial']
VERSION = '0.1.4'

def counts(results):
    found = Counter(r['verdict'] for r in results)
    return {name: found[name] for name in ('BLOCKED', 'CONTAINED', 'FAIL')}

def verdict(name, observed, events, foreground, responsive):
    relevant = [e for e in events if e.get('moduleId') == 'dev.construct.probe'
                and e.get('moduleVersion') == VERSION]
    if not responsive or not foreground:
        return 'FAIL', 'Host lost foreground or did not respond'
    marker = 'PENDING: PROBE: ' + name
    start = next((i for i, e in enumerate(relevant)
                  if e.get('source') == 'module' and e.get('message') == marker), None)
    if start is None:
        return 'FAIL', 'Missing fresh, version-matched probe invocation'
    # Diagnostics are chronologically sorted by the host. Startup resource
    # blocks before the fixture invocation cannot prove this button's outcome.
    relevant = relevant[start + 1:]
    host = {e.get('code') for e in relevant if e.get('source') == 'host'}
    messages = [e.get('message', '') for e in relevant if e.get('source') == 'module']
    if any('FAIL:' in s or 'INCONCLUSIVE:' in s for s in observed + messages):
        return 'FAIL', 'Fixture reported failure or inconclusive result'
    if name == 'Undeclared toast':
        if 'BLOCKED: CAPABILITY_DENIED' in messages:
            return 'BLOCKED', 'Explicit capability denial received'
        return 'FAIL', 'No explicit capability denial; timeout is inconclusive'
    if name == 'Native resource denial':
        if any(e.get('source') == 'host' and e.get('code') == 'REQUEST_BLOCKED'
               and e.get('message', '').startswith('Blocked category=path;') for e in relevant):
            return 'BLOCKED', 'Native path rejection recorded after invocation'
        return 'FAIL', 'No native path rejection after invocation; inconclusive'
    required = {'Popup':'POPUP_BLOCKED', 'External navigation':'NAVIGATION_BLOCKED'}.get(name)
    if required:
        if required in host:
            return 'BLOCKED', 'Native '+required+' recorded; host responsive'
        return 'FAIL', 'No native '+required+' recorded; inconclusive'
    if name == 'Bounded bridge flood (40)':
        count = messages.count('Bounded probe flood')
        if 8 <= count <= 9 and 'JAVASCRIPT_ERROR' not in host:
            return 'BLOCKED', f'Flood output throttled: {count} records; host responsive'
        return 'FAIL', f'Expected 8–9 flood records without runtime failure; got {count}'
    if name in ('Fetch', 'WebSocket') and any(
            e.get('source') == 'host' and e.get('code') == 'REQUEST_BLOCKED'
            and e.get('message', '').startswith('Blocked category=external-origin;') for e in relevant):
        return 'BLOCKED', 'Native external-origin rejection recorded after invocation'
    if 'JAVASCRIPT_ERROR' in host:
        return 'CONTAINED', 'Host stopped module on JS error; no direct request-block/egress evidence'
    return 'FAIL', 'No host stop or block recorded; inconclusive'
