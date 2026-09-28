#!/usr/bin/env python3
"""Exact-APK API 0.14 orientation acceptance on a disposable emulator.
Sensor inputs are synthetic; this does not establish physical compass accuracy.
"""
import argparse,datetime,fcntl,hashlib,io,json,os,re,subprocess,time,uuid
from pathlib import Path
from config import CONFIG,SERIAL,require_runner,catalog
p=argparse.ArgumentParser();p.add_argument('--apk',type=Path,required=True);p.add_argument('--sha',required=True)
p.add_argument('--catalog',required=True);p.add_argument('--module-sha',required=True,help='Signed orientation probe digest')
p.add_argument('--version',default='0.1.3')
a=p.parse_args();require_runner();catalog(a.catalog)
if hashlib.sha256(a.apk.read_bytes()).hexdigest()!=a.sha:raise SystemExit('APK checksum mismatch')
lock=(CONFIG.root/'suite.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
if subprocess.run(['systemctl','--user','is-active','--quiet',CONFIG.service]).returncode==0:raise SystemExit('Preserve running emulator')
if any(x.startswith(SERIAL+'\t') for x in subprocess.check_output([str(CONFIG.sdk/'platform-tools/adb'),'devices'],text=True).splitlines()):raise SystemExit('Preserve occupied port')
run=CONFIG.root/'results'/(datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-orientation-'+uuid.uuid4().hex[:8]);run.mkdir(parents=True)
os.environ['CONSTRUCT_RESULTS']=str(run)
import ui
from ui import adb,nodes,labels,tap,tap_node,find,capture as adb_capture
from host_ui import host_ready,catalog_settings,apply_catalog,library,select_after,installed_status,diagnostics
from catalog_input import replace_text
receipt={'complete':False,'stopped':False,'apkSha256':a.sha,'moduleSha256':a.module_sha,'checks':[],'samples':[]}
started=False
name='Orientation probe';heading=name+' · '+a.version
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
def opened():launch();library();select_after(heading,('Open',));find('Read once')
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
def reopen():tap_node(reach_native('Reopen module'));find('Read once')
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
def installed_apk():
 paths=adb('shell','pm','path','dev.construct.runtime').splitlines();require(len(paths)==1 and paths[0].startswith('package:/data/app/'),'APK path')
 require(adb('shell','sha256sum',paths[0].removeprefix('package:')).split()[0]==a.sha,'Installed APK changed')

def sample():
 for label in labels():
  if label and label.startswith('Sample: {'):return json.loads(label[len('Sample: '):])
 raise RuntimeError('No sample in fixture')
def sensor_state(label):
 from orientation_checks import active_connections
 raw=adb('shell','dumpsys','sensorservice');(run/('sensors-'+label+'.txt')).write_text(raw)
 package=adb('shell','pm','list','packages','-U','dev.construct.runtime')
 uid=int(re.search(r'uid:(\d+)',package).group(1))
 connections=active_connections(raw,uid)
 receipt.setdefault('nativeConnections',{})[label]=connections;save()
 require(connections==(1 if label=='watching' else 0),'Unexpected native listeners after '+label)
def count():
 for label in labels():
  if label and re.fullmatch(r'Events: \d+',label):return int(label.split(': ')[1])
 raise RuntimeError('No event count')
def inject(acc,mag):
 adb('emu','sensor','set','gyroscope','0:0:0')
 adb('emu','sensor','set','acceleration',acc)
 adb('emu','sensor','set','magnetic-field',mag)
def valid(s):
 require(set(s)<=set(('pose','azimuthDeg','headingRef','accuracyDeg','pitchDeg','rollDeg','calibrate','timestamp')),'Unexpected raw fields')
 require(s['pose'] in ('flat','upright') and type(s['calibrate']) is bool,'Malformed pose/calibration')
 for k in ('pitchDeg','rollDeg'):require(type(s[k]) in (float,int) and abs(s[k]*10-round(s[k]*10))<1e-6,'Angle precision')
 require(abs(s['timestamp']-int(adb('shell','date','+%s').strip())*1000)<10000,'Stale sample timestamp')
 if 'azimuthDeg' in s:require(s.get('headingRef')=='magnetic' and 0<=s['azimuthDeg']<360 and 'accuracyDeg' in s,'Heading fields')
 else:require('headingRef' not in s and 'accuracyDeg' not in s,'Partial unavailable heading')
def reading(pose,azimuth,pitch,timeout=35):
 until=time.monotonic()+timeout;seen=None
 while time.monotonic()<until:
  require(act('Read once')=='Read.','Reading failed')
  seen=sample()
  heading=seen.get('azimuthDeg')
  if seen['pose']==pose and heading is not None and abs((heading-azimuth+180)%360-180)<12 and abs(seen['pitchDeg']-pitch)<5:
   valid(seen);receipt['samples'].append(seen);save();return seen
  time.sleep(1)
 raise RuntimeError('Injected pose did not settle: '+str(seen))
def watch(rate):
 require(act('Watch at %d Hz'%rate).startswith('Watching:'),'Watch did not start')
 time.sleep(1);start=time.monotonic();first=count();time.sleep(3);last=count();elapsed=time.monotonic()-start
 require(last>first,'No stream events')
 require(last-first<=rate*(elapsed+.5)+1,'Stream exceeded rate cap')
 receipt.setdefault('rates',[]).append(dict(rate=rate,events=last-first,elapsedSeconds=elapsed));save()
def no_events():
 time.sleep(.5);before=count();time.sleep(2);require(count()==before,'Stream continued after stop/pause')

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
 require('package:dev.construct.runtime' not in adb('shell','pm','list','packages','dev.construct.runtime'),'Snapshot not app-free')
 require('uid=2000(shell)' in adb('shell','id'),'Expected unprivileged ADB')
 receipt['snapshot']={'avd':avd,'name':snapshot,'loaded':True};receipt['apiLevel']=adb('shell','getprop','ro.build.version.sdk').strip()
 (run/'sensors.txt').write_text(adb('emu','sensor','status'))
 adb('shell','settings','put','system','accelerometer_rotation','0');adb('shell','settings','put','system','user_rotation','0')
 inject('0:0:9.80665','0:50:-20')
 adb('logcat','-c');adb('install',str(a.apk.resolve()),timeout=120)
 receipt['hostVersion']=[line.strip() for line in adb('shell','dumpsys','package','dev.construct.runtime').splitlines() if 'versionCode=' in line or 'versionName=' in line]
 launch();catalog_settings()
 replace_text(nodes,lambda v:ui._device(className='android.widget.EditText',packageName='dev.construct.runtime').set_text(v),a.catalog)
 apply_catalog();find('Catalog refreshed.');library();select_after(heading,('Review & install',));tap('Allow & install');installed_status()
 require(any(e.get('code')=='INSTALLED_TRIAL' and e.get('packageDigest')==a.module_sha for e in diagnostics()),'Wrong signed module')
 library();select_after(heading,('Open',));find('Read once')
 require(act('Read once').startswith('[CAPABILITY_DENIED]'),'Read allowed before grant')
 require(act('Watch at 10 Hz').startswith('[CAPABILITY_DENIED]'),'Watch allowed before grant')
 capture('denied');module_access()
 require(switch('Allow reading compass and tilt',True)=='false','Orientation must default off')
 capture('native-grant');reopen()
 done('Signed probe installed; one-shot and watch denied before explicit native grant')
 reading('flat',0,90);capture('flat-north')
 inject('0:0:9.80665','-50:0:-20');reading('flat',90,90);capture('flat-east')
 done('Flat north/east samples follow injected magnetic field with bounded schema and precision')
 inject('0:9.80665:0','-50:-20:0');reading('upright',90,0);capture('upright-east')
 inject('0:9.65766:1.70291','-50:-19.6962:-3.47296');reading('upright',90,10);capture('upright-pitch')
 done('Upright camera bearing and positive pitch follow synthetic orientation')
 watch(10);sensor_state('watching');capture('watch-10');require(act('Stop').startswith('Stopped:'),'Stop failed');no_events()
 watch(15);require(act('Stop').startswith('Stopped:'),'Stop failed');no_events()
 sensor_state('stopped')
 done('10 and 15 Hz streams deliver within their caps; stop leaves event counts stable')
 watch(10);tap('Construct menu');find('Return to module');tap('Return to module');find('Read once');no_events();capture('pause-resume')
 require(any(t and t.startswith('Paused; stream stopped') for t in labels()),'No pause notification')
 sensor_state('paused')
 done('Native menu pause stops watch and resume does not restart it')
 watch(10);module_access();switch('Allow reading compass and tilt',False,'Turn off');reopen()
 require(act('Read once').startswith('[CAPABILITY_DENIED]'),'Read allowed after revoke')
 require(act('Watch at 10 Hz').startswith('[CAPABILITY_DENIED]'),'Watch allowed after revoke');no_events();capture('revoked')
 sensor_state('revoked')
 done('Revocation stops stream; both operations denied after reopening')
 module_access();switch('Allow reading compass and tilt',True);reopen();watch(10)
 adb('shell','input','keyevent','KEYCODE_HOME');time.sleep(1)
 (run/'activity-background.txt').write_text(adb('shell','dumpsys','activity','activities'))
 sensor_state('background')
 # Closing/backgrounding invalidates the module session. Reopen a fresh run.
 adb('shell','am','force-stop','dev.construct.runtime');opened();require(count()==0,'New session inherited stream');no_events()
 require(act('Read once')=='Read.','Grant did not survive process restart')
 done('Background/close and process restart do not resurrect the stream; grant persists')
 adb('shell','settings','put','system','user_rotation','1');time.sleep(2);find('Read once');inject('0:0:9.80665','0:50:-20');reading('flat',90,90);capture('landscape')
 adb('shell','settings','put','system','user_rotation','0');time.sleep(1)
 adb('shell','settings','put','system','font_scale','2.0');adb('shell','am','force-stop','dev.construct.runtime');opened();capture('large-text')
 require(act('Read once')=='Read.','Large-text read failed');require(act('Stop').startswith('Stopped:'),'Large-text stop missing')
 done('Landscape and 200% text retain readable controls and working one-shot access')
 adb('shell','settings','put','system','font_scale','1.0');adb('shell','am','force-stop','dev.construct.runtime');opened();watch(10)
 # A system settings panel is translucent: verify pause without onStop and denied new requests.
 before=act('Check paused requests in 3 seconds',wait=False)
 adb('shell','am','start','-W','-a','android.settings.panel.action.INTERNET_CONNECTIVITY')
 time.sleep(4)
 activities=adb('shell','dumpsys','activity','activities');(run/'activity-pause.txt').write_text(activities)
 capture('activity-paused')
 block=re.search(r'Hist #[^\n]*dev\.construct\.runtime/\.ModuleActivity[^\n]*\n(.*?)(?=\* Hist #|RootTask|$)',activities,re.S)
 require(block is not None and 'state=PAUSED' in block.group(1) and 'stopped=false' in block.group(1),'No pause-only lifecycle observation; do not count this as covered')
 sensor_state('activity-paused')
 adb('shell','input','keyevent','KEYCODE_BACK');find('Read once')
 require(result(before)=='Pause requests: get=RUN_PAUSED; watch=RUN_PAUSED','Paused requests were not denied')
 require('Ended: paused (1)' in labels(),'Missing or repeated terminal pause event')
 no_events();sensor_state('pause-resumed');capture('pause-only-returned')
 watch(10);require(act('Stop').startswith('Stopped:'),'Explicit re-watch after resume failed');no_events()
 done('Pause-only panel releases listener, denies get/watch, emits one terminal event and requires explicit restart')
 installed_apk();receipt['complete']=True
except Exception as e:
 receipt['error']=str(e)
 try:(run/'failure-nodes.json').write_text(json.dumps([dict(n.attrib) for n in nodes()],indent=2));capture('failure')
 except Exception:pass
 raise
finally:
 try:
  if started:
   try:
    try:
     adb('shell','settings','put','system','font_scale','1.0');adb('shell','settings','put','system','user_rotation','0')
     (run/'runtime.log').write_text(adb('logcat','-d','-t','6000'));(run/'crash-buffer.txt').write_text(adb('logcat','-b','crash','-d'))
    except Exception:pass
   finally:
    subprocess.run([str(CONFIG.root/'runner.sh'),'stop'],check=True)
    receipt['stopped']=subprocess.run(['systemctl','--user','is-active','--quiet',CONFIG.service]).returncode!=0
 finally:
  (CONFIG.root/'camera-emulated.flag').unlink(missing_ok=True);save();print(json.dumps(receipt,indent=2),flush=True)
