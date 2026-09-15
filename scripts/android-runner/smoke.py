#!/usr/bin/env python3
"""Exercise the delivered pilot using synthetic checklist data on staging."""
from config import CONFIG, SERIAL, require_runner
import json
import socket
import time
from ui import adb, nodes, labels, tap, tap_node, find, capture, RESULTS
from host_ui import select_after, installed_status, catalog_settings, apply_catalog, configured_catalog, library, host_ready, modern
from catalog_input import replace_text
import ui

require_runner()
steps=[]
def done(name):
    steps.append(name)
    print('PASS:',name,flush=True)
    (RESULTS/'smoke-result.json').write_text(json.dumps({'passed':steps,'complete':False},indent=2)+'\n')

def edit(text):
    replace_text(nodes, lambda value: ui._device(
        className='android.widget.EditText', packageName='dev.construct.runtime'
    ).set_text(value), text)

def saved_item():
    try:
        find('Emulator-item', timeout=4)
    except RuntimeError:
        # WebView occasionally omits dynamic list descendants after replacing a
        # view. A bounded scroll invalidates its accessibility viewport without
        # changing stored data; still require the exact item afterwards.
        adb('shell', 'input', 'swipe', '360', '1100', '360', '800', '300')
        adb('shell', 'input', 'swipe', '360', '800', '360', '1100', '300')
        find('Emulator-item', timeout=10)

try:
    RESULTS.mkdir(parents=True,exist_ok=True)
    adb('shell','am','start','-n','dev.construct.runtime/.MainActivity')
    host_ready()
    configured_catalog()
    find('Catalog refreshed.'); done('Remote HTTPS catalog loaded')
    select_after('Pocket Checklist · 0.1.0', ('Review & install',))
    tap('Allow & install'); installed_status()
    select_after('Pocket Checklist · 0.1.0', ('Open',))
    find('Pocket Checklist'); find('Ready. Works offline once installed.')
    edit('Emulator-item'); tap('Add item'); find('Emulator-item')
    # Dismiss the input keyboard before accessing host controls.
    adb('shell','input','keyevent','111')
    capture('checklist-v01')
    done('Remote checklist installed; WebView rendered and saved synthetic item')
    tap('Mark working')
    find('Marked working. You can now install an update.')
    select_after('Pocket Checklist · 0.2.0', ('Review version',))
    tap('Allow & install')
    installed_status()
    # Let the existing bounded viewport refresh recover omitted descendants,
    # then require both the retained item and the actual update-only control.
    select_after('Pocket Checklist · 0.2.0', ('Open',)); saved_item(); find('Clear completed')
    capture('checklist-v02'); done('Downloaded update retained item and exposed new control')
    tap('Close module'); select_after('Pocket Checklist · 0.2.0', ('Roll back',)); tap('Restore'); select_after('Pocket Checklist · 0.1.0', ('Open',))
    saved_item()
    if 'Clear completed' in labels(): raise RuntimeError('Rollback retained the update-only control')
    capture('checklist-rollback'); done('Rollback restored original controls and retained item')
    adb('shell','cmd','connectivity','airplane-mode','enable')
    adb('shell','svc','wifi','disable'); adb('shell','svc','data','disable')
    adb('shell','am','force-stop','dev.construct.runtime')
    adb('shell','am','start','-n','dev.construct.runtime/.MainActivity')
    host_ready()
    select_after('Pocket Checklist · 0.1.0', ('Open',)); saved_item()
    capture('checklist-offline'); done('Checklist reopened offline after process restart')
    tap('Close module')
    (RESULTS/'smoke-result.json').write_text(json.dumps({'passed':steps,'complete':True},indent=2)+'\n')
except Exception as error:
    try: capture('smoke-failure')
    except Exception: pass
    (RESULTS/'smoke-result.json').write_text(json.dumps({'passed':steps,'complete':False,'error':str(error)},indent=2)+'\n')
    raise
finally:
    adb('shell','cmd','connectivity','airplane-mode','disable')
    adb('shell','svc','wifi','enable'); adb('shell','svc','data','enable')
