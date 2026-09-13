"""Host controls shared by staging UI tests."""
import json
import re
import time
from ui import adb, nodes, labels, tap, tap_node, find, enabled

def restart():
    adb('shell', 'am', 'force-stop', 'dev.construct.runtime')
    adb('shell', 'am', 'start', '-n', 'dev.construct.runtime/.MainActivity')
    find('Installed')

def diagnostics():
    for attempt in range(21):
        current = labels()
        if 'Diagnostics' in current or 'Construct menu' in current: break
        if attempt == 20: raise RuntimeError('Cannot expose native Diagnostics')
        adb('shell', 'input', 'swipe', '360', '450', '360', '1050', '300')
        time.sleep(.25)
    tap('Diagnostics')
    find('Copy diagnostics')
    events = []
    for text in labels():
        for line in text.splitlines():
            if line.strip().startswith('{"time"'):
                events.append(json.loads(line))
    if 'Back to menu' in labels():
        tap('Back to menu'); tap('Close module')
    else: tap('Back')
    if not events:
        raise RuntimeError('Diagnostics export missing; cannot classify results')
    return events

def select_after(heading, choices):
    def candidate():
        current = nodes()
        parents = {child: parent for parent in current for child in parent}
        seen = False
        for node in current:
            text = node.attrib.get('text', '')
            if text == heading: seen = True
            elif seen and re.search(r' · \d+\.\d+\.\d+$', text):
                # Never satisfy an action using a different module/version card.
                return None
            elif seen and text in choices and enabled(node, parents): return node
        return None

    for _ in range(20):
        previous = candidate()
        if previous is not None:
            for _ in range(8):
                time.sleep(.35)
                current = candidate()
                if current is None: break
                if current.attrib.get('bounds') == previous.attrib.get('bounds'):
                    tap_node(current)
                    return
                previous = current
        adb('shell', 'input', 'swipe', '360', '1000', '360', '750', '500')
        time.sleep(.35)
    raise RuntimeError('No stable enabled action found within exact card: ' + heading)


def installed_status():
    # Do not scroll a still-open consent dialog or infer installation from a tap.
    for _ in range(80):
        if 'Allow & install' not in labels(): break
        time.sleep(.25)
    else: raise RuntimeError('Install consent did not close')
    for _ in range(12):
        if 'Use configured registry' in labels(): break
        adb('shell', 'input', 'swipe', '360', '450', '360', '1050', '300')
        time.sleep(.25)
    else: raise RuntimeError('Cannot expose host installation status')
    find('Installed. Open and test it, then mark it working.')
