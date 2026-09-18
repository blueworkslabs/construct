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
p.add_argument('--module-name', default='Pocket Measure')
p.add_argument('--module-version', default='0.2.2')
p.add_argument('--layout-only', action='store_true', help='Focused consent, measurement and normal/2x layout checks; not full acceptance')
p.add_argument('--precision-checks', action='store_true', help='Capture real held placement/drag loupe and verify transactional interruption (requires loupe module)')
p.add_argument('--lifecycle-only', action='store_true', help='Focused consent, image setup and lifecycle scope; excludes editor/layout checks')
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

receipt = {'scope':'Module-owned Measure exact-APK functional and lifecycle acceptance','moduleSha256':a.module_sha,'apkSha256':a.sha,'checks':[],'complete':False,'stopped':False}
receipt['focusedLifecycle']=a.lifecycle_only
receipt['focusedLayout']=a.layout_only
receipt['precisionChecks']=a.precision_checks
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

def access_switch(label):
    find('Reopen module')
    end=time.monotonic()+20;previous=None
    while time.monotonic()<end:
        matches=[n for n in nodes() if n.get('content-desc')==label and n.get('checkable')=='true']
        if len(matches)==1 and matches[0].get('bounds')==previous:return matches[0]
        previous=matches[0].get('bounds') if len(matches)==1 else None;time.sleep(.3)
    raise RuntimeError('Access switch did not settle: '+label)

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
    return images[0]
def photo_pixels(name):
    from PIL import Image
    path=capture_display(name)
    with Image.open(path) as frame:
        return hashlib.sha256(frame.crop(tuple(rect(find(WORKSPACE)))).tobytes()).hexdigest()
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
            # Rotation/text zoom can settle after the initial query. Expand
            # only a stable, fully visible toggle; never swipe hidden controls.
            show=[n for n in ns if n.get('text')=='Show controls' and in_panel(n,box)]
            if len(show)==1:
                prior=show[0].get('bounds');time.sleep(.4)
                now=nodes();visible_box=panel_rect(now)
                stable=[n for n in now if n.get('text')=='Show controls' and n.get('bounds')==prior and in_panel(n,visible_box)]
                if len(stable)==1:tap_node(stable[0]);time.sleep(.5)
                continue
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
        x,y=screen_point(entry,point)
        if a.precision_checks and not receipt.get('precisionPlacementCaptured'):
            index=entry['endpoints'].index(point)
            # Keep a real touchscreen stream held across the emulator-console
            # capture. A preview must not commit either endpoint before UP.
            try:
                adb('shell','input','touchscreen','motionevent','DOWN',str(x+24),str(y-20))
                adb('shell','input','touchscreen','motionevent','MOVE',str(x),str(y))
                time.sleep(.4);no_measurement()
                capture_display('precision-placement-'+('a' if index==0 else 'b'))
                adb('shell','input','touchscreen','motionevent','UP',str(x),str(y))
            except BaseException:
                adb('shell','input','touchscreen','motionevent','CANCEL',str(x),str(y));raise
        else:adb('shell','input','tap',str(x),str(y))
        time.sleep(.6)
        if find(WORKSPACE).get('bounds')!=bounds:raise RuntimeError('Photo area moved during placement')
    if a.precision_checks:receipt['precisionPlacementCaptured']=True
    return length()
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
    select_after(heading,('Review & install',));tap('Allow & install');installed_status()
    events=diagnostics()
    if not any(e.get('code')=='INSTALLED_TRIAL' and e.get('packageDigest')==a.module_sha for e in events):raise RuntimeError('Wrong signed module')
    library();select_after(heading,('Open',));find('Choose photo');action('Choose photo');expect('[CAPABILITY_DENIED]')
    done('Pixel access denied by default before Android picker opens')
    tap('Construct menu');tap('Module access');find('Reopen module')
    for label in ('Allow selected image pixels','Allow local marker detection'):
        deadline=time.monotonic()+20;previous=None;switch=None
        while time.monotonic()<deadline:
            matches=[n for n in nodes() if n.get('content-desc')==label and n.get('checkable')=='true']
            if len(matches)==1 and matches[0].get('bounds')==previous:
                switch=matches[0];break
            previous=matches[0].get('bounds') if len(matches)==1 else None;time.sleep(.3)
        if switch is None:raise RuntimeError('Native grant did not settle: '+label)
        if switch.get('checked')!='false':raise RuntimeError('Fresh grant was not off')
        tap_node(switch);find(label+': on.')
    tap('Reopen module');find('Choose photo');action('Choose photo');find('Photos');adb('shell','input','keyevent','4');expect('No photo selected')
    done('Fresh independent grants and native picker cancellation return to same module')
    entry=stage('measure-flat.png')
    adb('shell','cmd','connectivity','airplane-mode','enable');adb('shell','svc','wifi','disable');adb('shell','svc','data','disable')
    pick();expect('Reference found.');size('100');value=endpoints(entry)
    if abs(value-240)>3:raise RuntimeError('Flat reference failed: '+str(value))
    receipt['flatMm']=value;capture_display('module-measure-flat')
    done('Real system picker, private image resource and local detector feed module-owned 240 mm measurement offline')
    if not a.lifecycle_only and not a.layout_only:
        units('Millimetres')
        millimetres=expect('Length: ')
        if not millimetres.endswith(' mm') or abs(length()-receipt['flatMm'])>.51:raise RuntimeError('Units conversion exceeds cm display rounding')
        receipt['unitsMm']=length();units('Centimetres');expect('Length: 24.0 cm')
        done('Module-owned unit selector converts centimetres to millimetres within displayed rounding')
        # A real drag commits one undo step; pointer cancellation restores its start.
        bx,by=screen_point(entry,entry['endpoints'][1]);ax,ay=screen_point(entry,entry['endpoints'][0])
        ui._device.swipe(bx,by,bx-60,by,duration=.5);time.sleep(.5)
        if not 180<length()<240:raise RuntimeError('Endpoint drag did not adjust length')
        action('Undo');collapse()
        if length()!=receipt['flatMm']:raise RuntimeError('Drag Undo failed')
        # UiAutomator's JSON-RPC supports DOWN/MOVE/UP but not CANCEL. Use
        # Android's input tool for the complete stream, never mix injectors.
        for motion,x,y in [('DOWN',bx,by),('MOVE',bx-60,by),('CANCEL',bx-60,by)]:
            adb('shell','input','touchscreen','motionevent',motion,str(x),str(y));time.sleep(.2)
        time.sleep(.5)
        if length()!=receipt['flatMm']:raise RuntimeError('Pointer cancellation retained drag preview')
        done('Real endpoint drag commits once; Undo and Android pointer cancellation restore the prior length')
        if a.precision_checks:
            # Retain screenshots of the loupe during a genuine held adjustment,
            # then prove cancellation and a late UP cannot commit that preview.
            try:
                for motion,x,y in [('DOWN',bx,by),('MOVE',bx-60,by)]:
                    adb('shell','input','touchscreen','motionevent',motion,str(x),str(y))
                time.sleep(.5)
                if not 180<length()<240:raise RuntimeError('Held magnifier drag did not preview adjusted length')
                capture_display('precision-drag-held')
                adb('shell','input','touchscreen','motionevent','CANCEL',str(bx-60),str(by))
                time.sleep(.5)
                if length()!=receipt['flatMm']:raise RuntimeError('Held magnifier cancellation did not restore measurement')
                capture_display('precision-drag-cancelled')
                adb('shell','input','touchscreen','motionevent','UP',str(bx-60),str(by))
                if length()!=receipt['flatMm']:raise RuntimeError('Late release committed cancelled magnifier preview')
            except BaseException:
                adb('shell','input','touchscreen','motionevent','CANCEL',str(bx),str(by));raise
            done('Precision placement commits on release; held loupe drag cancels and ignores late release (captures require visual review)')
        action('Endpoint B')
        for _ in range(4):action('Move endpoint left')
        if not receipt['flatMm']-3<=length()<receipt['flatMm']:raise RuntimeError('Pixel nudge did not reduce length')
        for _ in range(4):action('Undo')
        collapse()
        if length()!=receipt['flatMm']:raise RuntimeError('Nudge undo failed')
        done('Accessible photo-pixel nudges are individually undoable')
        action('Clear');collapse();no_measurement()
        fit_pixels=photo_pixels('module-gesture-fit')
        x1,y1,x2,y2=rect(find(WORKSPACE));cx,cy=(x1+x2)//2,(y1+y2)//2
        # Start with separated fingers: the convenience pinch starts near-zero
        # separation, reaches the 8x cap, and loses all features in this white fixture.
        ui._device(description=WORKSPACE).gesture((cx-100,cy),(cx+100,cy),(cx-160,cy),(cx+160,cy),steps=25)
        time.sleep(.5);no_measurement()
        zoom_pixels=photo_pixels('module-gesture-zoom')
        if zoom_pixels==fit_pixels:raise RuntimeError('Pinch did not visibly zoom the photograph')
        x1,y1,x2,y2=rect(find(WORKSPACE));ui._device.swipe((x1+x2)//2,(y1+y2)//2,(x1+x2)//2-60,(y1+y2)//2-40,duration=.4)
        no_measurement()
        if photo_pixels('module-gesture-pan')==zoom_pixels:raise RuntimeError('Zoomed pan did not move the photograph')
        tap('Reset photo view');time.sleep(.5)
        if photo_pixels('module-gesture-reset')!=fit_pixels:raise RuntimeError('Fit reset did not restore the original rendered photograph')
        if abs(endpoints(entry)-240)>3:raise RuntimeError('Fit reset changed photo coordinates')
        done('Real pinch and pan do not place endpoints; reset restores calibrated fit coordinates')
    if not a.lifecycle_only:
        size('95');value=endpoints(entry)
        if abs(value-228)>3:raise RuntimeError('Actual marker-size scaling failed: '+str(value))
        done('Module-owned recalibration produces 228 mm from the same endpoints')
        tap('Construct menu');tap('Return to module');expect('Length: 22.8 cm')
        adb('shell','settings','put','system','accelerometer_rotation','0');adb('shell','settings','put','system','user_rotation','1');time.sleep(2)
        expect('Length: 22.8 cm');capture_display('module-measure-landscape')
        adb('shell','settings','put','system','user_rotation','0');time.sleep(2);expect('Length: 22.8 cm')
        done('Menu and rotation preserve the current module measurement')
        for rotation in ('0','1'):
            adb('shell','settings','put','system','font_scale','2.0')
            adb('shell','settings','put','system','user_rotation',rotation);time.sleep(2)
            # Integer touchscreen coordinates round differently after text zoom
            # changes the fitted photo size. Keep the existing calibration tolerance.
            if abs(length()-228)>3:raise RuntimeError('Large-text calibrated length outside tolerance')
            action('Choose photo')
            find('Photos');adb('shell','input','keyevent','4');expect('No photo selected')
            # Cancellation intentionally clears the previous selection; load again to
            # inspect both the large-text controls and a completed measurement.
            entry=measured();capture_display('module-measure-large-'+rotation)
            size('95');endpoints(entry)
        adb('shell','settings','put','system','font_scale','1.0');adb('shell','settings','put','system','user_rotation','0');time.sleep(2)
        done('Two-times text remains operable in portrait and landscape with real picker and measurement')
        if a.layout_only:
            receipt['complete']=True
            raise SystemExit(0)
        for name,key,tolerance in [('measure-angled.png','angledMm',4),('measure-oriented.jpg','orientedMm',3)]:
            entry=measured(name);value=length()
            if abs(value-240)>tolerance:raise RuntimeError(name+' outside tolerance')
            receipt[key]=value;capture_display('module-'+key)
        done('Perspective and EXIF-oriented photos recover the expected 240 mm length')
        for name,message in [('measure-blank.png','No reference marker found.'),('measure-multiple.png','Use only one reference card')]:
            stage(name);pick();expect(message);no_measurement()
            if 'Use this size' in labels():raise RuntimeError('Invalid reference exposed calibration')
        done('Blank and duplicate reference cards reject calibration and clear earlier results')
        entry=stage('measure-flat.png');pick();expect('Reference found.')
        control('Measured black-square side (mm)');ui._device(className='android.widget.EditText',packageName='dev.construct.runtime').set_text('9')
        action('Use this size');expect('Enter the measured black-square side: 10–300 mm.');no_measurement()
        size('100');endpoints(entry)
        done('Out-of-range calibration is rejected before a length can be produced')
    adb('shell','input','keyevent','3')
    # Match live history entries, not Android's retained mLastPausedActivity.
    deadline=time.monotonic()+20
    while True:
        activity_state=adb('shell','dumpsys','activity','activities')
        (run/'background-activities.txt').write_text(activity_state)
        if not any('* Hist ' in line and 'dev.construct.runtime/.ModuleActivity' in line for line in activity_state.splitlines()):break
        if time.monotonic()>deadline:raise RuntimeError('Background retained a live module Activity')
        time.sleep(.5)
    opened();no_measurement()
    if 'Change reference size' in labels():raise RuntimeError('Background retained calibration')
    done('Ordinary background discards selected image, calibration and endpoints')
    measured();adb('shell','am','force-stop','dev.construct.runtime');opened();no_measurement()
    done('Process restart retains no selected photo or measurement')
    measured();tap('Construct menu');tap('Module access');find('Reopen module')
    switch=access_switch('Allow local marker detection')
    if switch.get('checked')!='true':raise RuntimeError('Expected existing detector grant')
    tap_node(switch);tap('Turn off');find('Allow local marker detection: off.');tap('Reopen module');find('Choose photo')
    stage('measure-flat.png');pick();expect('[CAPABILITY_DENIED]');no_measurement()
    done('Marker detection has its own revocable grant even when image selection is still allowed')
    tap('Construct menu');tap('Module access');find('Reopen module')
    switch=access_switch('Allow selected image pixels')
    if switch.get('checked')!='true':raise RuntimeError('Expected existing pixel grant')
    tap_node(switch);tap('Turn off');find('Allow selected image pixels: off.');tap('Reopen module');find('Choose photo');no_measurement()
    action('Choose photo');expect('[CAPABILITY_DENIED]')
    if 'Photos' in labels():raise RuntimeError('Revoked access still launched picker')
    done('Revoking pixel access closes the old image session and denies a fresh picker request')
    tap('Construct menu');tap('Close module');library()
    if hashlib.sha256(adb('exec-out','cat',current,binary=True)).hexdigest()!=current_entry['sha256']:raise RuntimeError('Source photo modified')
    events=diagnostics();encoded=json.dumps(events)
    if any(value in encoded for value in ['construct-measure-synthetic','content://media','construct-images/','240.0','22.8']):raise RuntimeError('Image or measurement data leaked into diagnostics')
    verify_installed(a.sha)
    done('Synthetic source bytes remain unchanged and diagnostics contain no photo URI or measurement data')
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
