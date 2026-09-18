#!/usr/bin/env python3
"""Disposable exact-artifact acceptance for the module-owned Measure workflow."""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

from config import CONFIG, SERIAL, require_runner

p = argparse.ArgumentParser()
p.add_argument('--apk', type=Path, required=True)
p.add_argument('--sha', required=True)
p.add_argument('--catalog', required=True)
p.add_argument('--module-sha', required=True)
p.add_argument('--after-sha', required=True)
p.add_argument('--loupe-update', action='store_true', help='Compare published Measure 0.2.2 with loupe-enabled 0.2.3 and roll back, retaining held-drag captures')
p.add_argument('--module-name', default='Pocket Measure')
p.add_argument('--module-version', default='0.2.0')
a = p.parse_args()
from config import catalog
catalog(a.catalog)
require_runner()
for path, digest in [(a.apk, a.sha)]:
    if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise RuntimeError('APK checksum mismatch')
lock = (CONFIG.root / 'suite.lock').open('a')
fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
if subprocess.run(['systemctl', '--user', 'is-active', '--quiet', CONFIG.service]).returncode == 0:
    raise RuntimeError('Preserve already-running emulator')
devices = subprocess.check_output([str(CONFIG.sdk / 'platform-tools/adb'), 'devices'], text=True)
if any(line.startswith(SERIAL + '\t') for line in devices.splitlines()):
    raise RuntimeError('Emulator port occupied')
if (CONFIG.root / 'camera-emulated.flag').exists():
    raise RuntimeError('Expected normal app-free snapshot profile')
run = CONFIG.root / 'results' / (datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-measure-module-' + uuid.uuid4().hex[:8])
run.mkdir(parents=True)
os.environ['CONSTRUCT_RESULTS'] = str(run)
import ui
from ui import adb, nodes, labels, tap, tap_node, find, capture
from host_ui import host_ready, catalog_settings, apply_catalog, library, select_after, installed_status, scroll_top, _stable_card, diagnostics

receipt = {'scope':'Signed Measure module-only behavior update and rollback on identical host APK','moduleSha256':a.module_sha,'apkSha256':a.sha,'checks':[],'complete':False,'stopped':False}
started = False

def save():
    (run / 'result.json').write_text(json.dumps(receipt, indent=2) + '\n')

def done(name):
    receipt['checks'].append(name)
    save()
    print('PASS:', name, flush=True)

def launch():
    adb('shell', 'am', 'start', '-n', 'dev.construct.runtime/.MainActivity')
    host_ready()

def verify_installed(expected):
    entries = adb('shell', 'pm', 'path', 'dev.construct.runtime').splitlines()
    if len(entries) != 1 or not entries[0].startswith('package:/data/app/'):
        raise RuntimeError('Unexpected installed APK path')
    actual = adb('shell', 'sha256sum', entries[0].removeprefix('package:').strip()).split()[0]
    if actual != expected:
        raise RuntimeError('Installed APK differs from candidate')

def field_is(expected):
    values = [n.get('text') for n in nodes() if n.get('class') == 'android.widget.EditText' and n.get('package') == 'dev.construct.runtime']
    if values != [expected]:
        raise RuntimeError('Catalog field differs from expected value: ' + repr(values))

def consent_switch(label):
    find('Allow & install')
    deadline=time.monotonic()+20
    while time.monotonic()<deadline:
        matches=[n for n in nodes() if n.get('content-desc')==label and n.get('checkable')=='true']
        if len(matches)==1:
            before=matches[0].get('bounds')
            time.sleep(.4)
            matches=[n for n in nodes() if n.get('content-desc')==label and n.get('checkable')=='true']
            if len(matches)==1 and matches[0].get('bounds')==before:return matches[0]
        time.sleep(.3)
    raise RuntimeError('Trusted consent switch did not appear: '+label)

def settled_host_surface():
    # A version review closes a ModalBottomSheet asynchronously. Never swipe
    # its disappearing accessibility window or retry the preceding action.
    from host_cards import host_viewport
    deadline=time.monotonic()+20; previous=None
    while time.monotonic()<deadline:
        current=nodes()
        texts={n.get('text') for n in current}
        try: viewport=host_viewport(current)
        except RuntimeError: viewport=None
        if viewport and 'Close versions' not in texts and 'Browse' in texts and viewport==previous:
            return
        previous=viewport; time.sleep(.4)
    raise RuntimeError('Host did not settle after version review')


from catalog_input import replace_text
fixtures=CONFIG.root/'measure-fixtures'
entries=json.loads((fixtures/'manifest.json').read_text())
current=None
current_entry=None
stage_index=0
WORKSPACE='Measurement photo. Tap endpoints or use fine adjustment.'
PICKER_PACKAGES={'com.android.providers.media','com.android.providers.media.module','com.google.android.providers.media.module','com.android.photopicker','com.google.android.photopicker'}
heading=a.module_name+' · '+a.module_version
def capture_display(name):
    capture(name)
    target=run/(name+'-display');target.mkdir()
    outcome=adb('emu','screenrecord','screenshot',str(target))
    images=list(target.glob('*.png'))
    if len(images)!=1 or not images[0].read_bytes().startswith(b'\x89PNG\r\n\x1a\n'):raise RuntimeError('Emulator display capture unavailable: '+outcome)
def expect(text, timeout=40):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        match=next((x for x in labels() if text in x),None)
        if match is not None:return match
        time.sleep(.3)
    raise RuntimeError('Missing '+text+'; '+str(labels()))
def stage(name):
    global current,current_entry,stage_index
    entry=next(e for e in entries if e['name']==name)
    path=fixtures/name
    if hashlib.sha256(path.read_bytes()).hexdigest()!=entry['sha256']:raise RuntimeError('Fixture checksum mismatch')
    if current is not None:
        if hashlib.sha256(adb('exec-out','cat',current,binary=True)).hexdigest()!=current_entry['sha256']:raise RuntimeError('Selected source was modified')
        # Delete only our previous generated fixture, by exact path, before inserting a
        # new file/MediaStore row. Reusing a URI can retain picker orientation/transcode caches.
        where="\"_data='"+current+"'\""
        deleted=adb('shell','content','delete','--uri','content://media/external/images/media','--where',where)
        remaining=adb('shell','content','query','--uri','content://media/external/images/media','--projection','_id','--where',where)
        if 'No result found' not in remaining:raise RuntimeError('Previous synthetic media row remains: '+remaining)
        adb('shell','test','!','-e',current)
    stage_index+=1
    current='/storage/emulated/0/Pictures/construct-measure-synthetic-'+str(stage_index)+path.suffix
    current_entry=entry
    adb('shell','mkdir','-p','/sdcard/Pictures')
    adb('push',str(path),current)
    adb('shell','am','broadcast','-a','android.intent.action.MEDIA_SCANNER_SCAN_FILE','-d','file://'+current)
    time.sleep(2)
    return entry

def pick():
    action('Choose photo')
    until=time.monotonic()+30
    previous_bounds=None
    while time.monotonic()<until:
        ns=nodes()
        # Stock Android photo picker: the clean snapshot receives exactly one generated media item.
        candidates=[n for n in ns if n.get('resource-id','').endswith('/icon_thumbnail') or n.get('resource-id','').endswith('/photopicker_item_thumbnail')]
        if not candidates:
            candidates=[n for n in ns if n.get('content-desc','').startswith('Photo taken')]
        if len(candidates)==1:
            bounds=candidates[0].get('bounds')
            if bounds!=previous_bounds:
                previous_bounds=bounds;time.sleep(.4);continue
            tap_node(candidates[0])
            # Older pickers return immediately; Android 17 confirms one selection.
            selected_until=time.monotonic()+30
            while time.monotonic()<selected_until:
                selected=nodes()
                picker_nodes=[n for n in selected if n.get('package') in PICKER_PACKAGES]
                if not picker_nodes and any(n.get('package')=='dev.construct.runtime' for n in selected):return
                confirmations=[n for n in picker_nodes if n.get('text')=='Done' and n.get('enabled')!='false']
                if len(confirmations)==1:
                    chosen=[n for n in picker_nodes if n.get('content-desc','').startswith('Selected Photo taken')]
                    if len(chosen)!=1:raise RuntimeError('Picker confirmation lacks one selected synthetic photo')
                    tap('Done');return
                time.sleep(.3)
            raise RuntimeError('Native picker did not return or offer single-photo confirmation')
        if len(candidates)>1:raise RuntimeError('Ambiguous picker content; refusing to guess which image')
        time.sleep(.4)
    capture('measure-picker-missing');raise RuntimeError('Synthetic photo missing in picker: '+str(labels()))


def rect(n):return list(map(int,__import__('re').findall(r'-?\d+',n.get('bounds',''))))
def panel_rect(ns):
    web=next(n for n in ns if n.get('class')=='android.webkit.WebView')
    photo=next(n for n in ns if WORKSPACE in (n.get('text'),n.get('content-desc')))
    x1,y1,x2,y2=rect(web)
    return x1,rect(photo)[3],x2,y2
def in_panel(n,box):
    r=rect(n)
    return len(r)==4 and box[0]<=r[0]<r[2]<=box[2] and box[1]<=r[1]<r[3]<=box[3] and (n.get('class') not in ('android.widget.Button','android.widget.EditText') or r[3]-r[1]>=52)
def scroll_panel(box,direction):
    x1,y1,x2,y2=box;top=y1+(y2-y1)//5;bottom=y2-(y2-y1)//5
    adb('shell','input','swipe',str((x1+x2)//2),str(bottom if direction==1 else top),str((x1+x2)//2),str(top if direction==1 else bottom),'350')
    time.sleep(.3)
def matches_control(n,text):
    if text=='Measured black-square side (mm)':return n.get('resource-id')=='side' and n.get('class')=='android.widget.EditText'
    return text in (n.get('text'),n.get('content-desc'))
def control(text):
    ns=nodes();box=panel_rect(ns)
    show=[n for n in ns if n.get('text')=='Show controls' and in_panel(n,box)]
    if len(show)==1:tap_node(show[0]);time.sleep(.5)
    for direction in (1,-1):
        for _ in range(12):
            ns=nodes();box=panel_rect(ns)
            matches=[n for n in ns if matches_control(n,text) and n.get('enabled')!='false' and in_panel(n,box)]
            if len(matches)==1:
                prior=matches[0].get('bounds');time.sleep(.5)
                ns=nodes();box=panel_rect(ns)
                settled=[n for n in ns if matches_control(n,text) and n.get('enabled')!='false' and n.get('bounds')==prior and in_panel(n,box)]
                if len(settled)==1:return settled[0]
                continue
            raw=[n for n in ns if matches_control(n,text) and len(rect(n))==4]
            effective=direction
            if len(raw)==1:
                rr=rect(raw[0])
                if rr[1]<=box[1]+2:effective=-1
                elif rr[3]>=box[3]-2:effective=1
            scroll_panel(box,effective)
    raise RuntimeError('Visible control missing: '+text)
def action(text):
    node=control(text)
    with (run/'action-trace.jsonl').open('a') as trace:trace.write(json.dumps({'control':text,'node':dict(node.attrib),'panel':panel_rect(nodes())})+'\n')
    tap_node(node);time.sleep(.4)
def collapse():
    # WebView exposes overflow-clipped controls in its accessibility tree.
    # A positive node bound is not proof that its centre is actually touchable.
    for _ in range(16):
        ns=nodes();box=panel_rect(ns)
        visible=[n for n in ns if in_panel(n,box)]
        if any(n.get('text')=='Show controls' for n in visible):return
        hide=[n for n in visible if n.get('text')=='Hide controls']
        if len(hide)==1:
            prior=hide[0].get('bounds');time.sleep(.5)
            ns=nodes();box=panel_rect(ns)
            stable=[n for n in ns if n.get('text')=='Hide controls' and n.get('bounds')==prior and in_panel(n,box)]
            if len(stable)==1:
                tap_node(stable[0]);find('Show controls');time.sleep(.5);return
            continue
        scroll_panel(box,-1)
    raise RuntimeError('Could not collapse actual visible control panel')
def size(value):
    if 'Show controls' in labels():tap('Show controls');time.sleep(.4)
    if any(x.startswith('Length:') or (x.startswith('Marker ') and x.endswith('mm ✓')) for x in labels()):action('Change reference size')
    control('Measured black-square side (mm)')
    ui._device(className='android.widget.EditText',packageName='dev.construct.runtime').set_text(value)
    # Dismiss only the IME, before querying coordinates of the submit control.
    adb('shell','input','keyevent','111');time.sleep(.6)
    action('Use this size');expect('Tap the two ends');collapse()
def screen_point(entry,point):
    x1,y1,x2,y2=rect(find(WORKSPACE))
    scale=min((x2-x1)/entry['width'],(y2-y1)/entry['height'])
    return round(x1+((x2-x1)-entry['width']*scale)/2+point[0]*scale),round(y1+((y2-y1)-entry['height']*scale)/2+point[1]*scale)
def length():
    value=expect('Length: ').split()
    return float(value[1])*(10 if value[2]=='cm' else 1)
def units(label):
    action('Centimetres' if label=='Millimetres' else 'Millimetres');tap(label);time.sleep(.4);collapse()
def opened():
    launch();library();select_after(heading,('Open',));find('Choose photo')
def no_measurement():
    if any(x.startswith('Length:') for x in labels()):raise RuntimeError('Transient measurement survived a boundary')
def measured(name='measure-flat.png'):
    entry=stage(name);pick();expect('Reference found.');size('100');value=endpoints(entry)
    if abs(value-240)>4:raise RuntimeError('Fixture measurement outside tolerance: '+str(value))
    return entry
def endpoints(entry):
    collapse();bounds=find(WORKSPACE).get('bounds')
    for point in entry['endpoints']:
        x,y=screen_point(entry,point);adb('shell','input','tap',str(x),str(y));time.sleep(.6)
        if find(WORKSPACE).get('bounds')!=bounds:raise RuntimeError('Photo area moved during placement')
    return length()
def capture_held_drag(entry,name):
    collapse();before=length();x,y=screen_point(entry,entry['endpoints'][1])
    try:
        adb('shell','input','touchscreen','motionevent','DOWN',str(x),str(y))
        adb('shell','input','touchscreen','motionevent','MOVE',str(x-60),str(y))
        time.sleep(.5)
        if not 180<length()<before:raise RuntimeError('Held drag did not preview length')
        capture_display(name)
    finally:
        adb('shell','input','touchscreen','motionevent','CANCEL',str(x-60),str(y))
    time.sleep(.5)
    if length()!=before:raise RuntimeError('Held drag did not cancel transactionally')

try:
    print('RESULTS:', run, flush=True)
    avd, snapshot, _ = CONFIG.profile(False)
    subprocess.run([str(CONFIG.root / 'runner.sh'), 'start'], check=True)
    started = True
    deadline = time.monotonic() + 180
    while True:
        try:
            if adb('shell', 'getprop', 'sys.boot_completed', timeout=10).strip() == '1':
                break
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
            pass
        if time.monotonic() > deadline:
            raise RuntimeError('Boot timeout')
        time.sleep(2)
    invocation = subprocess.check_output(['systemctl', '--user', 'show', CONFIG.service, '-p', 'InvocationID', '--value'], text=True).strip()
    startup = subprocess.check_output(['journalctl', '--user', '_SYSTEMD_INVOCATION_ID=' + invocation, '--no-pager'], text=True)
    (run / 'startup.log').write_text(startup)
    if "Successfully loaded snapshot '" + snapshot + "'" not in startup:
        raise RuntimeError('No fresh snapshot restore evidence')
    if 'package:dev.construct.runtime' in adb('shell', 'pm', 'list', 'packages', 'dev.construct.runtime'):
        raise RuntimeError('Snapshot not app-free')
    receipt['snapshot'] = {'avd': avd, 'name': snapshot, 'loaded': True, 'invocation': invocation}
    receipt['apiLevel'] = adb('shell', 'getprop', 'ro.build.version.sdk').strip()
    receipt['shellIdentity'] = adb('shell', 'id').strip()
    if 'uid=2000(shell)' not in receipt['shellIdentity']:
        raise RuntimeError('ADB is not non-root shell')
    receipt['webview'] = adb('shell', 'dumpsys', 'webviewupdate')
    if receipt['apiLevel']!='37':raise RuntimeError('Expected Android17 upgrade fixture')
    from webview_provider import installed_provider_sha
    if installed_provider_sha(adb)!='e4ded2f4d0f22dce452fd0d9f485a9b78926a9e2c3d4ffe64f4a385346d20497':raise RuntimeError('Unexpected WebView bytes')
    if 'Current WebView package (name, version): (com.android.webview,' not in receipt['webview']:raise RuntimeError('Unexpected active WebView')
    # Explicit disposable-image-only override used by the established runner.
    wellbeing = 'com.google.android.apps.wellbeing'
    if 'package:' + wellbeing in adb('shell', 'pm', 'list', 'packages', wellbeing):
        adb('shell', 'pm', 'disable-user', '--user', '0', wellbeing)
        receipt['digitalWellbeingOverride'] = 'disabled-user on disposable image only'
    adb('logcat', '-c')
    adb('install',str(a.apk.resolve()),timeout=120);verify_installed(a.sha);launch()
    catalog_settings()
    replace_text(nodes,lambda value:ui._device(className='android.widget.EditText',packageName='dev.construct.runtime').set_text(value),a.catalog)
    apply_catalog();find('Catalog refreshed.')
    before_sha=a.sha
    before_version,after_version=('0.2.2','0.2.3') if a.loupe_update else ('0.1.0','0.2.0')
    module_name='Pocket Measure' if a.loupe_update else 'Measure Preview'
    for version,digest in [(before_version,a.module_sha),(after_version,a.after_sha)]:
        heading=module_name+' · '+version
        select_after(heading,('Review & install',));find('Allow & install')
        if version==before_version:
            for label in ('Allow selected image pixels','Allow local marker detection'):
                switch=consent_switch(label)
                if switch.get('checked')!='false':raise RuntimeError('Fresh preview grant was not off')
                tap_node(switch)
        tap('Allow & install');installed_status()
        events=diagnostics()
        if not any(e.get('code')=='INSTALLED_TRIAL' and e.get('packageDigest')==digest for e in events):raise RuntimeError('Incorrect signed preview bytes')
        library();select_after(heading,('Open',));find('Choose photo')
        entry=measured();expect('Length: 24.0 cm')
        if a.loupe_update:
            capture_held_drag(entry,'loupe-update-'+('before' if version==before_version else 'after'))
            tap('Construct menu');tap('Mark working' if version==before_version else 'Close module')
        elif version==before_version:
            if 'Show controls' in labels():tap('Show controls')
            if 'Length units' in labels():raise RuntimeError('Old preview already has the new units workflow')
            capture_display('measure-preview-before');tap('Construct menu');tap('Mark working')
        else:
            units('Millimetres')
            if not expect('Length: ').endswith(' mm') or abs(length()-240)>3:raise RuntimeError('New units workflow does not show expected millimetres')
            capture_display('measure-preview-after');tap('Construct menu');tap('Close module')
        verify_installed(a.sha)
    done('Signed module update preserves measurement on identical APK; held-drag captures compare loupe behavior' if a.loupe_update else 'Signed module update adds a working cm/mm conversion selector on identical installed APK bytes')
    select_after(module_name+' · '+after_version,('Roll back',));tap('Restore')
    heading=module_name+' · '+before_version;select_after(heading,('Open',));find('Choose photo');no_measurement()
    entry=measured();expect('Length: 24.0 cm')
    if a.loupe_update:
        capture_held_drag(entry,'loupe-update-rollback')
    else:
        if 'Show controls' in labels():tap('Show controls')
        if 'Length units' in labels():raise RuntimeError('Rollback kept update-only units selector')
        capture_display('measure-preview-rollback')
    tap('Construct menu');tap('Close module')
    verify_installed(a.sha)
    receipt['moduleOnlyUpdate']={'beforeModuleSha256':a.module_sha,'afterModuleSha256':a.after_sha,'apkSha256Before':before_sha,'apkSha256After':a.sha,'transientPhotoAndCalibration':'intentionally cleared between runs'}
    done('Supported rollback restores the original signed module and working measurement on the same APK; held-drag captures require visual review' if a.loupe_update else 'Supported rollback removes update-only controls and original measurement behavior works on the same APK')
    receipt['complete']=True
except Exception as e:
    receipt['error'] = str(e)
    try:
        (run/'failure-nodes.json').write_text(json.dumps([dict(n.attrib) for n in nodes()],indent=2))
        capture_display('failure')
    except Exception: pass
    raise
finally:
    if started:
        adb('shell','settings','put','system','font_scale','1.0')
        adb('shell','settings','put','system','user_rotation','0')
        adb('shell','cmd','connectivity','airplane-mode','disable');adb('shell','svc','wifi','enable');adb('shell','svc','data','enable')
        try:
            (run / 'crash-buffer.txt').write_text(adb('logcat', '-b', 'crash', '-d'))
            (run / 'runtime.log').write_text(adb('logcat', '-d', '-t', '6000'))
        except Exception: pass
        subprocess.run([str(CONFIG.root / 'runner.sh'), 'stop'], check=True)
        receipt['stopped'] = subprocess.run(['systemctl', '--user', 'is-active', '--quiet', CONFIG.service]).returncode != 0
    save()
    print(json.dumps(receipt, indent=2), flush=True)
