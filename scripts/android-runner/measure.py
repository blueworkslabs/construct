#!/usr/bin/env python3
"""Native photo-picker/measurement acceptance with synthetic fixtures only."""
from config import CONFIG, require_runner
from ui import adb,nodes,labels,tap,tap_node,find,capture,RESULTS
from host_ui import restart,select_after,installed_status,diagnostics
from catalog_input import replace_text
from pathlib import Path
import ui
import hashlib,json,os,re,time

require_runner()
result={'complete':False,'checks':[],'source':'Generated non-personal ArUco tabletop fixtures'}
heading='Pocket Measure · 0.1.2'
fixtures=CONFIG.root/'measure-fixtures'
entries=json.loads((fixtures/'manifest.json').read_text())
current=None
current_entry=None
stage_index=0
def done(text):result['checks'].append(text);print('PASS:',text,flush=True)
def top():
    for _ in range(15):
        if 'Use configured registry' in labels():return
        adb('shell','input','swipe','360','450','360','1050','250')
    raise RuntimeError('Workshop top missing')
def expect(prefix,timeout=60):
    until=time.monotonic()+timeout
    while time.monotonic()<until:
        items=labels()
        found=next((x for x in items if x.startswith(prefix)),None)
        if found:return found
        errors=[x for x in items if x.startswith('[') and ('MEASURE_' in x or 'PHOTO_' in x or 'MARKER_' in x)]
        if errors:raise RuntimeError(str(errors))
        time.sleep(.3)
    raise RuntimeError('Missing '+prefix+'; '+str(labels()))
def opened():
    restart();top();select_after(heading,('Open',));tap('Open measurement workspace');find('Choose photo')
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
    tap('Choose photo')
    until=time.monotonic()+30
    while time.monotonic()<until:
        ns=nodes()
        # Stock Android photo picker: the clean snapshot receives exactly one generated media item.
        candidates=[n for n in ns if n.get('resource-id','').endswith('/icon_thumbnail') or n.get('resource-id','').endswith('/photopicker_item_thumbnail')]
        if not candidates:
            candidates=[n for n in ns if n.get('content-desc','').startswith('Photo taken')]
        if len(candidates)==1:
            tap_node(candidates[0]);return
        if len(candidates)>1:raise RuntimeError('Ambiguous picker content; refusing to guess which image')
        time.sleep(.4)
    capture('measure-picker-missing');raise RuntimeError('Synthetic photo missing in picker: '+str(labels()))

def size(value):
    find('Marker side (mm)')
    ui._device(className='android.widget.EditText',packageName='dev.construct.runtime').set_text(value)
    tap('Confirm size');expect('Tap the two ends')

def endpoints(entry):
    initial_bounds=find('Measurement photo: tap two endpoints').get('bounds')
    for x,y in entry['endpoints']:
        node=find('Measurement photo: tap two endpoints')
        x1,y1,x2,y2=map(int,re.findall(r'\d+',node.get('bounds')))
        scale=min((x2-x1)/entry['width'],(y2-y1)/entry['height'])
        left=x1+((x2-x1)-entry['width']*scale)/2
        top=y1+((y2-y1)-entry['height']*scale)/2
        adb('shell','input','tap',str(round(left+x*scale)),str(round(top+y*scale)))
        time.sleep(.6)
        if find('Measurement photo: tap two endpoints').get('bounds')!=initial_bounds:raise RuntimeError('Photo area moved between endpoint taps')
    return float(expect('Length: ').split()[1])*10
try:
    if adb('shell','getprop','ro.kernel.qemu').strip()!='1':raise RuntimeError('Requires disposable emulator')
    restart()
    replace_text(nodes,lambda value:ui._device(className='android.widget.EditText',packageName='dev.construct.runtime').set_text(value),CONFIG.test_catalog)
    tap('Refresh catalog')
    try:find('Catalog refreshed.')
    except RuntimeError:
        if not any(t.startswith('[REGISTRY_NETWORK]') for t in labels()):raise
        result['setupNetworkRetry']=True;time.sleep(2);tap('Refresh catalog');find('Catalog refreshed.')
    select_after(heading,('Review & install',));tap('Allow & install');installed_status()
    top();events=diagnostics();installed=[e for e in events if e.get('code')=='INSTALLED_TRIAL' and e.get('moduleId')=='dev.construct.measure']
    if len(installed)!=1 or installed[0].get('packageDigest')!=os.environ['CONSTRUCT_MEASURE_SHA256']:raise RuntimeError('Wrong signed measurement launcher')
    top();select_after(heading,('Open',));tap('Open measurement workspace');expect('[CAPABILITY_DENIED]')
    done('Native measurement cannot open before its explicit module grant')
    tap('Module access');find('Allow photo measurement');grant=next(n for n in nodes() if n.get('content-desc')=='Allow photo measurement' and n.get('checkable')=='true')
    if grant.get('checked')!='false':raise RuntimeError('Measurement grant was not off')
    tap_node(grant);find('Allow photo measurement: on.');tap('Reopen module');tap('Open measurement workspace');find('Choose photo')
    tap('Choose photo');adb('shell','input','keyevent','4');expect('No photo selected.')
    done('System picker cancellation reads no photo and returns to workspace')
    entry=stage('measure-flat.png')
    adb('shell','cmd','connectivity','airplane-mode','enable');adb('shell','svc','wifi','disable');adb('shell','svc','data','disable')
    if adb('shell','settings','get','global','airplane_mode_on').strip()!='1':raise RuntimeError('Offline setup failed')
    result['offlineBeforeFirstDetection']=True
    pick();expect('Reference found.')
    find('Marker side (mm)');ui._device(className='android.widget.EditText',packageName='dev.construct.runtime').set_text('0');tap('Confirm size');expect('[SIZE_INVALID]')
    done('Invalid marker size is rejected before endpoint measurement')
    size('100');value=endpoints(entry)
    if abs(value-entry['expectedMm'])>3:raise RuntimeError('Synthetic flat measurement outside 3 mm: '+str(value))
    result['flatMm']=value;capture('measure-flat');done('First offline native ArUco detection and two endpoint taps measure synthetic 240 mm within 3 mm')
    size('95');value=endpoints(entry)
    if abs(value-228)>3:raise RuntimeError('Measured marker-size scaling failed: '+str(value))
    result['scaledMm']=value;done('95 mm actual marker size scales the same endpoints to 228 mm and clears old results')
    tap('Clear endpoints')
    if any(x.startswith('Length:') for x in labels()):raise RuntimeError('Clear retained a result')
    node=find('Measurement photo: tap two endpoints');x1,y1,x2,y2=map(int,re.findall(r'\d+',node.get('bounds')))
    scaledHeight=(x2-x1)*entry['height']/entry['width']
    if (y2-y1)>scaledHeight+10:
        adb('shell','input','tap',str((x1+x2)//2),str(y1+2))
        if 'First endpoint set. Tap the other end.' in labels():raise RuntimeError('Letterbox tap accepted')
        done('Letterbox padding does not set an endpoint')
    entry=stage('measure-angled.png');pick();expect('Reference found.');size('100');value=endpoints(entry)
    if abs(value-240)>4:raise RuntimeError('Synthetic perspective measurement outside 4 mm: '+str(value))
    result['angledMm']=value;capture('measure-angled');done('Independent perspective-warped synthetic endpoints recover 240 mm within 4 mm')
    entry=stage('measure-oriented.jpg');pick();expect('Reference found.');size('100');value=endpoints(entry)
    if abs(value-240)>3:raise RuntimeError('EXIF-oriented endpoint measurement failed: '+str(value))
    result['orientedMm']=value;done('EXIF orientation is applied consistently to native marker detection, photo display and endpoint mapping')
    for name in ['measure-blank.png','measure-multiple.png']:
        stage(name);pick();expect('[MARKER_NOT_FOUND]')
        if any(x.startswith('Length:') or x=='Confirm size' for x in labels()):raise RuntimeError('Invalid marker retained measurement controls')
    done('Blank and duplicate-reference photos reject measurement and clear previous results')
    stage('measure-flat.png');pick();expect('Reference found.');size('100')
    adb('shell','input','keyevent','3');opened()
    if any(x.startswith('Length:') or x=='Confirm size' for x in labels()):raise RuntimeError('Background retained photo or result')
    done('Background closes workspace; reopening retains no selected image or measurement')
    entry=stage('measure-flat.png');pick();expect('Reference found.');size('100');endpoints(entry)
    adb('shell','settings','put','system','accelerometer_rotation','0');adb('shell','settings','put','system','user_rotation','1');find('Installed')
    adb('shell','settings','put','system','user_rotation','0');opened()
    if any(x.startswith('Length:') or x=='Confirm size' for x in labels()):raise RuntimeError('Rotation retained a photo or result')
    done('Rotation closes the native workspace rather than restoring a selected photo or pending request')
    tap('Close measure');restart();top();select_after(heading,('Module access',));tap_node(next(n for n in nodes() if n.get('content-desc')=='Allow photo measurement' and n.get('checkable')=='true'));tap('Turn off');find('Allow photo measurement: off.')
    tap('Reopen module');tap('Open measurement workspace');expect('[CAPABILITY_DENIED]')
    done('Revocation blocks reopening the workspace')
    restart();top();events=diagnostics();result['environment']=next(e for e in events if e.get('code')=='ENVIRONMENT')
    if any(word in json.dumps(events) for word in ['construct-measure-synthetic','measure-flat','Length:','228.0']):raise RuntimeError('Image or measurement details leaked into diagnostics')
    if hashlib.sha256(adb('exec-out','cat',current,binary=True)).hexdigest()!=next(e['sha256'] for e in entries if e['name']=='measure-flat.png'):raise RuntimeError('Source image was modified')
    done('Original photo bytes remain unchanged and diagnostics contain no photo or measurement details')
    result['complete']=True
except Exception as e:
    result['error']=str(e)
    try:capture('measure-failure');(RESULTS/'measure-logcat.txt').write_text(adb('logcat','-d','-t','250','AndroidRuntime:E','OpenCV/StaticHelper:E','linker:E','*:S'))
    except Exception:pass
    raise
finally:
    adb('shell','settings','put','system','user_rotation','0')
    adb('shell','cmd','connectivity','airplane-mode','disable');adb('shell','svc','wifi','enable');adb('shell','svc','data','enable')
    (RESULTS/'measure-result.json').write_text(json.dumps(result,indent=2)+'\n')
