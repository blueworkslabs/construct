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
WORKSPACE='Measurement photo viewport'
PHOTO='Measurement photo: tap to place an endpoint, drag a handle to adjust'
original_font_scale=adb('shell','settings','get','system','font_scale').strip()
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
    restart();top();select_after(heading,('Open',));tap('Open measurement workspace');control('Choose photo')
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

def control(text):
    # Scroll only the native controls sheet, never the photo gesture surface.
    if 'Expand controls' in labels():tap('Expand controls')
    for direction in [1,-1]:
        for _ in range(8):
            matches=[n for n in nodes() if text in (n.get('text'),n.get('content-desc')) and n.get('enabled')!='false']
            if matches:return matches[0]
            x1,y1,x2,y2=map(int,re.findall(r'\d+',find('Measurement controls').get('bounds')))
            top=y1+max(20,(y2-y1)//6);bottom=y2-max(20,(y2-y1)//6)
            adb('shell','input','swipe',str((x1+x2)//2),str(bottom if direction==1 else top),str((x1+x2)//2),str(top if direction==1 else bottom),'350')
    raise RuntimeError('Control missing in bounded sheet scroll: '+text)

def collapse():
    if 'Expand controls' not in labels():
        control('Collapse controls');tap('Collapse controls')
    time.sleep(.4)

def action(text,collapse_after=False):
    control(text);tap(text);time.sleep(.4)
    if collapse_after:collapse()

def size(value):
    if 'Marker side (mm)' not in labels():
        chip=next((x for x in labels() if x.startswith('Marker ') and x.endswith('mm ✓')),None)
        if chip is None:
            control('Collapse controls')
            chip=next((x for x in labels() if x.startswith('Marker ') and x.endswith('mm ✓')),None)
        if chip:tap(chip)
    control('Marker side (mm)')
    ui._device(className='android.widget.EditText',packageName='dev.construct.runtime').set_text(value)
    # Hide only the keyboard (the app's Back policy is not used as navigation here).
    if ui._device.info.get('currentPackageName') != 'dev.construct.runtime':raise RuntimeError('Lost measurement workspace')
    action('Confirm size');expect('Tap the two ends');collapse()

# The viewport excludes the fixed collapsed controls reserve. Read it with controls
# collapsed so temporary expanded-sheet occlusion cannot alter observed bounds.
def screen_point(entry,point):
    x1,y1,x2,y2=map(int,re.findall(r'\d+',find(WORKSPACE).get('bounds')))
    scale=min((x2-x1)/entry['width'],(y2-y1)/entry['height'])
    left=x1+((x2-x1)-entry['width']*scale)/2
    top=y1+((y2-y1)-entry['height']*scale)/2
    return round(left+point[0]*scale),round(top+point[1]*scale)

def length():return float(expect('Length: ').split()[1])*10

def endpoints(entry):
    collapse();initial_bounds=find(WORKSPACE).get('bounds')
    for point in entry['endpoints']:
        x,y=screen_point(entry,point)
        adb('shell','input','tap',str(x),str(y));time.sleep(.6)
        if find(WORKSPACE).get('bounds')!=initial_bounds:raise RuntimeError('Photo area moved between endpoint taps')
    return length()

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
    tap_node(grant);find('Allow photo measurement: on.');tap('Reopen module');tap('Open measurement workspace');control('Choose photo')
    action('Choose photo');adb('shell','input','keyevent','4');expect('No photo selected.')
    done('System picker cancellation reads no photo and returns to workspace')
    entry=stage('measure-flat.png')
    adb('shell','cmd','connectivity','airplane-mode','enable');adb('shell','svc','wifi','disable');adb('shell','svc','data','disable')
    if adb('shell','settings','get','global','airplane_mode_on').strip()!='1':raise RuntimeError('Offline setup failed')
    result['offlineBeforeFirstDetection']=True
    pick();expect('Reference found.')
    find('Marker side (mm)');ui._device(className='android.widget.EditText',packageName='dev.construct.runtime').set_text('0');action('Confirm size');expect('[SIZE_INVALID]')
    done('Invalid marker size is rejected before endpoint measurement')
    size('100');value=endpoints(entry)
    if abs(value-entry['expectedMm'])>3:raise RuntimeError('Synthetic flat measurement outside 3 mm: '+str(value))
    result['flatMm']=value;capture('measure-flat');done('First offline native ArUco detection and two endpoint taps measure synthetic 240 mm within 3 mm')
    # Multi-move drag creates one Undo action and reads the latest pair, not an old Compose closure.
    x,y=screen_point(entry,entry['endpoints'][1]);nx,ny=screen_point(entry,(960,700))
    adb('shell','input','swipe',str(x),str(y),str(nx),str(ny),'800');time.sleep(.6)
    moved=length()
    if abs(moved-270)>4:raise RuntimeError('Dragging B did not recompute the expected 270 mm: '+str(moved))
    action('Undo',collapse_after=True)
    if length()!=result['flatMm']:raise RuntimeError('One Undo did not restore the complete pre-drag pair')
    action('Undo',collapse_after=True);expect('First endpoint set.')
    if any(x.startswith('Length:') for x in labels()):raise RuntimeError('Drag recorded multiple Undo entries')
    x,y=screen_point(entry,entry['endpoints'][1]);adb('shell','input','tap',str(x),str(y));time.sleep(.6)
    done('Dragging an existing handle recomputes length; one Undo restores the prior pair and the next removes B')
    # A coincident preview is invalid. It must not open controls or interrupt the drag.
    bx,by=screen_point(entry,entry['endpoints'][1]);ax,ay=screen_point(entry,entry['endpoints'][0])
    bounds=find(WORKSPACE).get('bounds')
    ui._device.touch.down(bx,by).move(ax,ay);time.sleep(.4)
    expect('Choose two distinct nearby endpoints.')
    if 'Expand controls' not in labels() or find(WORKSPACE).get('bounds')!=bounds:
        raise RuntimeError('Rejected preview expanded controls or moved the photo')
    ui._device.touch.move(bx,by);time.sleep(.4)
    if any('Choose two distinct nearby endpoints.' in x for x in labels()):raise RuntimeError('Accepted preview retained error')
    ui._device.touch.up(bx,by)
    if length()!=result['flatMm']:raise RuntimeError('Rejected preview changed accepted measurement')
    done('Rejected preview stays collapsed and fixed; continuing to a valid point clears the error')
    x,y=screen_point(entry,entry['endpoints'][1]);nx,ny=screen_point(entry,(960,700))
    ui._device.touch.down(x,y).move(nx,ny);time.sleep(.6)
    if abs(length()-270)>4:raise RuntimeError('Held drag did not preview')
    adb('shell','input','keyevent','4');ui._device.touch.up(nx,ny);time.sleep(.6)
    if length()!=result['flatMm']:raise RuntimeError('Back did not cancel the active drag')
    done('Back cancels a held drag, restores the pre-drag pair and keeps the workspace open')
    ui._device.touch.down(x,y).move(nx,ny);time.sleep(.6)
    if abs(length()-270)>4:raise RuntimeError('Held drag did not preview before cancellation')
    adb('shell','input','touchscreen','motionevent','CANCEL',str(nx),str(ny));time.sleep(.6)
    if length()!=result['flatMm']:raise RuntimeError('Pointer cancellation committed a preview')
    done('Android pointer cancellation restores the pre-drag pair without committing a preview')
    # Cancellation must discard invalid preview feedback as well as the preview geometry.
    for cancel_kind in ('Back', 'Android pointer cancel'):
        bx,by=screen_point(entry,entry['endpoints'][1]);ax,ay=screen_point(entry,entry['endpoints'][0])
        ui._device.touch.down(bx,by).move(ax,ay);time.sleep(.4)
        expect('Choose two distinct nearby endpoints.')
        if cancel_kind=='Back':
            adb('shell','input','keyevent','4');ui._device.touch.up(ax,ay)
        else:
            adb('shell','input','touchscreen','motionevent','CANCEL',str(ax),str(ay))
        time.sleep(.6)
        if any('Choose two distinct nearby endpoints.' in value for value in labels()):
            raise RuntimeError(cancel_kind+' retained cancelled preview error')
        if length()!=result['flatMm'] or 'Expand controls' not in labels():
            raise RuntimeError(cancel_kind+' failed to restore the collapsed valid measurement')
        done(cancel_kind+' clears rejected preview feedback and restores the valid length without expanding controls')
    action('Select endpoint B')
    for _ in range(4):action('Nudge B left')
    nudged=length()
    if not result['flatMm']-3<=nudged<result['flatMm']:raise RuntimeError('Photo-pixel nudge did not reduce length')
    for _ in range(4):action('Undo')
    collapse()
    if length()!=result['flatMm']:raise RuntimeError('Nudge Undo did not restore original measurement')
    done('Accessible endpoint nudges use photo pixels and each nudge is individually undoable')
    control('Nudge B left')  # B is still selected from the nudge sequence above.
    action('Undo')
    expect('First endpoint set.')
    if any(x.startswith('Nudge B ') or x=='Select endpoint B' for x in labels()):
        raise RuntimeError('Undo removed B but retained its selection/nudge controls')
    action('Select endpoint A')
    action('Undo')
    if any(x.startswith('Nudge ') or x.startswith('Select endpoint ') for x in labels()):
        raise RuntimeError('Undo removed A but retained endpoint controls')
    collapse()
    if abs(endpoints(entry)-240)>3:raise RuntimeError('Replacing endpoints after Undo changed measurement')
    action('Select endpoint B');action('Clear');action('Undo')
    # Restoring a cleared pair must not revive a selection from before Clear.
    if any(x.startswith('Nudge ') for x in labels()):raise RuntimeError('Clear/Undo revived stale selection')
    collapse()
    done('Undo removes selection/nudges for deleted endpoints; Clear/Undo does not revive stale selection')
    action('Clear',collapse_after=True)
    # The entire fitted photo, including its bottom edge, is reachable without zoom.
    x,y=screen_point(entry,(entry['width']*.5,entry['height']*.98))
    sheet_top=int(re.findall(r'\d+',find('Measurement controls').get('bounds'))[1])
    if y>=sheet_top:raise RuntimeError('Bottom of fitted photo is hidden by collapsed controls')
    ui._device.click(x,y);expect('First endpoint set.')
    action('Undo',collapse_after=True)
    done('Bottom-edge endpoint is reachable at fit; collapsed sheet leaves the whole photo available')
    # Rapid taps are placements, never a hidden double-tap zoom gesture.
    ax,ay=screen_point(entry,entry['endpoints'][0]);bx,by=screen_point(entry,entry['endpoints'][1])
    ui._device.touch.down(ax,ay).up(ax,ay).down(bx,by).up(bx,by)
    if abs(length()-240)>3:raise RuntimeError('Rapid endpoint taps did not place the expected pair')
    expect('Zoom 1.0×')
    action('Clear',collapse_after=True)
    done('Consecutive endpoint taps place immediately without double-tap zoom arbitration')
    ui._device(description=PHOTO).pinch_out(percent=40,steps=25);time.sleep(.6)
    zoom=next((x for x in labels() if x.startswith('Zoom ') and 'Reset' in x),None)
    if zoom is None:raise RuntimeError('Two-finger pinch did not zoom')
    if any(x.startswith(('Length:','First endpoint set.')) for x in labels()):raise RuntimeError('Pinch placed an endpoint')
    x,y=screen_point(entry,(650,450))
    ui._device.swipe(x,y,x-60,y-50,duration=.4);time.sleep(.4)
    if any(x.startswith(('Length:','First endpoint set.')) for x in labels()):raise RuntimeError('Pan placed an endpoint')
    tap(zoom);time.sleep(.4)
    if abs(endpoints(entry)-240)>3:raise RuntimeError('Reset after gestures changed photo coordinates')
    done('Real two-pointer pinch and zoomed pan create no endpoint; fit reset preserves calibrated photo coordinates')
    size('95');value=endpoints(entry)
    if abs(value-228)>3:raise RuntimeError('Measured marker-size scaling failed: '+str(value))
    result['scaledMm']=value;done('95 mm actual marker size scales the same endpoints to 228 mm and clears old results')
    action('Clear',collapse_after=True)
    if any(x.startswith('Length:') for x in labels()):raise RuntimeError('Clear retained a result')
    node=find(WORKSPACE);x1,y1,x2,y2=map(int,re.findall(r'\d+',node.get('bounds')))
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
    # Review regression: a minimum line count was insufficient when messages wrapped.
    # Change only the disposable guest; configuration changes intentionally close the workspace.
    result['largeFontLayouts']=[]
    for width,height,font_scale in [(720,1280,'1.3'),(480,1600,'1.8')]:
        action('Close measure')
        adb('shell','wm','size',str(width)+'x'+str(height))
        adb('shell','settings','put','system','font_scale',font_scale)
        time.sleep(2)
        opened();entry=stage('measure-flat.png');pick();expect('Reference found.');size('100')
        bounds=find(WORKSPACE).get('bounds')
        value=endpoints(entry)
        if abs(value-240)>4:raise RuntimeError('Large-font measurement outside 4 mm: '+str(value))
        action('Clear',collapse_after=True)
        if find(WORKSPACE).get('bounds')!=bounds:raise RuntimeError('Clearing status moved large-font photo')
        result['largeFontLayouts'].append(dict(width=width,height=height,fontScale=font_scale,bounds=bounds,measuredMm=value))
        done('Photo bounds remain fixed across instructions, both taps, result and clear at width '+str(width)+' / font scale '+font_scale)
    action('Close measure');adb('shell','wm','size','reset')
    if original_font_scale=='null':adb('shell','settings','delete','system','font_scale')
    else:adb('shell','settings','put','system','font_scale',original_font_scale)
    time.sleep(2);opened()
    for name in ['measure-blank.png','measure-multiple.png']:
        stage(name);pick();expect('[MARKER_NOT_FOUND]')
        if any(x.startswith('Length:') or x=='Confirm size' for x in labels()):raise RuntimeError('Invalid marker retained measurement controls')
    done('Blank and duplicate-reference photos reject measurement and clear previous results')
    entry=stage('measure-flat.png');pick();expect('Reference found.');size('100');endpoints(entry)
    adb('shell','input','keyevent','3');opened()
    if any(x.startswith('Length:') or x=='Confirm size' for x in labels()):raise RuntimeError('Background retained photo or result')
    done('Background closes workspace; reopening retains no selected image or measurement')
    entry=stage('measure-flat.png');pick();expect('Reference found.');size('100');endpoints(entry)
    pid=adb('shell','pidof','dev.construct.runtime').strip()
    before=length();portrait=find(WORKSPACE).get('bounds')
    adb('shell','settings','put','system','accelerometer_rotation','0');adb('shell','settings','put','system','user_rotation','1');time.sleep(2)
    if find(WORKSPACE).get('bounds')==portrait:raise RuntimeError('Rotation did not resize the photo surface')
    if length()!=before or adb('shell','pidof','dev.construct.runtime').strip()!=pid:raise RuntimeError('Rotation lost current work or restarted process')
    action('Clear',collapse_after=True)
    x,y=screen_point(entry,(entry['width']*.5,entry['height']*.98))
    sheet_top=int(re.findall(r'\d+',find('Measurement controls').get('bounds'))[1])
    if y>=sheet_top:raise RuntimeError('Landscape fit puts the photo bottom behind controls')
    ui._device.click(x,y);expect('First endpoint set.')
    action('Undo',collapse_after=True);action('Undo',collapse_after=True)
    if length()!=before:raise RuntimeError('Landscape edge placement Undo did not restore the pair')
    done('Landscape bottom-edge placement works at fit without hiding behind controls; Undo restores the pair')
    adb('shell','settings','put','system','user_rotation','0');time.sleep(2)
    if length()!=before:raise RuntimeError('Portrait return changed measurement')
    done('Rotation retains the same photo, calibration and endpoints in the same process; returning to portrait preserves length')
    opened()
    if any(x.startswith('Length:') or x=='Confirm size' or x==PHOTO for x in labels()):raise RuntimeError('Process restart restored a sensitive workspace')
    done('Process restart restores no selected photo, calibration or measurement')
    action('Close measure');restart();top();select_after(heading,('Module access',));tap_node(next(n for n in nodes() if n.get('content-desc')=='Allow photo measurement' and n.get('checkable')=='true'));tap('Turn off');find('Allow photo measurement: off.')
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
    adb('shell','wm','size','reset')
    if original_font_scale=='null':adb('shell','settings','delete','system','font_scale')
    else:adb('shell','settings','put','system','font_scale',original_font_scale)
    adb('shell','settings','put','system','user_rotation','0')
    adb('shell','cmd','connectivity','airplane-mode','disable');adb('shell','svc','wifi','enable');adb('shell','svc','data','enable')
    (RESULTS/'measure-result.json').write_text(json.dumps(result,indent=2)+'\n')
