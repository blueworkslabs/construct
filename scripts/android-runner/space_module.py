#!/usr/bin/env python3
"""Standalone Space Watch acceptance on the explicitly disposable emulator.

Synthetic wrapper tests UI only; the real package tests authority and providers.
Screenshots need human review; hardware spotting accuracy is not claimed.
"""
import argparse,datetime,fcntl,hashlib,json,math,os,re,subprocess,time,uuid
from pathlib import Path
from config import CONFIG,SERIAL,require_runner,catalog
p=argparse.ArgumentParser();p.add_argument('--apk',type=Path,required=True);p.add_argument('--sha',required=True)
p.add_argument('--catalog',required=True,help='HTTPS index with both packages from prepare_space_fixture.py')
p.add_argument('--module-sha',required=True,help='dev.construct.space-watch package digest')
p.add_argument('--fixture-sha',required=True,help='dev.construct.space-watch-fixture package digest')
p.add_argument('--version',default='0.5.0')
p.add_argument('--previous-module-sha',help='Exact 0.4.1 real package in the same catalog, required for 0.5+ update-consent coverage')
p.add_argument('--follow',action='store_true',help='Enable Follow checks for older versions; mandatory automatically for 0.3.0+')
p.add_argument('--pointing-layout-only',action='store_true',help='Focused same-package visual evidence only; not full acceptance')
a=p.parse_args()
# Follow is mandatory for the feature version, even when the flag is omitted.
a.follow = a.pointing_layout_only or a.follow or tuple(map(int, a.version.split('.'))) >= (0, 3, 0)
a.layers = tuple(map(int, a.version.split('.'))) >= (0, 5, 0)
if a.layers and not a.pointing_layout_only:
 assert a.previous_module_sha and re.fullmatch(r'[a-f0-9]{64}',a.previous_module_sha),'0.5+ needs the previous exact module for update consent'
require_runner();catalog(a.catalog)
assert hashlib.sha256(a.apk.read_bytes()).hexdigest()==a.sha,'APK checksum mismatch'
lock=(CONFIG.root/'suite.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
assert subprocess.run(['systemctl','--user','is-active','--quiet',CONFIG.service]).returncode!=0,'Preserve running emulator'
assert not any(x.startswith(SERIAL+'\t') for x in subprocess.check_output([str(CONFIG.sdk/'platform-tools/adb'),'devices'],text=True).splitlines()),'Preserve occupied port'
run=CONFIG.root/'results'/(datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-space-'+uuid.uuid4().hex[:8]);run.mkdir(parents=True)
os.environ['CONSTRUCT_RESULTS']=str(run)
import ui
from ui import adb,nodes,labels,tap,tap_node,find,capture as adb_capture
from keyboard_prompt import gboard_contacts_denial
from host_ui import host_ready,catalog_settings,apply_catalog,library,select_after,installed_status,diagnostics
from catalog_input import replace_text
from space_checks import scroll_signature,visible_point_guidance
receipt={'complete':False,'stopped':False,'apkSha256':a.sha,'moduleSha256':a.module_sha,'fixtureSha256':a.fixture_sha,'version':a.version,
 'scope':'Synthetic Space Watch UI plus real-module native grants and live providers; not physical-phone spotting accuracy','checks':[],'candidates':{},'plannedChecks':3 if a.pointing_layout_only else ((31 if a.layers else 25) if a.follow else 16),'followRequired':a.follow,'pointingLayoutOnly':a.pointing_layout_only,'previousModuleSha256':a.previous_module_sha}
if a.pointing_layout_only:receipt['scope']='Focused pointing layout and native grant checks only; not full module acceptance'
started=False
def nodes():
 current=ui.nodes();deny=gboard_contacts_denial(current)
 if deny is not None:
  print('Declining unrelated Gboard contacts/accounts prompt',flush=True)
  tap_node(deny);receipt.setdefault('systemInterruptions',[]).append('Gboard contacts/accounts permission declined');save()
  time.sleep(.5);current=ui.nodes()
 return current
def tap(text):
 try:
  return ui.tap(text)
 except RuntimeError as e:
  if text != 'Construct menu' or str(e) != 'Unstable UI target: Construct menu':raise
  # No click was issued by ui.tap in this failure case. Freshly locate only
  # the trusted native menu button; subsequent native-menu assertions verify it.
  n=next((n for n in nodes() if n.get('content-desc')=='Construct menu' and
          n.get('class')=='android.widget.Button' and n.get('package')=='dev.construct.runtime' and
          n.get('enabled')=='true' and visible(n)),None)
  if n is None:raise
  tap_node(n);receipt.setdefault('driverNotes',[]).append('Native menu tapped at freshly resolved bounds after stability wait');save()
def labels():
 return [n.get('text') or n.get('content-desc') for n in nodes() if n.get('text') or n.get('content-desc')]
FIXTURE='Synthetic Space Watch';REAL='Space Watch';heading=FIXTURE+' · '+a.version
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
 end=time.monotonic()+10
 while time.monotonic()<end:
  w=next((n for n in nodes() if n.get('class')=='android.webkit.WebView' and visible(n)),None)
  if w is not None:return bounds(w)
  time.sleep(.2)
 raise RuntimeError('No module WebView after native transition settled')
def scroll(direction,distance=None):
 dialogs=[n for n in nodes() if n.get('class')=='android.app.AlertDialog' and visible(n)]
 # Short padding gestures avoid text-selection/long-press interception on
 # the busy emulator. Keep the touch-down away from a range control.
 x1,y1,x2,y2=bounds(dialogs[-1]) if dialogs else web();x=min(x1+72,x2-24);lo=y1+(y2-y1)*3//10;hi=y1+(y2-y1)*4//5
 if distance is not None:lo=hi-max(24,min(hi-lo,round(distance)))
 start=hi if direction=='down' else lo;end=lo if direction=='down' else hi
 for n in nodes():
  if n.get('class')=='android.widget.SeekBar' and visible(n):
   b=bounds(n)
   if b[0]<=x<=b[2] and b[1]-12<=start<=b[3]+12:
    start=max(y1+30,b[1]-30) if direction=='down' else min(y2-30,b[3]+30)
 ui._device.swipe(x,start,x,end,duration=.08);time.sleep(.8)
def reveal(match,directions=('up','down')):
 """First visible node whose text satisfies match (a string prefix or predicate), scrolling the module page."""
 test=match if callable(match) else (lambda t:t.startswith(match))
 deadline=time.monotonic()+60
 for direction in directions:
  for _ in range(24):
   if time.monotonic()>deadline:raise RuntimeError('Module control scroll timed out: '+str(match))
   viewport=web()
   hits=[n for n in nodes() if test(text_of(n)) and visible(n) and n.get('package')=='dev.construct.runtime' and bounds(n)[1]>=viewport[1] and bounds(n)[3]<=viewport[3]]
   if hits:
    # WebView's accessibility bounds can lag the end of a scroll/text-size reflow.
    before=bounds(hits[0]);time.sleep(.5)
    settled=[n for n in nodes() if test(text_of(n)) and visible(n) and bounds(n)==before]
    if settled:return settled[0]
   # Detect an actual scroll boundary instead of swiping upward 24 times at
   # the top of the page. Named-control geometry ignores live sky text.
   before=scroll_signature(nodes())
   scroll(direction)
   after=scroll_signature(nodes())
   if before==after:
    # Accessibility geometry can lag a completed gesture. A single unchanged
    # dump is not a boundary: retry the same gesture once and let layout settle.
    time.sleep(.5);scroll(direction)
    if before==scroll_signature(nodes()):break
 raise RuntimeError('Module control not reachable: '+str(match))
def click(match,directions=('up','down')):tap_node(reveal(match,directions))
def reach_text(fragment):return text_of(reveal(lambda t:fragment in t))
def wiki_credit():
 contains('Wikipedia loaded',45)
 # WebView exposes long dialog text beyond the clipped scroller. Move the
 # dialog body itself to the attribution before taking visual evidence.
 for _ in range(3):
  x1,y1,x2,y2=web();x=(x1+x2)//2
  adb('shell','input','swipe',str(x),str(y1+(y2-y1)*3//4),str(x),str(y1+(y2-y1)//3),'350')
  time.sleep(.3)
 reach_text('CC BY-SA 4.0')
def full_dome(prefix="Sky dome:"):
 # Position the canvas directly. A sticky landscape canvas does not require
 # the page title to be reachable, and its clipped edge gives the direction.
 print('POSITION canvas:',prefix,flush=True)
 for attempt in range(18):
  c=next((n for n in nodes() if text_of(n).startswith(prefix) and visible(n)),None)
  if c is None:
   reveal(lambda t:t.startswith(prefix));continue
  b=bounds(c);w=web();size=b[2]-b[0]
  if abs(size-(b[3]-b[1]))<=6 and b[1]>=w[1] and b[3]<=w[3]:return c
  direction='up' if b[1]<=w[1]+2 else 'down'
  print('POSITION canvas bounds:',b,'viewport:',w,'scroll:',direction,flush=True)
  scroll(direction,180)
 raise RuntimeError('Whole square dome not visible after positioning')
def center_point_guidance():
 # WebView can report clipped text bounds as a complete accessible node. Keep
 # the full visual instruction away from both viewport edges before capture.
 for _ in range(6):
  n=reveal(lambda t:visible_point_guidance(t) or t=='The selected object is below your horizon now.',directions=('down','up'));b=bounds(n);w=web()
  if b[1]>=w[1]+24 and b[3]<=w[3]-24:return text_of(n)
  scroll('down' if b[3]>w[3]-24 else 'up',260)
 raise RuntimeError('Pointing instruction not centred for visual evidence')
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
  if not checked:
   time.sleep(.3)
   if 'Turn off' in labels():tap('Turn off')
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
def open_module(name,version=None):
 global heading
 heading=name+' · '+(version or a.version)
 launch();library();select_after(heading,('Open',));contains('Space Watch')
def module_access():tap('Construct menu');tap('Module access');find('Module access')
def reopen():tap_node(reach_native('Reopen module'));contains('Space Watch')
def install(name,digest,version=None,expanded=False):
 library();select_after(name+' · '+(version or a.version),('Review & install',))
 if expanded:
  n=reach_native('Allow approved internet sources',checkable=True)
  assert n.get('checked')=='false','Expanded origins must require fresh approval'
  capture('space-expanded-consent-off')
 tap('Allow & install');installed_status()
 assert any(e.get('code')=='INSTALLED_TRIAL' and e.get('packageDigest')==digest for e in diagnostics()),'Wrong signed module '+name
def inject(acc,mag):
 adb('emu','sensor','set','gyroscope','0:0:0')
 adb('emu','sensor','set','acceleration',acc)
 adb('emu','sensor','set','magnetic-field',mag)
def inject_point(az,el,roll=0):
 # Independent physical ENU basis -> Android device sensor inputs. Portrait
 # device axes are right, up, and out of the screen; camera looks along -Z.
 a,e,r=map(math.radians,(az,el,roll))
 right=(math.cos(a),-math.sin(a),0)
 up=(-math.sin(e)*math.sin(a),-math.sin(e)*math.cos(a),math.cos(e))
 z=(-math.cos(e)*math.sin(a),-math.cos(e)*math.cos(a),-math.sin(e))
 x=tuple(right[i]*math.cos(r)-up[i]*math.sin(r) for i in range(3))
 y=tuple(right[i]*math.sin(r)+up[i]*math.cos(r) for i in range(3))
 acc=':'.join(str(9.80665*v[2]) for v in (x,y,z))
 mag=':'.join(str(50*v[1]-20*v[2]) for v in (x,y,z))
 inject(acc,mag)
 receipt.setdefault('pointingInputs',[]).append({'magneticAz':az,'elevation':el,'roll':roll});save()
def follow_sensors(label,expected):
 from orientation_checks import active_connections
 uid=int(re.search(r'uid:(\d+)',adb('shell','pm','list','packages','-U','dev.construct.runtime')).group(1))
 started=time.monotonic();deadline=started+3
 while True:
  raw=adb('shell','dumpsys','sensorservice');value=active_connections(raw,uid)
  if value==expected or time.monotonic()>=deadline:break
  time.sleep(.1)
 (run/('sensors-'+label+'.txt')).write_text(raw)
 receipt.setdefault('followNativeConnections',{})[label]=value
 receipt.setdefault('followListenerWaitSeconds',{})[label]=round(time.monotonic()-started,3);save()
 assert value==expected,('Follow listeners',label,value,expected)
def follow_focus_lost():
 from orientation_checks import resumed_unfocused
 started=time.monotonic();deadline=started+20
 while True:
  system=adb('shell','dumpsys','activity','activities')
  client=adb('shell','dumpsys','activity','dev.construct.runtime/.ModuleActivity')
  (run/'follow-focus-system.txt').write_text(system);(run/'follow-focus-client.txt').write_text(client)
  if resumed_unfocused(system,client):break
  if time.monotonic()>deadline:raise RuntimeError('No resumed-but-unfocused client observation after Quick Settings')
  time.sleep(.5)
 receipt['followForegroundObservationSeconds']=round(time.monotonic()-started,3);save()
def follow_checks():
 # Use the real host sensor/grant path; the fixture does not replace orientation.
 click(lambda t:t=='Follow');reach_text('Allow reading compass and tilt');capture('follow-denied')
 follow_sensors('denied',0)
 done('Follow denied without native orientation grant; static sky remains usable')
 module_access();switch('Allow reading compass and tilt',True);reopen()
 if a.pointing_layout_only:
  inject_point(85,60,35);click(lambda t:t=='Follow');reach_text('Pointing east, 6 fists up')
  click(lambda t:t.startswith('Long March 4B rocket stage'))
 else:
  inject('0:0:9.80665','0:50:-20');click(lambda t:t=='Follow')
  reach_text('Facing north · compass');full_dome();capture('follow-north');follow_sensors('watching',1)
  inject('0:0:9.80665','-50:0:-20');reach_text('Facing east · compass');full_dome();capture('follow-east')
  click(lambda t:t.startswith('Long March 4B rocket stage'))
  # The fixture satellite moves while native navigation runs. Retain the actual
  # relative instruction rather than requiring it to remain directly ahead.
  receipt['followGuidance']=text_of(reveal(lambda t:bool(re.match(r'^(Ahead of you|Turn (left|right) about [0-9]+°|Behind you:)',t))))
  save();capture('follow-pointing');click(lambda t:t=='Clear')
  done('Granted real rotation-vector readings drive true-north-corrected north/east Follow dome and relative turn guidance')
  # Raised like a camera (upright, axis level): the pointing view replaces the dome.
  inject('0:9.80665:0','-50:-20:0');reach_text('Pointing ')
  click(lambda t:t.startswith('Long March 4B rocket stage'))
  receipt['pointGuidance']=text_of(reveal(visible_point_guidance))
  save();full_dome('Pointing view:');capture('pointing-view')
  inject_point(85,60);reach_text('Pointing east, 6 fists up')
  full_dome('Pointing view:');capture('pointing-high')
  inject_point(85,60,35);reach_text('Pointing east, 6 fists up')
  time.sleep(2);full_dome('Pointing view:');capture('pointing-rolled')
  receipt['pointHighGuidance']=text_of(reveal(visible_point_guidance));save()
  done('High 60-degree camera aim stays in pointing through host flat pose; rolled view and screen-relative guidance remain available')
  # The fixture clock advances with navigation. Reopen it before the layout
  # sequence so this short-lived satellite is still above the horizon; do not
  # mistake a correct below-horizon message for missing directional guidance.
  adb('shell','am','force-stop','dev.construct.runtime');open_module(FIXTURE)
  inject_point(85,60,35);click(lambda t:t=='Follow');reach_text('Pointing east, 6 fists up')
  click(lambda t:t.startswith('Long March 4B rocket stage'))
 adb('shell','settings','put','system','user_rotation','1');time.sleep(3)
 reach_text('Pointing east, 6 fists up');full_dome('Pointing view:');capture('pointing-landscape')
 center_point_guidance();capture('pointing-landscape-guidance')
 adb('shell','settings','put','system','user_rotation','0');adb('shell','settings','put','system','font_scale','2.0');time.sleep(3)
 reach_text('Pointing east, 6 fists up');full_dome('Pointing view:');capture('pointing-large-text')
 center_point_guidance();capture('pointing-large-guidance')
 adb('shell','settings','put','system','font_scale','1.0');time.sleep(2)
 done('Pointing canvas and guidance stay reachable in landscape and 200% Android text')
 if a.pointing_layout_only:
  follow_sensors('layout-watching',1);click(lambda t:t=='Follow');follow_sensors('layout-off',0)
  assert len(receipt['checks'])==receipt['plannedChecks']
  receipt['complete']=True;save();raise SystemExit(0)
 click(lambda t:t=='Clear',directions=('down','up'))
 inject('0:0:9.80665','-50:0:-20');reach_text('Facing east · compass')
 click(lambda t:t=='Follow');follow_sensors('off',0);full_dome();capture('follow-off')
 done('Raised phone switches to the pointing view with plain guidance; flat returns the dome; explicit off returns north-up and releases native listener')
 click(lambda t:t=='Follow');reach_text('Facing east · compass')
 tap('Construct menu');follow_sensors('menu',0);tap('Return to module');reach_text('Facing east · compass');follow_sensors('menu-return',1)
 done('Native menu pause releases compass and explicit menu return re-establishes Follow')
 adb('shell','cmd','statusbar','expand-settings');time.sleep(4);follow_focus_lost();follow_sensors('quick-settings',0);capture('follow-quick-settings')
 adb('shell','cmd','statusbar','collapse');time.sleep(2)
 reach_text('Follow stopped when Space Watch lost the foreground');capture('follow-ended');follow_sensors('focus-return',0)
 inject('0:0:9.80665','0:50:-20');time.sleep(2);follow_sensors('still-off',0)
 click(lambda t:t=='Follow');reach_text('Facing north · compass');follow_sensors('explicit-restart',1)
 done('Quick Settings ends Follow, explains focus loss, and requires an explicit tap to restart')
 adb('shell','settings','put','system','user_rotation','1');time.sleep(3)
 reach_text('Facing east · compass');full_dome();capture('follow-landscape')
 adb('shell','settings','put','system','user_rotation','0');adb('shell','settings','put','system','font_scale','2.0');time.sleep(3)
 reach_text('Facing north · compass');full_dome();capture('follow-large-text')
 adb('shell','settings','put','system','font_scale','1.0');time.sleep(2)
 done('Follow remains operable with display rotation and 200% Android text')
 module_access();switch('Allow reading compass and tilt',False);reopen()
 click(lambda t:t=='Follow');reach_text('Allow reading compass and tilt');follow_sensors('revoked',0)
 adb('shell','am','force-stop','dev.construct.runtime');open_module(FIXTURE);contains('visible ·');follow_sensors('process-restart',0)
 done('Revoked orientation cannot restart Follow; a fresh process starts with Follow off')
def layer_control(name):
 reveal(lambda t:t.startswith(name+':'))
 return next(n for n in nodes() if n.get('checkable')=='true' and visible(n) and
             (n.get('resource-id')=='layer-'+('gnss' if name=='Navigation' else 'geo')+'-switch' or text_of(n).startswith(name+':')))
def layer_switch(name,on):
 n=layer_control(name)
 if (n.get('checked')=='true')!=on:tap_node(n)
 time.sleep(1)
 assert layer_control(name).get('checked')==str(on).lower(),'Layer switch did not change'
def layer_checks():
 click(lambda t:t=='Layers');layer_switch('Navigation',True);layer_switch('Geostationary',True)
 capture('space-layers-dialog');click(lambda t:t=='Done')
 reach_text('navigation satellites above you');reach_text('Drawn as small diamonds')
 full_dome();capture('space-layers-dome')
 done('Navigation and GEO layers load through the fixture mirror; switches and full dome are operable')
 # Open only the GEO list: select its summary's following details control.
 reach_text('Drawn as small diamonds')
 rows=list(nodes());summary=next(i for i,n in enumerate(rows) if 'Drawn as small diamonds' in text_of(n))
 button=next(n for n in rows[summary+1:] if text_of(n)=='List them' and visible(n));tap_node(button)
 click(lambda t:t.startswith('ASTRA 1KR'))
 reach_text('SOUTH · 3 fists up');capture('space-layers-astra')
 click('Details');reach_text('NORAD 29055');capture('space-layers-astra-details');click(lambda t:t=='Close')
 done('GEO list selects ASTRA 1KR with southern pointing and its own NORAD details')
 for rotation,scale,label in [('1','1.0','landscape'),('0','2.0','large-text')]:
  adb('shell','settings','put','system','user_rotation',rotation);adb('shell','settings','put','system','font_scale',scale);time.sleep(3)
  click(lambda t:t=='Layers');capture('space-layers-'+label);click(lambda t:t=='Done')
  click('Details');reach_text('NORAD 29055');capture('space-layers-'+label+'-details');click(lambda t:t=='Close')
 adb('shell','settings','put','system','font_scale','1.0');time.sleep(2)
 done('Layer switches and selected-object details work in landscape and 200% Android text')
 adb('shell','am','force-stop','dev.construct.runtime');open_module(FIXTURE);contains('visible ·')
 reach_text('navigation satellites above you');reach_text('Drawn as small diamonds');capture('space-layers-restored')
 done('Enabled layer preferences survive process restart and reload their data')
 click(lambda t:t=='Layers');layer_switch('Navigation',False);layer_switch('Geostationary',False);click(lambda t:t=='Done')
 adb('shell','am','force-stop','dev.construct.runtime');open_module(FIXTURE);contains('visible ·')
 click(lambda t:t=='Layers')
 for name in ['Navigation','Geostationary']:
  n=layer_control(name);assert n.get('checked')=='false','Layer unexpectedly enabled on restart'
 capture('space-layers-off');click(lambda t:t=='Done')
 done('Turning both layers off is persisted without changing the baseline sky')

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

 # The synthetic wrapper intentionally bypasses position/orbit grants; only the
 # real module later proves native permission gates. Enable actual lookup HTTP.
 open_module(FIXTURE);module_access();switch('Allow approved internet sources',True);reopen()
 contains('visible ·');capture('space-dome')
 done('Signed fixture opens its computed dome and equivalent overhead list')
 if a.follow:
  follow_checks()
  # Follow setup/revocation ends in a fresh process with Follow off; reset the
  # fixture clock so the original pass and pointing assertions remain meaningful.
  adb('shell','am','force-stop','dev.construct.runtime');open_module(FIXTURE);contains('visible ·')
 reach_text('Visible passes · next 12 h')
 reach_text('Now · ISS (Zarya)');scroll('down',500);capture('space-plan')
 reach_text('highest 1½ fists up in the SW')
 done('Visible-pass list includes the current ISS pass and pointing/max-height words')
 click(lambda t:'Guowang train' in t and ' · ' in t,directions=('down','up'))
 reach_text('Preview ');reach_text('At ');reach_text('9 satellites in a line');capture('space-train-preview')
 click(lambda t:t=='Details');reach_text('9 of 11 from this launch');reach_text('2026-221');capture('space-train-details')
 click('Read on Wikipedia');wiki_credit();capture('space-train-wikipedia')
 done('Future Guowang pass previews on the dome with train details and live Wikipedia attribution')
 click(lambda t:t=='Close');tap('Construct menu');tap('Return to module');reach_text('Preview ')
 click('Back to now');reach_text('Overhead now');capture('space-train-back-now')
 done('Future preview survives native menu pause and Back to now restores the live sky')
 # Reset the running fixture clock before the old, time-sensitive EAST card.
 # Planner navigation and real Wikipedia can outlast that original position.
 adb('shell','am','force-stop','dev.construct.runtime');open_module(FIXTURE);contains('visible ·')
 click(lambda t:t.startswith('Long March 4B rocket stage'))
 reach_text('EAST · 1½ fists up');reach_text('above Saturn');capture('space-spot')
 done('Fixture stage list selection gives EAST, 1½ fists up and Saturn anchor')
 click(lambda t:t=='Details');contains('NORAD 29507 · 2006-046C')
 contains('Carried:',45);capture('space-details')
 click('Read on Wikipedia');wiki_credit();capture('space-wikipedia')
 done('Real same-launch lookup and explicit Wikipedia request render attributed results')
 click(lambda t:t=='Close');click(lambda t:t=='Red mode')
 # Rewind via the actual accessible range control.
 slider=reveal(lambda t:t=='Rewind')
 seek=next(n for n in nodes() if n.get('class')=='android.widget.SeekBar' and visible(n))
 b=bounds(seek);adb('shell','input','tap',str(round(b[0]+(b[2]-b[0])*.6)),str((b[1]+b[3])//2))
 reach_text('min ago');capture('space-red-rewind');click('Back to now')
 done('Red mode and native touch rewind update the selected-object view')
 adb('shell','am','force-stop','dev.construct.runtime');open_module(FIXTURE)
 contains('visible ·');capture('space-reopened')
 # WebView exposes this aria-pressed ToggleButton without a checked state.
 # Assert the actual rendered palette instead of inventing accessibility state.
 from PIL import Image
 png=next((run/'space-reopened-display').glob('*.png'))
 pixels=Image.open(png).convert('RGB');red=green=0
 for rr,gg,bb in pixels.crop((0,80,pixels.width,pixels.height-40)).getdata():
  red += rr>60 and rr>gg*1.8 and rr>bb*1.5
  green += gg>60 and gg>rr*1.3 and gg>bb*1.1
 assert red>1000 and red>green*3, ('Red palette did not survive restart',red,green)
 receipt['reopenedPalettePixels']={'red':red,'green':green};save()
 done('Red preference survives a genuine process restart')
 click(lambda t:t=='Red mode')
 # Known clock starts again on reopen. Select the ISS using computed canvas
 # coordinates: its fixture initial az/el, measured through actual canvas bounds.
 canvas=reveal('Sky dome:');b=bounds(canvas)
 assert abs((b[2]-b[0])-(b[3]-b[1]))<8, 'Dome clipped before canvas tap'
 # ISS is low SW during this short interval. Pick by current elapsed offset
 # with generous hit target, verified by selected title rather than tap alone.
 x=b[0]+(b[2]-b[0])*.22;y=b[1]+(b[3]-b[1])*.75
 adb('shell','input','tap',str(round(x)),str(round(y)))
 reach_text('ISS (Zarya)');reach_text('International Space Station · crewed');capture('space-canvas-selected')
 done('Canvas touch selects the ISS, independently of the list')
 # This preview uses the cached train after the genuine process restart.
 click(lambda t:'Guowang train' in t and ' · ' in t,directions=('down','up'));reach_text('Preview ')
 adb('shell','settings','put','system','user_rotation','1');time.sleep(3)
 full_dome();capture('space-landscape');click('Details');reach_text('9 of 11 from this launch');reach_text('2026-221');capture('space-landscape-details');click(lambda t:t=='Close')
 done('Landscape train preview/details remain operable and cached batch identity survives restart')
 adb('shell','settings','put','system','user_rotation','0');adb('shell','settings','put','system','font_scale','2.0');time.sleep(3)
 click('Details');reach_text('2026-221');capture('space-large-text-details');click(lambda t:t=='Close');full_dome();capture('space-large-text')
 done('200% Android text: train preview, scrolling details and close controls remain operable')
 adb('shell','settings','put','system','font_scale','1.0');time.sleep(2)
 # Native menu pause/resume on retained data, then real module gates.
 tap('Construct menu');tap('Return to module');contains('visible ·')
 done('Native menu pause/resume restores the sky')
 if a.layers:layer_checks()
 tap('Construct menu');find('Mark working');tap('Mark working')
 if a.layers:
  install(REAL,a.previous_module_sha,version='0.4.1');open_module(REAL,version='0.4.1')
  contains('Phone location isn’t enabled');module_access();switch('Allow approved internet sources',True);reopen()
  tap('Construct menu');tap('Mark working')
  install(REAL,a.module_sha,expanded=True);open_module(REAL)
  module_access();n=reach_native('Allow approved internet sources',checkable=True)
  assert n.get('checked')=='false','Declined expanded consent must leave all HTTP disabled'
  capture('space-expanded-consent-denied');reopen()
  done('Real 0.4.1 update: expanded origin consent defaults off and cannot reuse the previous HTTP grant')
 else:
  install(REAL,a.module_sha);open_module(REAL)
 contains('Phone location isn’t enabled');capture('space-real-location-denied')
 done('Real module refuses ungranted phone location and offers manual place')
 click('Choose place')
 end=time.monotonic()+20
 while time.monotonic()<end:
  edits=[n for n in nodes() if n.get('class')=='android.widget.EditText' and n.get('resource-id') in ('latitude','longitude')]
  if len(edits)==2:break
  time.sleep(.25)
 else:raise RuntimeError('Coordinate inputs missing after dialog settled')
 ui._device(className='android.widget.EditText',instance=0).set_text('52.52')
 ui._device(className='android.widget.EditText',instance=1).set_text('13.405')
 # set_text does not necessarily show a keyboard; an unconditional Back opens
 # Construct's menu instead. Dismiss only an actually exposed IME.
 if any(n.get('package') in ('com.google.android.inputmethod.latin','com.android.inputmethod.latin') for n in nodes()):
  adb('shell','input','keyevent','KEYCODE_BACK')
 click('Show sky')
 reach_text('Enable the requested capability');capture('space-real-internet-denied')
 done('Real manual-place flow works without location, but ungranted HTTP stays denied')
 module_access();switch('Allow approved internet sources',True);switch('Allow reading phone location',True)
 permission('Allow Android location access')
 adb('shell','cmd','location','set-location-enabled','true')
 reopen()
 for _ in range(3):adb('emu','geo','fix','13.405','52.52');time.sleep(1)
 # Grant-denied attempts never reached the provider: reopening must fetch
 # automatically, with no compensating manual refresh.
 contains('Your location',45)
 # Loading the object list moves the status below the viewport. Read the
 # settled result via actual scrolling, not only currently exposed XML text.
 # Permission return can precede the initial provider reply. Wait for the
 # async result, without tapping Refresh or counting a downloading state as pass.
 deadline=time.monotonic()+90;status=''
 while time.monotonic()<deadline:
  try:
   status=text_of(reveal(lambda t:bool(re.match(r'^Orbit data .+ old · CelesTrak',t))))
   break
  except RuntimeError:
   time.sleep(2)
 if not status:raise RuntimeError('Live orbit data did not arrive within 90 seconds after grants')
 assert re.match(r'^Orbit data .+ old · CelesTrak',status), ('Live orbit data not ready',status)
 receipt['realDataStatus']=status;save()
 # The previous runner could scrub while scrolling. Require live-time capture.
 reach_text('Overhead now')
 receipt['realCounts']=text_of(reveal(lambda t:bool(re.fullmatch(r'\d+ visible · \d+ above you',t))))
 capture('space-real-network')
 done('Real module: native granted fix and live CelesTrak orbits populate the sky')
 # Cached sky with actual connectivity disabled, no hidden replacement data.
 adb('shell','svc','wifi','disable');adb('shell','svc','data','disable')
 adb('shell','am','force-stop','dev.construct.runtime');open_module(REAL)
 contains('Your location',45)
 receipt['offlineCounts']=text_of(reveal(lambda t:bool(re.fullmatch(r'\d+ visible · \d+ above you',t))))
 capture('space-real-offline-cache')
 done('Real cached sky reopens with Wi-Fi and mobile data disabled')
 assert len(receipt['checks']) == receipt['plannedChecks'], 'Required acceptance gates missing'
 receipt['complete']=True

except Exception as e:
 receipt['error']=str(e);save();print('FAIL:',str(e),flush=True)
 try:(run/'failure-nodes.json').write_text(json.dumps([dict(n.attrib) for n in nodes()],indent=2));capture('failure')
 except Exception:pass
 if a.follow:
  try:
   reveal(lambda t:t in (FIXTURE,REAL));capture('failure-follow-top')
   (run/'failure-sensors.txt').write_text(adb('shell','dumpsys','sensorservice'))
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
