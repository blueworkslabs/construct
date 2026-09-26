#!/usr/bin/env python3
"""Aimé slice 1 acceptance on a disposable synthetic-camera emulator.

Synthetic Aimé (dev.construct.aime-fixture) proves the flow and the ranking on a
known scene: grants denied/granted, capture → viewpoint, injected Overpass
offline/429 with a single retry, mark → calibrated ruler, horizon → level line,
tap → candidates → map, rotation, 2× text, delete → stored record reconciled.
The real Aimé package (dev.construct.aime) then proves the real location and
internet gates: location off → unlocated photo opens on the map; with an injected
emulator fix, one real Overpass request returns named landmarks.
Physical-phone accuracy is the pilot tester's viewpoint test, not claimed here.
"""
import argparse,datetime,fcntl,hashlib,json,os,re,subprocess,time,uuid
from pathlib import Path
from config import CONFIG,SERIAL,require_runner,catalog
p=argparse.ArgumentParser();p.add_argument('--apk',type=Path,required=True);p.add_argument('--sha',required=True)
p.add_argument('--catalog',required=True,help='HTTPS index with both packages from prepare_aime_fixture.py')
p.add_argument('--module-sha',required=True,help='dev.construct.aime package digest')
p.add_argument('--fixture-sha',required=True,help='dev.construct.aime-fixture package digest')
p.add_argument('--version',default='0.1.0')
p.add_argument('--real-fix',default='47.34953,8.49154',help='lat,lon injected for the real-module Overpass check (public viewpoint)')
a=p.parse_args();require_runner();catalog(a.catalog)
assert hashlib.sha256(a.apk.read_bytes()).hexdigest()==a.sha,'APK checksum mismatch'
lock=(CONFIG.root/'suite.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
assert subprocess.run(['systemctl','--user','is-active','--quiet',CONFIG.service]).returncode!=0,'Preserve running emulator'
assert not any(x.startswith(SERIAL+'\t') for x in subprocess.check_output([str(CONFIG.sdk/'platform-tools/adb'),'devices'],text=True).splitlines()),'Preserve occupied port'
run=CONFIG.root/'results'/(datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-aime-'+uuid.uuid4().hex[:8]);run.mkdir(parents=True)
os.environ['CONSTRUCT_RESULTS']=str(run)
import ui
from ui import adb,nodes,labels,tap,tap_node,find,capture as adb_capture
from host_ui import host_ready,catalog_settings,apply_catalog,library,select_after,installed_status,diagnostics
from catalog_input import replace_text
receipt={'complete':False,'stopped':False,'apkSha256':a.sha,'moduleSha256':a.module_sha,'fixtureSha256':a.fixture_sha,'version':a.version,
 'scope':'Synthetic Aimé flow/ranking on a known scene plus real-module location/internet gates; not physical-phone accuracy','checks':[],'candidates':{}}
started=False
FIXTURE='Synthetic Aimé';REAL='Aimé';heading=FIXTURE+' · '+a.version
def save():(run/'result.json').write_text(json.dumps(receipt,indent=2,ensure_ascii=False)+'\n')
def done(text):receipt['checks'].append(text);save();print('PASS:',text,flush=True)
def capture(name):
 # FLAG_SECURE blacks out ADB screenshots; the emulator console captures the synthetic display.
 adb_capture(name);target=run/(name+'-display');target.mkdir()
 adb('emu','screenrecord','screenshot',str(target))
 assert len(list(target.glob('*.png')))==1,'Missing synthetic console capture'
def bounds(n):return list(map(int,re.findall(r'-?\d+',n.get('bounds',''))))
def visible(n):
 b=bounds(n);return len(b)==4 and b[2]>b[0] and b[3]-b[1]>=8
def text_of(n):return (n.get('text') or n.get('content-desc') or '')
def contains(fragment,timeout=35):
 end=time.monotonic()+timeout
 while time.monotonic()<end:
  value=next((x for x in labels() if x and fragment in x),None)
  if value is not None:return value
  time.sleep(.4)
 raise RuntimeError('Expected text missing: '+fragment)
def absent(fragment):
 assert not any(fragment in (x or '') for x in labels()),'Unexpected text: '+fragment
def web():
 w=next((n for n in nodes() if n.get('class')=='android.webkit.WebView' and visible(n)),None)
 if w is None:raise RuntimeError('No module WebView')
 return bounds(w)
def scroll(direction):
 x1,y1,x2,y2=web();x=x1+6;lo=y1+(y2-y1)*3//10;hi=y1+(y2-y1)*4//5
 adb('shell','input','swipe',str(x),str(hi if direction=='down' else lo),str(x),str(lo if direction=='down' else hi),'300');time.sleep(.35)
def reveal(match):
 """First visible node whose text satisfies match (a string prefix or predicate), scrolling the module page."""
 test=match if callable(match) else (lambda t:t.startswith(match))
 for direction in ('up','down'):
  for _ in range(10):
   hits=[n for n in nodes() if test(text_of(n)) and visible(n) and n.get('package')=='dev.construct.runtime']
   if hits:return hits[0]
   scroll(direction)
 raise RuntimeError('Module control not reachable: '+str(match))
def click(match):tap_node(reveal(match))
def stage():
 """Bounds of the photo stage (role=img), scrolled fully into the WebView viewport."""
 label='Selected photo. Tap to mark'
 for direction in ('down','up'):
  for _ in range(10):
   s=next((n for n in nodes() if text_of(n).startswith(label) and visible(n)),None)
   if s is not None:
    b=bounds(s);w=web()
    if b[1]>=w[1] and b[3]<=w[3]:return b
    direction='down' if b[3]>w[3] else 'up'
   scroll(direction)
 raise RuntimeError('Photo stage not fully visible')
def tap_photo(point):
 x1,y1,x2,y2=stage()
 # The stage has a 1 px border around the photo frame.
 x=round(x1+1+point['x']*(x2-x1-2));y=round(y1+1+point['y']*(y2-y1-2))
 adb('shell','input','tap',str(x),str(y));time.sleep(.6)
def reach_native(label):
 for attempt in range(24):
  matches=[n for n in nodes() if label in (n.get('text'),n.get('content-desc')) and n.get('package')=='dev.construct.runtime']
  if matches:return matches[0]
  start,end=('450','1050') if attempt<8 else ('1000','500')
  adb('shell','input','swipe','360',start,'360',end,'250');time.sleep(.3)
 raise RuntimeError('Native control not reachable: '+label)
def switch(label,checked=True):
 for _ in range(14):
  matches=[n for n in nodes() if n.get('content-desc')==label and n.get('checkable')=='true']
  if matches:break
  adb('shell','input','swipe','360','1000','360','500','250');time.sleep(.3)
 assert len(matches)==1,'Missing switch: '+label
 if (matches[0].get('checked')=='true')==checked:return
 tap_node(matches[0])
 if not checked:tap('Turn off')
 until=time.monotonic()+10
 while time.monotonic()<until:
  if any(n.get('content-desc')==label and n.get('checkable')=='true' and n.get('checked')==('true' if checked else 'false') for n in nodes()):return
  time.sleep(.25)
 raise RuntimeError('Switch did not change: '+label)
def permission(button):
 tap_node(reach_native(button))
 end=time.monotonic()+20
 while time.monotonic()<end:
  for choice in ('While using the app','Only this time'):
   if choice in labels():tap(choice);return
  time.sleep(.3)
 raise RuntimeError('Android permission choices missing for '+button)
def launch():adb('shell','am','start','-n','dev.construct.runtime/.MainActivity');host_ready()
def open_module(name):
 global heading
 heading=name+' · '+a.version
 launch();library();select_after(heading,('Open',));find('Take photo')
def module_access():tap('Construct menu');tap('Module access');find('Module access')
def reopen():tap_node(reach_native('Reopen module'));find('Take photo')
def install(name,digest):
 library();select_after(name+' · '+a.version,('Review & install',));tap('Allow & install');installed_status()
 assert any(e.get('code')=='INSTALLED_TRIAL' and e.get('packageDigest')==digest for e in diagnostics()),'Wrong signed module '+name
def shoot():
 click('Take photo');end=time.monotonic()+60
 while time.monotonic()<end and not any((t or '').startswith('Camera preview ready.') for t in labels()):time.sleep(.3)
 capture_native_shutter()
def capture_native_shutter():
 # The native viewfinder's shutter; the module WebView is behind the capture activity.
 tap('Take photo')
def to_library():
 if not any(x=='Take photo' for x in labels()):click(lambda t:t=='Photos')
 contains('Take photo')
def open_first_photo():click(lambda t:t.startswith('Photo 1.'));contains('viewpoint',20)
def fixture(action):click('Fixture: '+action)
def candidates():
 return [t for t in labels() if t and (t.startswith('Could be ') or re.match(r'^Synthetic .+ (peak|tower|mast|castle|church|chapel|airfield|viewpoint) · ',t))]
def what(point,expected,key):
 tap_photo(point);contains('Your tap points',20)
 rows=candidates();receipt['candidates'][key]=rows;save()
 first=next((r for r in labels() if r and r.startswith('Could be ')),None)
 assert first and first.startswith('Could be '+expected),('Ranking',key,rows)
 return rows
def settle(rotation):
 adb('shell','settings','put','system','user_rotation',rotation);time.sleep(3)
 w=web();assert (w[2]-w[0]>w[3]-w[1])==(rotation=='1'),'Rotation not applied'

try:
 print('RESULTS:',run,flush=True);save();(CONFIG.root/'camera-emulated.flag').write_text('emulated\n')
 avd,snapshot,_=CONFIG.profile(True);started=True
 subprocess.run([str(CONFIG.root/'runner.sh'),'start'],check=True)
 deadline=time.monotonic()+180
 while time.monotonic()<deadline:
  try:
   if adb('shell','getprop','sys.boot_completed',timeout=10).strip()=='1':break
  except (subprocess.CalledProcessError,subprocess.TimeoutExpired):pass
  time.sleep(2)
 else:raise RuntimeError('Boot timeout')
 invocation=subprocess.check_output(['systemctl','--user','show',CONFIG.service,'-p','InvocationID','--value'],text=True).strip()
 startup=subprocess.check_output(['journalctl','--user','_SYSTEMD_INVOCATION_ID='+invocation,'--no-pager'],text=True)
 (run/'startup.log').write_text(startup);assert "Successfully loaded snapshot '"+snapshot+"'" in startup,'No clean snapshot evidence'
 pid=subprocess.check_output(['systemctl','--user','show',CONFIG.service,'-p','MainPID','--value'],text=True).strip()
 cmd=Path('/proc/'+pid+'/cmdline').read_bytes().decode().split('\0')
 for k,v in [('-avd',avd),('-camera-back','emulated'),('-camera-front',CONFIG.front_camera(True))]:assert k in cmd and cmd[cmd.index(k)+1]==v,'Camera not synthetic-only'
 assert 'package:dev.construct.runtime' not in adb('shell','pm','list','packages','dev.construct.runtime'),'Snapshot not app-free'
 receipt['snapshot']={'avd':avd,'name':snapshot,'loaded':True};receipt['apiLevel']=adb('shell','getprop','ro.build.version.sdk').strip()
 adb('shell','settings','put','system','accelerometer_rotation','0');adb('shell','settings','put','system','font_scale','1.0')
 adb('logcat','-c');adb('install',str(a.apk.resolve()),timeout=120)
 receipt['webView']=adb('shell','dumpsys','webviewupdate').strip()
 launch();catalog_settings()
 replace_text(nodes,lambda v:ui._device(className='android.widget.EditText',packageName='dev.construct.runtime').set_text(v),a.catalog)
 apply_catalog();find('Catalog refreshed.')
 install(FIXTURE,a.fixture_sha)

 # 1. Fresh grants are off: nothing is listed or captured.
 open_module(FIXTURE);contains('[CAPABILITY_DENIED]')
 click('Take photo');contains('[CAPABILITY_DENIED] Photo library access is off')
 note=contains('Synthetic fixture. Mark Synthetic Tower A at ')
 m=re.search(r'at (\d+) % across, (\d+) % down; horizon at (\d+) % across, (\d+) % down and (\d+) % across, (\d+) % down; B at (\d+) % across, (\d+) % down',note)
 assert m,note
 v=[int(x)/100 for x in m.groups()]
 # The printed targets are rounded; the node-side test pins the exact values.
 F={'markA':{'x':v[0],'y':v[1]},'horizon':[{'x':v[2],'y':v[3]},{'x':v[4],'y':v[5]}],'whatB':{'x':v[6],'y':v[7]}}
 receipt['targets']=F;capture('aime-denied');done('Fresh install: library and capture are denied until the new grants are on')
 module_access()
 for label in ['Allow taking private photos','Allow this module’s private photo library','Allow selected image pixels','Allow approved internet sources']:switch(label,True)
 permission('Allow Android camera access');reopen()
 done('Grants and Android camera permission enabled through native Module access')

 # 2. Capture → estimated viewpoint saved with the photo (second fix after the 15 s spacing).
 shoot();contains('Estimated viewpoint · ±10 m',60);capture('aime-captured')
 done('Real shutter capture opens the photo with its estimated viewpoint')

 # 3. Overpass offline and 429: named, never an empty list; one manual retry.
 to_library();fixture('next Overpass offline');open_first_photo()
 tap_photo(F['markA']);contains('[HTTP_UNAVAILABLE] Overpass could not be reached');absent('landmarks within')
 capture('aime-offline');click(lambda t:t=='Cancel')
 to_library();fixture('next Overpass 429');open_first_photo()
 tap_photo(F['markA']);contains('[OVERPASS_BUSY] Overpass is busy (429)');absent('landmarks within');capture('aime-429')
 click(lambda t:t=='Retry');contains('8 landmarks within 30 km')
 done('Offline and 429 are shown as such with a single retry, never as an empty result')

 # 4. Mark → calibrated ruler.
 click(lambda t:t.startswith('Synthetic Tower A'));contains('Calibrated · 1 mark');contains('Bearings along the middle row')
 capture('aime-calibrated');done('Marking a known landmark calibrates the bearing ruler')

 # 5. Horizon → level line.
 click('Level horizon');find('Tap two points');tap('Tap two points')
 tap_photo(F['horizon'][0]);contains('Horizon point saved');tap_photo(F['horizon'][1]);contains('Level estimated')
 capture('aime-levelled');done('Two true-level horizon taps level the picture (Level estimated)')

 # 6. What's that? → candidates with own ±σ → map.
 click('What’s that?');rows=what(F['whatB'],'Synthetic Peak B','B')
 assert any('±' in r and 'from your tap' in r for r in labels() if r),'Candidates need offset and ±σ'
 capture('aime-candidates');click(lambda t:t.startswith('Could be Synthetic Peak B'))
 contains('Pin 1: Synthetic Peak B (selected)');contains('Wedge: your tap points');contains('Green pin: Synthetic Tower A')
 time.sleep(3);capture('aime-map');done('Tap ranks the known landmark first; a candidate opens the map with wedge, pins and viewer')
 click(lambda t:t=='Photo')

 # 7. Rotation and 2× text keep the flow usable.
 settle('1');capture('aime-landscape');click('What’s that?');what(F['whatB'],'Synthetic Peak B','B-landscape');click(lambda t:t=='Close')
 settle('0');done('Landscape keeps the photo tappable and the ranking unchanged')
 adb('shell','settings','put','system','font_scale','2.0');time.sleep(3)
 reveal('Mark landmark');reveal('Delete this photo');capture('aime-large-text');click('What’s that?');what(F['whatB'],'Synthetic Peak B','B-large-text');click(lambda t:t=='Close')
 adb('shell','settings','put','system','font_scale','1.0');time.sleep(2);done('Two-times text keeps controls reachable and the ranking unchanged')

 # 8. Delete → stored record reconciled.
 to_library();shoot();contains('Estimated viewpoint',60);to_library()
 fixture('count stored records');contains('Stored photo records: 2')
 click(lambda t:t.startswith('Photo 2.'));contains('viewpoint',20)
 click('Delete this photo');find('Delete this private photo?');capture('aime-trusted-delete');tap('Delete photo')
 contains('Photo deleted.');fixture('count stored records');contains('Stored photo records: 1')
 done('Native-confirmed deletion removes the photo and its stored record')

 # 9. Real Aimé: location and internet gates on the real host path.
 tap('Construct menu');tap('Mark working');install(REAL,a.module_sha)
 open_module(REAL);module_access()
 for label in ['Allow taking private photos','Allow this module’s private photo library','Allow selected image pixels']:switch(label,True)
 reopen();shoot();contains('No usable viewpoint for this photo',60);contains('Set your viewpoint: tap the map')
 contains('Map tiles need internet access');capture('aime-real-unlocated')
 done('Real module with location off: the photo stays unlocated and opens on the map; the internet gate is named')
 lat,lon=a.real_fix.split(',')
 module_access()
 for label in ['Allow reading phone location','Allow approved internet sources']:switch(label,True)
 permission('Allow Android location access');reopen()
 adb('shell','cmd','location','set-location-enabled','true')
 for _ in range(3):adb('emu','geo','fix',lon,lat);time.sleep(1)
 to_library();shoot();contains('Estimated viewpoint',60)
 click('Mark landmark');tap_photo({'x':.5,'y':.5})
 found=contains('landmarks within 30 km',40);receipt['realOverpass']=found;save()
 assert re.match(r'^[1-9]\d* landmarks within 30 km',found),found
 capture('aime-real-overpass');click(lambda t:t=='Cancel')
 done('Real module: injected fix → estimated viewpoint → one real Overpass request returns named landmarks')
 receipt['complete']=True
except Exception as e:
 receipt['error']=str(e)
 try:(run/'failure-nodes.json').write_text(json.dumps([dict(n.attrib) for n in nodes()],indent=2));capture('failure')
 except Exception:pass
 raise
finally:
 if started:
  try:
   adb('shell','settings','put','system','font_scale','1.0');adb('shell','settings','put','system','user_rotation','0')
   (run/'runtime.log').write_text(adb('logcat','-d','-t','6000'));(run/'crash-buffer.txt').write_text(adb('logcat','-b','crash','-d'))
  except Exception:pass
  subprocess.run([str(CONFIG.root/'runner.sh'),'stop'],check=True);receipt['stopped']=subprocess.run(['systemctl','--user','is-active','--quiet',CONFIG.service]).returncode!=0
 (CONFIG.root/'camera-emulated.flag').unlink(missing_ok=True);save();print(json.dumps(receipt,indent=2,ensure_ascii=False),flush=True)
