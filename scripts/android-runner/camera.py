#!/usr/bin/env python3
"""Synthetic emulated-camera acceptance only; never connect a physical camera."""
from config import CONFIG, SERIAL, require_runner
import hashlib, io, json, os, re, socket, struct, subprocess, time
from pathlib import Path
from PIL import Image
from ui import adb, nodes, labels, tap, tap_node, find, capture, RESULTS
from host_ui import restart, diagnostics, select_after, installed_status
require_runner()
config=(CONFIG.avd/'construct-camera36.avd/config.ini').read_text()
settings=dict(line.strip().split('=',1) for line in config.replace(' = ','=').splitlines() if '=' in line)
if settings.get('hw.camera.back')!='emulated' or settings.get('hw.camera.front')!='none':raise RuntimeError('Only synthetic emulated camera is approved for this runner')
if not (CONFIG.root/'camera-emulated.flag').exists():raise RuntimeError('Camera suite must explicitly select generated backend')
pid=subprocess.check_output(['systemctl','--user','show',CONFIG.service,'-p','MainPID','--value'],text=True).strip()
args=Path('/proc/'+pid+'/cmdline').read_bytes().decode().split('\0')
if '-camera-back' not in args or args[args.index('-camera-back')+1]!='emulated' or '-camera-front' not in args or args[args.index('-camera-front')+1]!='none':raise RuntimeError('Actual emulator camera command is not synthetic-only')
if '-avd' not in args or args[args.index('-avd')+1]!='construct-camera36':raise RuntimeError('Camera suite requires its dedicated AVD')
expected=os.environ['CONSTRUCT_CAMERA_SHA256'];heading='Pocket Camera · '+os.environ.get('CONSTRUCT_CAMERA_VERSION','0.1.0')
export_checks=os.environ.get('CONSTRUCT_CAMERA_GALLERY_EXPORT')=='1'
result={'complete':False,'checks':[],'cameraSource':'Android emulator generated scene, no physical camera'}
def done(name):result['checks'].append(name);print('PASS:',name,flush=True)
def top():
    for _ in range(12):
        if 'Use configured registry' in labels():return
        adb('shell','input','swipe','360','450','360','1050','300')
    raise RuntimeError('Host top missing')
def status(prefix):
    until=time.monotonic()+20
    while time.monotonic()<until:
        if any(t.startswith(prefix) for t in labels()):return
        time.sleep(.3)
    raise RuntimeError('Missing camera status: '+prefix)
def reach(text):
    for _ in range(12):
        if text in labels():return
        adb('shell','input','swipe','360','1050','360','550','250')
    raise RuntimeError('Control missing: '+text)
def native(text):reach(text);tap(text)
def switch(on):
    reach('Allow camera workspace');previous=None
    until=time.monotonic()+10
    while time.monotonic()<until:
        matches=[n for n in nodes() if n.get('content-desc')=='Allow camera workspace' and n.get('checkable')=='true']
        if len(matches)==1:
            n=matches[0]
            if n.get('bounds')==previous:
                if (n.get('checked')=='true')!=on:
                    tap_node(n)
                    if not on:tap('Turn off')
                    find('Allow camera workspace: '+('on.' if on else 'off.'))
                return
            previous=n.get('bounds')
        time.sleep(.25)
    raise RuntimeError('Camera grant switch unstable')
def opened():
    restart();top();select_after(heading,('Open',));find('Pocket Camera');find('Open camera workspace')
def reopen():
    if os.environ.get('CONSTRUCT_CAMERA_FRESH_LAUNCHES')=='1':
        result['directReopenAccessibility']='EXCLUDED: known intermittent failure; fresh host launches used'
        result['freshLaunchesAfterAccessChanges']=result.get('freshLaunchesAfterAccessChanges',0)+1
        opened()
        return
    native('Reopen module');find('Pocket Camera')
    short=os.environ.get('CONSTRUCT_CAMERA_REOPEN_ONLY')=='1'
    try:find('Open camera workspace',timeout=8 if short else 30)
    except RuntimeError:
        if short:
            result['recoveryDiagnostics']={}
            capture('camera-reopen-before-recovery')
            tap('Construct menu');tap('Return to module')
            try:find('Open camera workspace',timeout=8);result['recoveryDiagnostics']['menuReturn']=True
            except RuntimeError:result['recoveryDiagnostics']['menuReturn']=False
            before=adb('shell','pidof','dev.construct.runtime').strip()
            adb('shell','am','start','-n','dev.construct.runtime/.MainActivity','-f','0x04000000')
            find('Installed');top();select_after(heading,('Open',));find('Pocket Camera')
            after=adb('shell','pidof','dev.construct.runtime').strip()
            result['recoveryDiagnostics']['sameProcess']=before==after
            try:find('Open camera workspace',timeout=8);result['recoveryDiagnostics']['activityRecreate']=True
            except RuntimeError:result['recoveryDiagnostics']['activityRecreate']=False
            capture('camera-reopen-after-recovery')
            print('RECOVERY DIAGNOSTICS (not acceptance):',result['recoveryDiagnostics'],flush=True)
        raise RuntimeError('Direct Reopen lost accessibility; recovery diagnostics are not acceptance')
    print('Direct Reopen retains accessible module controls',flush=True)
def workspace():tap('Open camera workspace');find('Close camera');status('Camera preview ready.')
def shutter(count):tap('Take photo');find('Saved photos: %d / 8'%count);find('Saved photo preview')
def rotate(value):
    adb('shell','wm','user-rotation','lock',str(value))
    until=time.monotonic()+12
    while time.monotonic()<until:
        raw=adb('exec-out','screencap','-p',binary=True)
        width,height=struct.unpack('>II',raw[16:24])
        if (width>height)==bool(value):return
        time.sleep(.3)
    raise RuntimeError('Display rotation did not settle')
def no_camera_client():
    # Camera service has historical package entries too; inspect only active-client section.
    until=time.monotonic()+12
    while time.monotonic()<until:
        dump=adb('shell','dumpsys','media.camera')
        section=dump.split('Active Camera Clients:',1)
        if len(section)!=2:raise RuntimeError('Cannot identify active camera-client section')
        active=section[1].split('\n\n',1)[0]
        if 'dev.construct.runtime' not in active:
            result['releaseEvidence']=active.strip();return
        time.sleep(.5)
    raise RuntimeError('Construct still owns a camera client after leaving')
def gallery_files():
    output=adb('shell','if [ -d /sdcard/Pictures/Construct ]; then ls -A /sdcard/Pictures/Construct; fi')
    names=output.split()
    if any(not re.fullmatch(r'Construct-[a-f0-9-]{36}\.jpg',name) for name in names):
        raise RuntimeError('Unexpected gallery contents on disposable baseline')
    return names
try:
    if export_checks and gallery_files():raise RuntimeError('Gallery baseline is not empty; refusing stale export evidence')
    restart()
    url=CONFIG.test_catalog
    from catalog_input import replace_catalog
    import ui
    replace_catalog(nodes, lambda value: ui._device(className='android.widget.EditText',packageName='dev.construct.runtime').set_text(value), url)
    tap('Refresh catalog');find('Catalog refreshed.');select_after(heading,('Review & install',))
    find('Allow camera workspace')
    switches=[n for n in nodes() if n.get('content-desc')=='Allow camera workspace' and n.get('checkable')=='true']
    if len(switches)!=1 or switches[0].get('checked')!='false':raise RuntimeError('Camera must default off')
    tap('Allow & install');installed_status()
    top();events=diagnostics();install=[e for e in events if e.get('moduleId')=='dev.construct.camera' and e.get('code')=='INSTALLED_TRIAL']
    if len(install)!=1 or install[0].get('packageDigest')!=expected:raise RuntimeError('Wrong signed camera candidate')
    opened();tap('Open camera workspace');status('[CAPABILITY_DENIED]');tap('Module access');switch(True)
    reopen();tap('Open camera workspace');status('[ANDROID_PERMISSION_DENIED]');tap('Module access')
    done('Signed camera module defaults off; both module and Android gates deny independently')
    native('Allow Android camera access');find('While using the app');tap('While using the app');find('Android camera access: allowed');reopen();workspace()
    if os.environ.get('CONSTRUCT_CAMERA_REOPEN_ONLY')=='1':
        tap('Close camera')
        opened();tap('Module access');switch(False);native('Delete all saved photos');tap('Keep photos');reopen()
        tap('Open camera workspace');status('[CAPABILITY_DENIED]');capture('camera-direct-reopen')
        tap('Close module');top();events=diagnostics();meta=[e for e in events if e.get('code')=='ENVIRONMENT']
        if len(meta)!=1:raise RuntimeError('Missing exact APK metadata')
        result['environment']=meta[0];result['scope']='Dialog/direct-Reopen reproduction only; no photo/quota acceptance'
        done('Accessible direct Reopen after Android permission and native cancellation; revoked camera remains denied')
        result['complete']=True
        raise SystemExit(0)
    shutter(1)
    done('Actual Android permission dialog enables streaming native preview and user-shutter capture')
    tap('Close camera');no_camera_client();opened();workspace();tap('Saved photos');find('Saved photos: 1 / 8');find('Saved photo preview')
    done('Private album retains a decoded photo across workspace and host restart; camera releases on close')
    tap('Back to camera');status('Camera preview ready.');rotate(1);find('Installed');no_camera_client();rotate(0);find('Installed')
    opened();workspace();tap('Saved photos');find('Saved photos: 1 / 8');find('Saved photo preview')
    done('Real rotation closes native camera without losing the saved photo')
    for count in range(2,9):tap('Back to camera');status('Camera preview ready.');shutter(count)
    tap('Back to camera');status('Camera preview ready.');tap('Take photo');status('[CAMERA_QUOTA]');tap('Saved photos');find('Saved photos: 8 / 8')
    tap('Delete photo');tap('Keep photo');find('Saved photos: 8 / 8');tap('Delete photo');tap('Delete permanently');find('Saved photos: 7 / 8')
    done('Eight-photo cap refuses the ninth shot; deletion requires confirmation and frees one slot')
    tap('Back to camera');status('Camera preview ready.');adb('shell','input','keyevent','3');no_camera_client()
    # Alpha10 requires real accessible descendants after dialogs and direct Reopen.
    # No restart, synthetic-tree or coordinate success fallback in these transitions.
    opened();tap('Module access');switch(False);native('Delete all saved photos');tap('Keep photos');reopen();tap('Open camera workspace');status('[CAPABILITY_DENIED]')
    tap('Module access');native('Delete all saved photos');tap('Delete permanently');find('Saved photos deleted.');reopen();tap('Open camera workspace');status('[CAPABILITY_DENIED]')
    tap('Close module');opened();tap('Open camera workspace');status('[CAPABILITY_DENIED]');tap('Module access');switch(True);reopen();workspace();tap('Saved photos');find('Saved photos: 0 / 8');tap('Close camera')
    done('Background closes camera; module revocation persists, and native deletion works with access off')
    adb('shell','pm','revoke','dev.construct.runtime','android.permission.CAMERA');opened();tap('Open camera workspace');status('[ANDROID_PERMISSION_DENIED]');tap('Module access')
    native('Allow Android camera access');find('While using the app');tap('While using the app');find('Android camera access: allowed');reopen();workspace();shutter(1);tap('Close camera')
    adb('shell','svc','wifi','disable');adb('shell','svc','data','disable')
    try:opened();workspace();tap('Saved photos');find('Saved photos: 1 / 8');find('Saved photo preview');tap('Close camera');no_camera_client()
    finally:adb('shell','svc','wifi','enable');adb('shell','svc','data','enable')
    done('Android revoke denies despite module grant; UI regrant restores capture and offline album')
    if export_checks:
        opened();workspace();tap('Saved photos');find('Saved photo preview')
        tap('Save to phone gallery');find('Save a gallery copy?');tap('Keep private');find('Saved photo preview')
        if gallery_files():raise RuntimeError('Canceled export created a visible gallery file')
        done('Canceling native gallery confirmation keeps the photo private')
        tap('Save to phone gallery');tap('Save copy');status('Copy saved to phone gallery')
        exported=gallery_files()
        if len(exported)!=1:raise RuntimeError('Expected exactly one explicit gallery copy')
        find('Saved photos: 1 / 8');capture('camera-gallery-export');tap('Close camera')
    if adb('shell','getprop','ro.kernel.qemu').strip()!='1' or adb('shell','getprop','ro.build.type').strip()!='userdebug':raise RuntimeError('Artifact read requires synthetic userdebug emulator')
    try:
        adb('root',timeout=30);adb('wait-for-device',timeout=30)
        if adb('shell','id','-u').strip()!='0':raise RuntimeError('Artifact inspection root unavailable')
        folder='/data/user/0/dev.construct.runtime/files/camera-photos/dev.construct.camera/'
        names=adb('shell','ls',folder).split()
        if len(names)!=1 or not re.fullmatch(r'[a-f0-9-]{36}\.jpg',names[0]):raise RuntimeError('Expected exactly one private JPEG after deletion/recovery')
        blob=adb('exec-out','cat',folder+names[0],binary=True)
        if not 0<len(blob)<=4*1024*1024:raise RuntimeError('JPEG byte bound')
        photo=Image.open(io.BytesIO(blob));photo.load()
        if photo.format!='JPEG' or max(photo.size)>4096 or min(photo.size)<=0:raise RuntimeError('JPEG format/dimension bound')
        if max(hi-lo for lo,hi in photo.convert('RGB').getextrema())<16:raise RuntimeError('Synthetic camera image unexpectedly blank')
        if photo.getexif().get(34853):raise RuntimeError('Unexpected GPS metadata')
        (RESULTS/'camera-synthetic.jpg').write_bytes(blob)
        result['photo']={'sha256':hashlib.sha256(blob).hexdigest(),'bytes':len(blob),'width':photo.width,'height':photo.height,'gpsMetadata':False,'exifOrientation':photo.getexif().get(274)}
        if export_checks:
            exported_blob=adb('exec-out','cat','/sdcard/Pictures/Construct/'+exported[0],binary=True)
            if exported_blob!=blob:raise RuntimeError('Gallery bytes differ from private JPEG')
            rows=adb('shell','content','query','--uri','content://media/external/images/media','--projection','_display_name:mime_type:relative_path:is_pending')
            matched=[line for line in rows.splitlines() if exported[0] in line]
            if len(matched)!=1 or not all(value in matched[0] for value in ('mime_type=image/jpeg','relative_path=Pictures/Construct/','is_pending=0')):
                raise RuntimeError('Gallery copy is not a published JPEG in MediaStore')
            result['galleryExport']={'bytes':len(exported_blob),'sha256':hashlib.sha256(exported_blob).hexdigest(),'pending':False,'mimeType':'image/jpeg','matchesPrivateOriginal':True}
            done('Published MediaStore JPEG exactly matches private photo; original remains and row is not pending')
    finally:
        adb('unroot',timeout=30);adb('wait-for-device',timeout=30)
        result['adbUnrooted']=adb('shell','id','-u').strip()!='0'
        if not result['adbUnrooted']:raise RuntimeError('ADB must return non-root')
    done('Private synthetic JPEG is bounded, decodable and nonblank, with no GPS metadata; ADB restored non-root')
    if export_checks:
        opened();workspace();tap('Saved photos');find('Saved photo preview');tap('Delete photo');tap('Delete permanently');find('Saved photos: 0 / 8')
        tap('Close camera');no_camera_client()
        if gallery_files()!=exported or adb('exec-out','cat','/sdcard/Pictures/Construct/'+exported[0],binary=True)!=exported_blob:
            raise RuntimeError('Deleting the private photo changed the gallery copy')
        done('Deleting private original and closing workspace leaves the independent gallery copy intact')
    restart();top();events=diagnostics();meta=[e for e in events if e.get('code')=='ENVIRONMENT']
    if len(meta)!=1:raise RuntimeError('Missing installed APK identity')
    result['environment']=meta[0]
    camera=[e for e in events if e.get('moduleId')=='dev.construct.camera'];codes=[e.get('code') for e in camera]
    if codes.count('CAMERA_SAVED')!=9 or 'CAMERA_QUOTA' not in codes:raise RuntimeError('Expected nine successful user captures and a quota rejection')
    if export_checks and codes.count('PHOTO_EXPORTED')!=1:raise RuntimeError('Expected exactly one native export event')
    if any(c in ('JAVASCRIPT_ERROR','RENDERER_STOPPED','CAMERA_IMAGE','CAMERA_CAPTURE') for c in codes):raise RuntimeError('Unexpected camera runtime error')
    if any(t in json.dumps(events) for t in ('/camera-photos/','.jpg','data:image','Exif')):raise RuntimeError('Photo/path data in diagnostics')
    result['events']=camera
    done('Native capture/release evidence is fresh and diagnostic metadata omits photo paths/contents')
    result['complete']=True
except Exception as error:
    result['error']=str(error)
    try:
        capture('camera-failure')
        (RESULTS/'camera-logcat.txt').write_text(adb('logcat','-d','-t','200','AndroidRuntime:E','CameraX:E','*:S'))
        (RESULTS/'camera-service-failure.txt').write_text(adb('shell','dumpsys','media.camera'))
    except Exception:pass
    raise
finally:
    adb('shell','wm','user-rotation','lock','0')
    (RESULTS/'camera-result.json').write_text(json.dumps(result,indent=2)+'\n')
