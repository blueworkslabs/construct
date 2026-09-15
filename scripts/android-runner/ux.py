#!/usr/bin/env python3
"""Real Library/Browse and refreshed module presentation acceptance, not full module regression."""
import json
import os
import re
import time
from config import CONFIG, require_runner
import ui
from ui import adb, nodes, labels, find, tap, capture, RESULTS
from host_ui import restart, diagnostics, select_after, installed_status, catalog_settings, apply_catalog, library, scroll_content
from text_entry import replace_text

require_runner()
candidates = json.loads(os.environ['CONSTRUCT_UX_CANDIDATES'])
result = {'complete': False, 'checks': [], 'candidates': candidates}
original_font = adb('shell','settings','get','system','font_scale').strip()

def done(name):
    result['checks'].append(name)
    print('PASS:', name, flush=True)

def heading(entry): return entry['name'] + ' · ' + entry['version']

def select(entry, action): select_after(heading(entry), (action,))

def replace(value):
    replace_text(nodes, lambda text: ui._device(className='android.widget.EditText',packageName='dev.construct.runtime').set_text(text), value)

def close(): tap('Close module')

def bounds(label):
    node = find(label)
    rect = list(map(int,re.findall(r'\d+',node.get('bounds',''))))
    if len(rect)!=4 or rect[2]<=rect[0] or rect[3]<=rect[1]: raise RuntimeError('No visible bounds for '+label)
    return rect

def menu_clearance(action):
    a,b = bounds(action),bounds('Construct menu')
    if min(a[2],b[2])>max(a[0],b[0]) and min(a[3],b[3])>max(a[1],b[1]):
        raise RuntimeError('Module action overlaps native menu: '+action)

try:
    restart(); find('Your tools will appear here'); capture('ux-library-empty')
    initial = diagnostics()
    if any(e.get('code')=='CATALOG_READY' for e in initial): raise RuntimeError('Library implicitly loaded a catalog')
    done('Fresh Library reads local inventory without a catalog fetch')
    catalog_settings(); replace(CONFIG.test_catalog)
    adb('shell','input','keyevent','111'); apply_catalog(); find('Catalog refreshed.')
    # Inspect the actual full Browse hierarchy over a bounded scroll, never a mock.
    seen = {}
    for _ in range(16):
        for n in nodes():
            desc=n.get('content-desc','')
            match=re.fullmatch(r'(.+), version (\d+\.\d+\.\d+)',desc)
            if match: seen.setdefault(match[1],set()).add(match[2])
        scroll_content('down')
    for e in candidates:
        if seen.get(e['name']) != {e['version']}: raise RuntimeError('Browse does not show exactly the latest candidate: '+e['name']+' '+repr(seen))
    library(); tap('Browse'); capture('ux-browse-latest')
    done('Browse exposes one latest candidate per module, not the historical version stack')
    for e in candidates:
        select(e,'Review & install'); find('Allow & install'); tap('Allow & install'); installed_status()
        events=diagnostics()
        installs=[event for event in events if event.get('code')=='INSTALLED_TRIAL' and event.get('moduleId')==e['id']]
        if len(installs)!=1 or installs[0].get('packageDigest')!=e['sha256']: raise RuntimeError('Installed candidate identity mismatch: '+e['id'])
    done('All eight refreshed packages install through explicit Versions, signature verification and consent')
    library(); capture('ux-library-installed')
    by_id={e['id']:e for e in candidates}
    hello=by_id['dev.construct.hello']
    select(hello,'Open'); find('Add one'); menu_clearance('Add one'); tap('Add one'); find('1')
    tap('Mark working'); find('Marked working. You can now install an update.'); restart(); select(hello,'Open'); find('1'); close()
    done('Hello task control clears the native corner and its count survives restart')
    checklist=by_id['dev.construct.checklist']
    select(checklist,'Open'); find('New item'); replace('UX literal <tag> & quotes')
    tap('Add item'); find('UX literal <tag> & quotes'); adb('shell','input','keyevent','111')
    menu_clearance('Add item'); capture('ux-checklist-keyboard-entry'); tap('Mark working'); find('Marked working. You can now install an update.')
    adb('shell','svc','wifi','disable'); adb('shell','svc','data','disable')
    try:
        restart(); select(checklist,'Open'); find('UX literal <tag> & quotes'); close()
    finally:
        adb('shell','svc','wifi','enable'); adb('shell','svc','data','enable')
    done('Checklist accepts literal text with the keyboard and reopens its retained item offline')
    for module,action in [('tone','Play beep'),('camera','Open camera workspace'),('measure','Open measurement workspace')]:
        select(by_id['dev.construct.'+module],'Open'); find(action); menu_clearance(action); tap(action)
        deadline=time.monotonic()+20
        while not any('CAPABILITY_DENIED' in label for label in labels()):
            if time.monotonic()>deadline: raise RuntimeError('Missing explicit default-denial feedback: '+module)
            time.sleep(.3)
        capture('ux-'+module+'-denied'); close()
    done('Tones, Camera and Measure keep visible default-denial feedback without obscuring native administration')
    # Native Android font scale, not only browser CSS emulation. A 720px/320dpi
    # logical viewport is 360dp. Restore all overrides in finally.
    adb('shell','wm','size','720x1280'); adb('shell','wm','density','320')
    adb('shell','settings','put','system','font_scale','2.0'); restart()
    catalog_settings(); find('Use catalog'); capture('ux-settings-360dp-font2')
    adb('shell','input','keyevent','111'); library(); tap('Browse'); find('Refresh catalog'); capture('ux-browse-360dp-font2')
    select(checklist,'Open'); find('New item'); menu_clearance('Add item'); capture('ux-checklist-360dp-font2'); close()
    adb('shell','settings','put','system','font_scale','1.0')
    adb('shell','wm','user-rotation','lock','1'); time.sleep(2); restart()
    find('Library'); find('Browse'); capture('ux-library-landscape')
    select(checklist,'Open'); find('New item'); menu_clearance('Add item'); capture('ux-checklist-landscape'); close()
    done('Native 360dp/2x text and landscape retain host navigation and Checklist controls; screenshots retained for visual review')
    events=diagnostics()
    environment=[e for e in events if e.get('code')=='ENVIRONMENT']
    if len(environment)!=1: raise RuntimeError('Missing exact APK environment')
    result['environment']=environment[0]
    if any(e.get('code') in ('JAVASCRIPT_ERROR','RENDERER_STOPPED') for e in events): raise RuntimeError('Unexpected module runtime stop')
    result['complete']=True
except Exception as error:
    result['error']=str(error)
    try: capture('ux-failure')
    except Exception: pass
    raise
finally:
    adb('shell','wm','size','reset'); adb('shell','wm','density','reset'); adb('shell','wm','user-rotation','lock','0')
    if original_font=='null': adb('shell','settings','delete','system','font_scale')
    else: adb('shell','settings','put','system','font_scale',original_font)
    (RESULTS/'ux-result.json').write_text(json.dumps(result,indent=2)+'\n')
