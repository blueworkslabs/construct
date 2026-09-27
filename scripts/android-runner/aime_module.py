#!/usr/bin/env python3
"""Aimé slice 1 acceptance on a disposable synthetic-camera emulator.

Synthetic Aimé (dev.construct.aime-fixture) proves the flow and the ranking on a
known scene: grants denied/granted, capture → viewpoint, injected landmark data
offline/HTTP 503 with a single retry, mark → calibrated ruler, horizon → level
line, dragging a horizon point and undoing it, tap → candidates → map, the map
ruler, rotation, 2× text, a viewpoint outside the data coverage, delete →
stored record reconciled.
The real Aimé package (dev.construct.aime) then proves the real location and
internet gates: location off → unlocated photo opens on the map; with an injected
emulator fix, the live aime-data cells return named landmarks.
Physical-phone accuracy is the pilot tester's viewpoint test, not claimed here.
"""
import argparse,datetime,fcntl,hashlib,json,os,re,subprocess,time,uuid
from pathlib import Path
from config import CONFIG,SERIAL,require_runner,catalog
p=argparse.ArgumentParser();p.add_argument('--apk',type=Path,required=True);p.add_argument('--sha',required=True)
p.add_argument('--catalog',required=True,help='HTTPS index with both packages from prepare_aime_fixture.py')
p.add_argument('--module-sha',required=True,help='dev.construct.aime package digest')
p.add_argument('--fixture-sha',required=True,help='dev.construct.aime-fixture package digest')
p.add_argument('--version',default='0.1.8')
p.add_argument('--real-fix',default='52.37648,9.73848',help='lat,lon injected for the real-module landmark data check (Hannover, inside the DE/AT coverage)')
a=p.parse_args();require_runner();catalog(a.catalog)
assert hashlib.sha256(a.apk.read_bytes()).hexdigest()==a.sha,'APK checksum mismatch'
lock=(CONFIG.root/'suite.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
assert subprocess.run(['systemctl','--user','is-active','--quiet',CONFIG.service]).returncode!=0,'Preserve running emulator'
assert not any(x.startswith(SERIAL+'\t') for x in subprocess.check_output([str(CONFIG.sdk/'platform-tools/adb'),'devices'],text=True).splitlines()),'Preserve occupied port'
run=CONFIG.root/'results'/(datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-aime-'+uuid.uuid4().hex[:8]);run.mkdir(parents=True)
os.environ['CONSTRUCT_RESULTS']=str(run)
import ui
from ui import adb,nodes,labels,tap,tap_node,find,capture as adb_capture
from keyboard_prompt import gboard_contacts_denial
from host_ui import host_ready,catalog_settings,apply_catalog,library,select_after,installed_status,diagnostics
from catalog_input import replace_text
receipt={'complete':False,'stopped':False,'apkSha256':a.sha,'moduleSha256':a.module_sha,'fixtureSha256':a.fixture_sha,'version':a.version,
 'scope':'Synthetic Aimé flow/ranking on a known scene plus real-module location/internet gates; not physical-phone accuracy','checks':[],'candidates':{}}
started=False
def nodes():
 current=ui.nodes();deny=gboard_contacts_denial(current)
 if deny is not None:
  print('Declining unrelated Gboard contacts/accounts prompt',flush=True)
  tap_node(deny);receipt.setdefault('systemInterruptions',[]).append('Gboard contacts/accounts permission declined');save()
  time.sleep(.5);current=ui.nodes()
 return current
def labels():
 return [n.get('text') or n.get('content-desc') for n in nodes() if n.get('text') or n.get('content-desc')]
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
def scroll(direction,distance=None):
 x1,y1,x2,y2=web();x=x1+6;lo=y1+(y2-y1)*3//10;hi=y1+(y2-y1)*4//5
 if distance is not None:lo=hi-max(24,min(hi-lo,round(distance)))
 adb('shell','input','swipe',str(x),str(hi if direction=='down' else lo),str(x),str(lo if direction=='down' else hi),'300');time.sleep(.35)
def reveal(match):
 """First visible node whose text satisfies match (a string prefix or predicate), scrolling the module page."""
 test=match if callable(match) else (lambda t:t.startswith(match))
 for direction in ('up','down'):
  for _ in range(10):
   viewport=web()
   hits=[n for n in nodes() if test(text_of(n)) and visible(n) and n.get('package')=='dev.construct.runtime' and bounds(n)[1]>=viewport[1] and bounds(n)[3]<=viewport[3]]
   if hits:
    # WebView's accessibility bounds can lag the end of a scroll/text-size reflow.
    before=bounds(hits[0]);time.sleep(.5)
    settled=[n for n in nodes() if test(text_of(n)) and visible(n) and bounds(n)==before]
    if settled:return settled[0]
   scroll(direction)
 raise RuntimeError('Module control not reachable: '+str(match))
def click(match):tap_node(reveal(match))
def reach_text(fragment):return text_of(reveal(lambda t:fragment in t))
def stage():
 """Bounds of the photo stage (role=img), scrolled fully into the WebView viewport."""
 label='Selected photo. Tap to mark'
 for direction in ('down','up'):
  for _ in range(10):
   correction=None
   s=next((n for n in nodes() if text_of(n).startswith(label) and visible(n)),None)
   if s is not None:
    b=bounds(s);w=web()
    # Accessibility clips image bounds to the viewport; being inside it
    # does not prove the whole image is visible. The fixture is 1024x768.
    full_image=not heading.startswith(FIXTURE) or abs((b[3]-b[1])-((b[2]-b[0]-2)*.75+2))<=5
    if b[1]>=w[1] and b[3]<=w[3] and full_image:
     time.sleep(.5)
     settled=next((n for n in nodes() if text_of(n).startswith(label) and bounds(n)==b),None)
     if settled is not None:return b
    direction='down' if b[3]>=w[3]-2 else 'up'
    if heading.startswith(FIXTURE):correction=max(24,(b[2]-b[0]-2)*.75+2-(b[3]-b[1])+8)
   scroll(direction,correction)
 raise RuntimeError('Photo stage not fully visible')
def tap_photo(point,checkpoint=None):
 x1,y1,x2,y2=stage()
 # The stage has a 1 px border around the photo frame.
 x=round(x1+1+point['x']*(x2-x1-2));y=round(y1+1+point['y']*(y2-y1-2))
 if checkpoint:
  capture('before-tap-'+checkpoint)
  (run/('before-tap-'+checkpoint+'-bounds.json')).write_text(json.dumps({'stage':[x1,y1,x2,y2],'tap':[x,y],'nodes':[dict(n.attrib) for n in nodes()]},indent=2))
 adb('shell','input','tap',str(x),str(y));time.sleep(.6)
def drag_photo(a,b,ms=700):
 """Press on photo point a and drag to b; the stage moves a mark or horizon point it starts on."""
 x1,y1,x2,y2=stage();px=lambda p:(round(x1+1+p['x']*(x2-x1-2)),round(y1+1+p['y']*(y2-y1-2)))
 (ax,ay),(bx,by)=px(a),px(b)
 adb('shell','input','swipe',str(ax),str(ay),str(bx),str(by),str(ms));time.sleep(.8)
def reach_native(label,checkable=False):
 for attempt in range(24):
  tree=nodes()
  viewport=next((bounds(n) for n in tree if n.get('class')=='android.widget.ScrollView'),[0,132,720,1244])
  matches=[n for n in tree if label in (n.get('text'),n.get('content-desc')) and n.get('package')=='dev.construct.runtime' and (not checkable or n.get('checkable')=='true') and visible(n) and bounds(n)[1]>=viewport[1] and bounds(n)[3]<=viewport[3]]
  if matches:
   before=bounds(matches[0]);time.sleep(.5)
   settled=[n for n in nodes() if label in (n.get('text'),n.get('content-desc')) and bounds(n)==before and (not checkable or n.get('checkable')=='true')]
   if settled:return settled[0]
  start,end=('450','1050') if attempt<8 else ('1000','500')
  adb('shell','input','swipe','360',start,'360',end,'250');time.sleep(.3)
 raise RuntimeError('Native control not reachable: '+label)
def switch(label,checked=True):
 for attempt in range(3):
  node=reach_native(label,checkable=True)
  if (node.get('checked')=='true')==checked:return
  print('Native grant tap:',label,bounds(node),'attempt',attempt+1,flush=True)
  tap_node(node)
  if not checked:tap('Turn off')
  until=time.monotonic()+4
  while time.monotonic()<until:
   if any(n.get('content-desc')==label and n.get('checkable')=='true' and n.get('checked')==('true' if checked else 'false') for n in nodes()):return
   time.sleep(.25)
 raise RuntimeError('Switch did not change: '+label)
def permission(button):
 tap_node(reach_native(button))
 end=time.monotonic()+20
 while time.monotonic()<end:
  if 'While using the app' in labels():tap('While using the app');return
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
 return [t for t in labels() if t and (t.startswith('Could be ') or re.match(r'^Synthetic .+ (peak|tower|mast|castle|church|chapel|monument|communication tower) · ',t))]
def what(point,expected,key):
 click(lambda t:t=='What’s that?');reach_text('Tap anything to see what it could be.')
 tap_photo(point,checkpoint=key);contains('Your tap points',20)
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

 # 3. Landmark data offline and HTTP 503: unavailable, never an empty list; one manual retry.
 # Nothing is downloaded before this step, so neither failure is served from the session cache.
 to_library();fixture('next data offline');open_first_photo()
 tap_photo(F['markA']);contains('[HTTP_UNAVAILABLE] Landmark data unavailable: the data host could not be reached');absent('landmarks within')
 capture('aime-offline');click(lambda t:t=='Cancel')
 to_library();fixture('next cell 503');open_first_photo()
 tap_photo(F['markA']);contains('[DATA_STATUS] Landmark data unavailable: the data host answered HTTP 503');absent('landmarks within');capture('aime-503')
 click(lambda t:t=='Retry');contains('8 landmarks within 30 km')
 done('Offline and HTTP 503 are shown as landmark data unavailable with a single retry, never as an empty result')

 # 4. Mark → calibrated ruler.
 click(lambda t:t.startswith('Synthetic Tower A'));reach_text('Calibrated · 1 mark');reach_text('Bearings along the middle row')
 capture('aime-calibrated');done('Marking a known landmark calibrates the bearing ruler')

 # 5. Horizon → level line.
 click('Level horizon');find('Tap two points');tap('Tap two points')
 tap_photo(F['horizon'][0]);reach_text('Horizon point saved');tap_photo(F['horizon'][1]);reach_text('Level estimated')
 capture('aime-levelled');done('Two true-level horizon taps level the picture (Level estimated)')

 # 5b. Drag a horizon point (stored once on release), then undo it.
 moved=dict(F['horizon'][0]);moved['y']=min(.95,moved['y']+.08)
 drag_photo(F['horizon'][0],moved);reach_text('Horizon point 1 moved');capture('aime-dragged')
 click(lambda t:t=='Undo moving horizon point 1');reach_text('Undone: moving horizon point 1');reach_text('Level estimated')
 done('Dragging a horizon point moves it; Undo restores it and the level fit')

 # 6. What's that? → candidates with own ±σ → map.
 reveal('What’s that?');rows=what(F['whatB'],'Synthetic Peak B','B')
 assert any('±' in r and 'from your tap' in r for r in labels() if r),'Candidates need offset and ±σ'
 capture('aime-candidates');click(lambda t:t.startswith('Could be Synthetic Peak B'))
 reach_text('Pin 1: Synthetic Peak B (selected)');reach_text('Wedge: your tap points');reach_text('Green pin: Synthetic Tower A')
 reveal('Map of your viewpoint');time.sleep(3);capture('aime-map');done('Tap ranks the known landmark first; a candidate opens the map with wedge, pins and viewer')
 click(lambda t:t=='Ruler');reach_text('Ruler: tap two points on the map')
 m=bounds(reveal('Map of your viewpoint'))
 for fx,fy in ((.3,.3),(.7,.7)):adb('shell','input','tap',str(round(m[0]+(m[2]-m[0])*fx)),str(round(m[1]+(m[3]-m[1])*fy)));time.sleep(.6)
 reach_text(', initial bearing ');capture('aime-ruler')
 click(lambda t:t=='Clear ruler');click(lambda t:t=='Ruler');absent(', initial bearing ')
 done('Map ruler: two taps show the great-circle distance and initial bearing; it clears')
 click(lambda t:t=='Photo')

 # Persisted calibration must survive a real process restart on this exact host.
 adb('shell','am','force-stop','dev.construct.runtime');open_module(FIXTURE);open_first_photo()
 reach_text('Calibrated · 1 mark');reach_text('Level estimated');reveal('What’s that?')
 what(F['whatB'],'Synthetic Peak B','B-restart');click(lambda t:t=='Close')
 done('Photo viewpoint, landmark and horizon calibration survive process restart with the same ranking')

 # 7. Rotation and 2× text keep the flow usable.
 settle('1');capture('aime-landscape');reveal('What’s that?');what(F['whatB'],'Synthetic Peak B','B-landscape');click(lambda t:t=='Close')
 settle('0');done('Landscape keeps the photo tappable and the ranking unchanged')
 adb('shell','settings','put','system','font_scale','2.0');time.sleep(3)
 reveal('Mark landmark');reveal('Delete this photo');capture('aime-large-text');reveal('What’s that?');what(F['whatB'],'Synthetic Peak B','B-large-text');click(lambda t:t=='Close')
 adb('shell','settings','put','system','font_scale','1.0');time.sleep(2);done('Two-times text keeps controls reachable and the ranking unchanged')

 # 8. A viewpoint outside the data coverage is a named state, not a failure or an empty list.
 to_library();fixture('toggle outside coverage');contains('Viewpoint: outside coverage')
 shoot();contains('Estimated viewpoint',60);tap_photo({'x':.5,'y':.5})
 contains('No landmark data here yet. Germany and Austria for now.');absent('landmarks within');absent('Landmark data unavailable')
 assert not any(t=='Retry' for t in labels()),'Outside coverage offers no retry'
 capture('aime-outside-coverage');click(lambda t:t=='Cancel')
 to_library();fixture('toggle outside coverage');contains('Viewpoint: synthetic scene')
 done('A viewpoint outside the coverage says so, without a retry or an empty list')

 # 9. Delete → stored record reconciled.
 fixture('count stored records');contains('Stored photo records: 2')
 click(lambda t:t.startswith('Photo 2.'));contains('viewpoint',20)
 click('Delete this photo');find('Delete this private photo?');capture('aime-trusted-delete');tap('Delete photo')
 contains('Photo deleted.');fixture('count stored records');contains('Stored photo records: 1')
 done('Native-confirmed deletion removes the photo and its stored record')

 # 10. Real Aimé: location and internet gates on the real host path.
 tap('Construct menu');tap('Mark working');install(REAL,a.module_sha)
 open_module(REAL);module_access()
 for label in ['Allow taking private photos','Allow this module’s private photo library','Allow selected image pixels']:switch(label,True)
 reopen();shoot();contains('No usable viewpoint for this photo',60);reach_text('Set your viewpoint: tap the map')
 reach_text('Map tiles need internet access');capture('aime-real-unlocated')
 done('Real module with location off: the photo stays unlocated and opens on the map; the internet gate is named')
 lat,lon=a.real_fix.split(',')
 module_access()
 for label in ['Allow reading phone location','Allow approved internet sources']:switch(label,True)
 permission('Allow Android location access');reopen()
 adb('shell','cmd','location','set-location-enabled','true')
 for _ in range(3):adb('emu','geo','fix',lon,lat);time.sleep(1)
 to_library();shoot();contains('Estimated viewpoint',60)
 click('Mark landmark');tap_photo({'x':.5,'y':.5})
 # The loading sentence also contains "landmarks within 30 km". Only a
 # completed count is success; wait for it rather than matching that fragment.
 found=None
 for request in range(2):
  error=None
  until=time.monotonic()+45
  while time.monotonic()<until:
   text=labels()
   found=next((t for t in text if t and re.match(r'^[1-9]\d* landmarks within 30 km',t)),None)
   if found:break
   error=next((t for t in text if t and (t.startswith('No landmark data here yet') or re.search(r'\[(?:DATA_|HTTP_|CAPABILITY_|LOCATION_)[A-Z_]*\]',t))),None)
   if error:break
   time.sleep(.5)
  if found:break
  if request==0 and error and any(t=='Retry' for t in labels()) and ('[DATA_' in error or '[HTTP_' in error):
   receipt['realLandmarksRetryReason']=error;save();capture('aime-real-landmarks-retry')
   time.sleep(10);click(lambda t:t=='Retry')
  else:raise RuntimeError('Real landmark lookup did not complete: '+str(error))
 assert found,'No named landmarks after bounded retry'
 receipt['realLandmarks']=found;receipt['realLandmarksAttempts']=request+1;save()
 capture('aime-real-landmarks');click(lambda t:t=='Cancel')
 done('Real module: injected fix → estimated viewpoint → live aime-data cells return named landmarks')
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
