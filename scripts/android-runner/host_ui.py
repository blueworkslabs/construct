"""Host controls shared by staging UI tests."""
import json
import re
import time
from host_cards import card_action, card_heading

_modern = False
from ui import adb, nodes, labels, tap, tap_node, find, enabled

def restart():
    adb('shell', 'am', 'force-stop', 'dev.construct.runtime')
    adb('shell', 'am', 'start', '-n', 'dev.construct.runtime/.MainActivity')
    host_ready()

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
    if _modern: return select_modern(heading, choices)
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

    for attempt in range(21):
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
        if attempt == 20: break
        # Stay within the content viewport while covering long versioned catalogs.
        adb('shell', 'input', 'swipe', '360', '1000', '360', '625', '500')
        time.sleep(.35)
    raise RuntimeError('No stable enabled action found within exact card: ' + heading)


def installed_status():
    if _modern:
        for _ in range(80):
            if 'Allow & install' not in labels(): break
            time.sleep(.25)
        else: raise RuntimeError('Install consent did not close')
        scroll_top()
        find('Installed. Open and test it, then mark it working.')
        library()
        return
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


def modern():
    return _modern


def host_ready():
    global _modern
    for _ in range(60):
        current = labels()
        if 'Library' in current and 'Browse' in current:
            _modern = True
            return find('Library')
        if 'Installed' in current and 'Construct' in current:
            _modern = False
            return find('Installed')
        time.sleep(.5)
    raise RuntimeError('Host Library/legacy inventory did not become ready')


def scroll_top():
    # Scroll the content, not the status bar or bottom navigation.
    for _ in range(6):
        adb('shell','input','swipe','360','460','360','990','250')
    time.sleep(.25)


def library():
    if _modern:
        current = labels()
        if 'Close versions' in current: tap('Close versions')
        if 'Library' in labels(): tap('Library')
        elif 'Back to Library' in labels(): tap('Back to Library')
        elif 'Back' in labels(): tap('Back')
        else: raise RuntimeError('Not on a host page; refusing implicit module closure')
        find('Library'); find('Browse')
    scroll_top()


def catalog_settings():
    if _modern:
        library(); tap('Construct menu'); tap('Settings'); find('Use catalog')


def apply_catalog():
    tap('Use catalog' if _modern and 'Use catalog' in labels() else 'Refresh catalog')


def configured_catalog():
    catalog_settings(); tap('Use configured registry'); apply_catalog()


def _stable_card(heading, choices, any_version=False):
    for attempt in range(21):
        previous = card_action(nodes(), heading, choices, enabled, any_version)
        if previous is not None:
            for _ in range(8):
                time.sleep(.35)
                current = card_action(nodes(), heading, choices, enabled, any_version)
                if current is None: break
                if current.get('bounds') == previous.get('bounds'):
                    tap_node(current); return
                previous = current
        if attempt == 20: break
        adb('shell','input','swipe','360','990','360','460','350')
        time.sleep(.35)
    raise RuntimeError('No stable enabled action inside exact Library card: ' + heading)


def select_modern(heading, choices):
    name, _ = card_heading(heading)
    reviewing = any(value in ('Review & install', 'Review version') for value in choices)
    library()
    if reviewing:
        tap('Browse'); scroll_top()
        if 'Choose a catalog in Settings, then refresh to browse tools.' in labels():
            tap('Refresh catalog'); find('Catalog refreshed.')
        # Always select an explicit version, including when it is the default.
        _stable_card(heading, ('Versions',), any_version=True)
        find('Versions · ' + name)
        _stable_card(heading, ('Install','Update','Review replacement','Review older version','Install for testing','Review test version'))
        return
    primary = tuple(value for value in choices if value in ('Open','Retry','Enable'))
    if primary:
        _stable_card(heading, primary); return
    _stable_card(heading, ('More actions for ' + name,))
    # The only open dropdown belongs to the exact verified card above.
    for value in choices:
        if value in labels(): tap(value); return
    raise RuntimeError('Exact card overflow lacks requested action: ' + repr(choices))
