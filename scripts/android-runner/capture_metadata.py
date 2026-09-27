#!/usr/bin/env python3
"""API 0.13 capture metadata and screenshot-switch acceptance on a disposable synthetic-camera emulator.
Ties every observation to one APK and two signed fixture versions of dev.construct.capture-metadata:
0.1.0 (API 0.12: exact {op} request, {saved} result) and 0.2.0 (API 0.13).
Both tilt signs are injected with `adb emu sensor set acceleration` on a portrait-locked display.
Pure checks live in capture_checks.py (unit-tested without a device).
"""
import argparse,datetime,fcntl,hashlib,io,json,os,re,subprocess,time,uuid
from pathlib import Path
from config import CONFIG,SERIAL,require_runner,catalog
from capture_checks import acceleration,check_result,check_zoom_pair,level_readout,parse_result,readout_matches,secure_blackout,screenshot_content_bounds
p=argparse.ArgumentParser();p.add_argument('--apk',type=Path,required=True);p.add_argument('--sha',required=True)
p.add_argument('--catalog',required=True);p.add_argument('--legacy-sha',required=True,help='0.1.0 package digest (API 0.12)')
p.add_argument('--module-sha',required=True,help='0.2.0 package digest (API 0.13)')
a=p.parse_args();require_runner();catalog(a.catalog)
if hashlib.sha256(a.apk.read_bytes()).hexdigest()!=a.sha:raise SystemExit('APK checksum mismatch')
lock=(CONFIG.root/'suite.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
if subprocess.run(['systemctl','--user','is-active','--quiet',CONFIG.service]).returncode==0:raise SystemExit('Preserve running emulator')
if any(x.startswith(SERIAL+'\t') for x in subprocess.check_output([str(CONFIG.sdk/'platform-tools/adb'),'devices'],text=True).splitlines()):raise SystemExit('Preserve occupied port')
run=CONFIG.root/'results'/(datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-capture-metadata-'+uuid.uuid4().hex[:8]);run.mkdir(parents=True)
os.environ['CONSTRUCT_RESULTS']=str(run)
import ui
from ui import adb,nodes,labels,tap,tap_node,find,capture as adb_capture
from host_ui import host_ready,catalog_settings,apply_catalog,library,select_after,installed_status,diagnostics
from catalog_input import replace_text
receipt={'complete':False,'stopped':False,'apkSha256':a.sha,'moduleSha256':{'0.1.0':a.legacy_sha,'0.2.0':a.module_sha},
 'recents':'Not captured yet','checks':[],'captures':[]}
started=False
name='Capture metadata probe';heading=name+' · 0.1.0'
def save():(run/'result.json').write_text(json.dumps(receipt,indent=2)+'\n')
def done(text):receipt['checks'].append(text);save();print('PASS:',text,flush=True)
def require(ok,message):
 # Explicit failures: the runner may be invoked with -O like the unit tests.
 if not ok:raise RuntimeError(message)
def capture(name):
 # FLAG_SECURE blacks out ADB screenshots; the emulator console captures the synthetic display.
 adb_capture(name);target=run/(name+'-display');target.mkdir()
 adb('emu','screenrecord','screenshot',str(target))
 require(len(list(target.glob('*.png')))==1,'Missing synthetic console capture')
def screenshot_black(name):
 from PIL import Image
 raw=adb('exec-out','screencap','-p',binary=True);(run/(name+'-adb.png')).write_bytes(raw)
 image=Image.open(io.BytesIO(raw)).convert('RGB')
 crop=screenshot_content_bounds(*image.size,[dict(n.attrib) for n in nodes()])
 receipt.setdefault('screenshotRegions',{})[name]=list(crop);save()
 image=image.crop(crop);image.save(run/(name+'-app.png'));image.thumbnail((270,600))
 return secure_blackout(list(image.getdata()))
def status():
 import re
 for text in labels():
  m=re.fullmatch(r'(.*) #(\d+)',text or '',re.S)
  if m:return m[1],int(m[2])
 raise RuntimeError('Fixture status not visible')
def result(before,timeout=60):
 until=time.monotonic()+timeout
 while time.monotonic()<until:
  try:
   text,n=status()
   if n>before:return text
  except RuntimeError:pass
  time.sleep(.25)
 raise RuntimeError('No fixture result after '+str(before))
def act(label,wait=True,timeout=40):
 _,before=status();tap(label)
 return result(before,timeout) if wait else before
def launch():adb('shell','am','start','-n','dev.construct.runtime/.MainActivity');host_ready()
def opened():launch();library();select_after(heading,('Open',));find('Capture plain')
def module_access():tap('Construct menu');tap('Module access');find('Module access')
def bounds(n):return list(map(int,re.findall(r'-?\d+',n.get('bounds',''))))
def visible(n):
 b=bounds(n);return len(b)==4 and b[2]>b[0] and b[3]-b[1]>=8
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
def reopen():tap_node(reach_native('Reopen module'));find('Capture plain')
def switch(label,checked,confirm=None):
 initial=None
 for attempt in range(3):
  node=reach_native(label,checkable=True)
  if initial is None:initial=node.get('checked')
  if (node.get('checked')=='true')==checked:return initial
  print('Native switch tap:',label,bounds(node),'attempt',attempt+1,flush=True)
  tap_node(node)
  if confirm:tap(confirm)
  until=time.monotonic()+4
  while time.monotonic()<until:
   if any(n.get('content-desc')==label and n.get('checkable')=='true' and n.get('checked')==('true' if checked else 'false') for n in nodes()):return initial
   time.sleep(.25)
 raise RuntimeError('Switch did not change: '+label)
def install(version,digest,choice='Review & install'):
 global heading
 library();select_after(name+' · '+version,(choice,));tap('Allow & install');installed_status();heading=name+' · '+version
 require(any(e.get('code')=='INSTALLED_TRIAL' and e.get('packageDigest')==digest for e in diagnostics()),'Wrong signed module '+version)
def installed_apk():
 paths=adb('shell','pm','path','dev.construct.runtime').splitlines();require(len(paths)==1 and paths[0].startswith('package:/data/app/'),'APK path')
 require(adb('shell','sha256sum',paths[0].removeprefix('package:')).split()[0]==a.sha,'Installed APK changed')
def tilt(pitch,roll):adb('emu','sensor','set','acceleration',acceleration(pitch,roll))
def viewfinder(button):
 before=act(button,wait=False);find('Take photo',60)
 until=time.monotonic()+60
 while time.monotonic()<until and not any((t or '').startswith('Camera preview ready.') for t in labels()):time.sleep(.3)
 return before
def level_settles(pitch,roll,timeout=20):
 # Fused gravity follows an injected accelerometer within a few seconds; wait for the native readout.
 until=time.monotonic()+timeout;seen=None
 while time.monotonic()<until:
  seen=level_readout(labels())
  if readout_matches(seen,pitch,roll):return seen
  time.sleep(.4)
 raise RuntimeError('Level readout did not settle at pitch %s roll %s: %r'%(pitch,roll,seen))
def zoom(label):
 tap_node(find('Zoom '+label))
 until=time.monotonic()+15
 while time.monotonic()<until:
  if any(n.get('content-desc')=='Zoom '+label and n.get('selected')=='true' for n in nodes()):return
  time.sleep(.3)
 raise RuntimeError('Zoom chip not selected: '+label)
def measured(pitch,roll,ratio):
 tilt(pitch,roll);before=viewfinder('Capture with level and zoom')
 require(find('Zoom 1×') is not None and find('Zoom 2×') is not None,'Zoom chips missing')
 readout=level_settles(pitch,roll)
 if ratio!='1×':zoom(ratio)
 capture('viewfinder-%+d-%+d-%s'%(pitch,roll,ratio.rstrip('×')))
 tap('Take photo');require(result(before,90)=='Captured.','Capture failed')
 raw=parse_result(labels());require(raw is not None,'No capture result')
 problems=check_result(raw,zoom=float(ratio.rstrip('×')),pitch=pitch,roll=roll)
 require('ID listed: yes' in labels(),'Returned id is not in photos.library list')
 receipt['captures'].append({'injected':{'pitch':pitch,'roll':roll},'zoom':ratio,'readout':readout,'result':raw,'problems':problems});save()
 require(not problems,'Capture metadata problems: %r'%problems)
 return raw

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
 (run/'startup.log').write_text(startup);require("Successfully loaded snapshot '"+snapshot+"'" in startup,'No clean snapshot evidence')
 pid=subprocess.check_output(['systemctl','--user','show',CONFIG.service,'-p','MainPID','--value'],text=True).strip()
 cmd=Path('/proc/'+pid+'/cmdline').read_bytes().decode().split('\0')
 for k,v in [('-avd',avd),('-camera-back','emulated'),('-camera-front',CONFIG.front_camera(True))]:require(k in cmd and cmd[cmd.index(k)+1]==v,'Camera not synthetic-only')
 require('package:dev.construct.runtime' not in adb('shell','pm','list','packages','dev.construct.runtime'),'Snapshot not app-free')
 require('uid=2000(shell)' in adb('shell','id'),'Expected unprivileged ADB')
 receipt['snapshot']={'avd':avd,'name':snapshot,'loaded':True};receipt['apiLevel']=adb('shell','getprop','ro.build.version.sdk').strip()
 # Portrait-locked display: injected gravity must change the level, never the display rotation.
 adb('shell','settings','put','system','accelerometer_rotation','0');adb('shell','settings','put','system','user_rotation','0')
 tilt(0,0)
 adb('logcat','-c');adb('install',str(a.apk.resolve()),timeout=120)
 receipt['hostVersion']=[line.strip() for line in adb('shell','dumpsys','package','dev.construct.runtime').splitlines() if 'versionCode=' in line or 'versionName=' in line]
 launch();catalog_settings()
 replace_text(nodes,lambda v:ui._device(className='android.widget.EditText',packageName='dev.construct.runtime').set_text(v),a.catalog)
 apply_catalog();find('Catalog refreshed.');install('0.1.0',a.legacy_sha)
 library();select_after(heading,('Open',));find('Capture plain');module_access()
 for label in ['Allow taking private photos','Allow this module’s private photo library','Allow selected image pixels']:switch(label,True)
 tap_node(reach_native('Allow Android camera access'));find('While using the app');tap('While using the app');find('Android camera access: allowed')
 reopen()

 # API 0.12: new request fields are rejected and the result keeps its exact shape.
 require(act('Capture with level and zoom').startswith('[CAMERA_PARAMS]'),'API 0.12 accepted API 0.13 fields')
 before=viewfinder('Capture plain')
 require(not any((t or '').startswith(('Pitch ','Zoom ')) for t in labels()),'API 0.12 viewfinder shows 0.13 controls')
 tap('Take photo');require(result(before,90)=='Captured.','Legacy capture failed')
 require(parse_result(labels())=={'saved':True} and 'ID listed: not provided' in labels(),'API 0.12 result shape changed')
 done('API 0.12 keeps the exact {op} request and {saved} result; no level or zoom controls')

 # The successful legacy capture returns to the already-open module. Starting
 # MainActivity here only brings its task forward; it does not close the module.
 tap('Construct menu');tap('Mark working');install('0.2.0',a.module_sha);opened()
 require(screenshot_black('module-switch-off'),'Pixel-bearing module screen is capturable with the switch off')
 module_access()
 require(switch('Allow screenshots',True)=='false','Allow screenshots must default to off')
 require(any(t and 'Off by default.' in t for t in labels()),'Missing Allow screenshots copy')
 reopen();require(not screenshot_black('module-switch-on'),'Module screen still black with Allow screenshots on')
 adb('shell','input','keyevent','KEYCODE_APP_SWITCH');time.sleep(1.5);capture('recents-switch-on')
 receipt['recents']='Captured with screenshot opt-in enabled; visual review required';save()
 # Backgrounding ends ModuleActivity's session; return to the host, then
 # reopen explicitly after the process restart instead of expecting old controls.
 adb('shell','input','keyevent','KEYCODE_BACK')
 adb('shell','am','force-stop','dev.construct.runtime');opened()
 require(not screenshot_black('module-switch-on-restart'),'Screenshot choice was lost on restart')
 before=viewfinder('Capture plain');require(screenshot_black('viewfinder-switch-on'),'Native viewfinder dropped FLAG_SECURE')
 tap('Cancel capture');require(result(before,60)=='Capture canceled.','Cancel did not finish');find('Capture plain')
 done('Allow screenshots is off by default, drops FLAG_SECURE for this module only, and the viewfinder stays secure')

 first=measured(10,0,'1×');done('Pitch +10° (looking down) reports pitchDeg > 0 at 1× with a listed stable id')
 second=measured(-10,0,'2×');done('Pitch -10° (looking up) reports pitchDeg < 0 at 2×')
 pair=check_zoom_pair(first,second)
 receipt['zoomPair']=pair or 'fov follows 2·atan(tan(fov1/2)/2)';save()
 require(not pair or pair==['fovDeg omitted; zoom pair not comparable'],'2× FOV is not the digital crop of 1×: %r'%pair)
 measured(0,10,'1×');done('Roll +10° (right side down) reports rollDeg > 0')
 measured(0,-10,'2×');done('Roll -10° (right side up) reports rollDeg < 0')
 level=measured(0,0,'1×')
 require(level['capture']['tilt']['sigmaDeg']<=3,'Level sigma too large on a still emulator')
 done('Level pose reports near-zero tilt with a small sigma')

 module_access();switch('Allow screenshots',False);reopen()
 require(screenshot_black('module-switch-off-again'),'Turning the switch off did not restore FLAG_SECURE')
 done('Turning Allow screenshots off restores FLAG_SECURE')
 installed_apk()
 receipt['complete']=True
except Exception as e:
 receipt['error']=str(e)
 try:(run/'failure-nodes.json').write_text(json.dumps([dict(n.attrib) for n in nodes()],indent=2));capture('failure')
 except Exception:pass
 raise
finally:
 try:
  if started:
   try:
    try:tilt(0,0)
    except Exception:pass
    try:(run/'runtime.log').write_text(adb('logcat','-d','-t','6000'));(run/'crash-buffer.txt').write_text(adb('logcat','-b','crash','-d'))
    except Exception:pass
   finally:
    subprocess.run([str(CONFIG.root/'runner.sh'),'stop'],check=True)
    receipt['stopped']=subprocess.run(['systemctl','--user','is-active','--quiet',CONFIG.service]).returncode!=0
 finally:
  (CONFIG.root/'camera-emulated.flag').unlink(missing_ok=True);save();print(json.dumps(receipt,indent=2),flush=True)
