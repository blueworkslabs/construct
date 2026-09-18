#!/usr/bin/env python3
"""Bounded Camera extraction probe on a disposable synthetic-camera emulator.
Debug timing evidence is explicitly distinct from optimized artifact acceptance.
"""
import argparse,datetime,fcntl,hashlib,json,os,re,subprocess,time,uuid
from pathlib import Path
from config import CONFIG,SERIAL,require_runner,catalog
p=argparse.ArgumentParser();p.add_argument('--apk',type=Path,required=True);p.add_argument('--sha',required=True)
p.add_argument('--catalog',required=True);p.add_argument('--module-sha',required=True);p.add_argument('--module-version',default='0.2.0')
p.add_argument('--prototype',action='store_true');a=p.parse_args();require_runner();catalog(a.catalog)
assert hashlib.sha256(a.apk.read_bytes()).hexdigest()==a.sha,'APK checksum mismatch'
lock=(CONFIG.root/'suite.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
assert subprocess.run(['systemctl','--user','is-active','--quiet',CONFIG.service]).returncode!=0,'Preserve running emulator'
assert not any(x.startswith(SERIAL+'\t') for x in subprocess.check_output([str(CONFIG.sdk/'platform-tools/adb'),'devices'],text=True).splitlines()),'Preserve occupied port'
run=CONFIG.root/'results'/(datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-camera-module-'+uuid.uuid4().hex[:8]);run.mkdir(parents=True)
os.environ['CONSTRUCT_RESULTS']=str(run)
import ui
from ui import adb,nodes,labels,tap,tap_node,find,capture
from host_ui import host_ready,catalog_settings,apply_catalog,library,select_after,installed_status,diagnostics
from catalog_input import replace_text
from adb_identity import restore_shell_identity
receipt={'complete':False,'stopped':False,'prototypeDebug':a.prototype,'apkSha256':a.sha,'moduleSha256':a.module_sha,'checks':[],'timings':[]}
started=False;rooted=False
heading='Pocket Camera · '+a.module_version
folder='/data/user/0/dev.construct.runtime/files/camera-photos/dev.construct.camera/'
def save():(run/'result.json').write_text(json.dumps(receipt,indent=2)+'\n')
def done(name):receipt['checks'].append(name);save();print('PASS:',name,flush=True)
def display(name):
 capture(name);target=run/(name+'-display');target.mkdir();adb('emu','screenrecord','screenshot',str(target))
 assert len(list(target.glob('*.png')))==1,'Missing secure-console capture'
def expect(prefix,timeout=35):
 until=time.monotonic()+timeout
 while time.monotonic()<until:
  texts=labels();match=next((x for x in texts if x.startswith(prefix)),None)
  if match:return match
  if any('[IMAGE_ANALYSIS_UNAVAILABLE]' in x or '[JAVASCRIPT_ERROR]' in x for x in texts):raise RuntimeError('Inference or module failure')
  time.sleep(.25)
 raise RuntimeError('Missing: '+prefix)
def reach(label,host=False):
 previous=None
 for i in range(22):
  ns=nodes();matches=[n for n in ns if label in (n.get('text'),n.get('content-desc')) and n.get('package')=='dev.construct.runtime']
  for n in matches:
   b=list(map(int,re.findall(r'\d+',n.get('bounds',''))));w,h=ui._device.window_size()
   if len(b)==4 and b[0]>=0 and b[1]>=0 and b[2]>b[0] and b[3]>b[1] and b[3]<=h:
    if previous==n.get('bounds'):return n
    previous=n.get('bounds');time.sleep(.3);break
  else:
   w,h=ui._device.window_size();x=int(w*.45)
   if i<12:adb('shell','input','swipe',str(x),str(int(h*.9)),str(x),str(int(h*(.45 if host else .62))),'250')
   else:adb('shell','input','swipe',str(x),str(int(h*(.45 if host else .62))),str(x),str(int(h*.9)),'250')
  time.sleep(.2)
 raise RuntimeError('Control not reachable: '+label)
def action(label):tap_node(reach(label))
def launch():adb('shell','am','start','-n','dev.construct.runtime/.MainActivity');host_ready()
def opened():
 launch();library();select_after(heading,('Open',));find('Take a photo')
def grant(label):
 n=reach(label,True)
 matches=[n for n in nodes() if n.get('content-desc')==label and n.get('checkable')=='true']
 assert len(matches)==1 and matches[0].get('checked')=='false','Fresh grant not off: '+label
 tap_node(matches[0]);find(label+': on.')
def root():
 global rooted
 assert adb('shell','getprop','ro.kernel.qemu').strip()=='1' and adb('shell','getprop','ro.build.type').strip()=='userdebug','Disposable image required'
 adb('root');adb('wait-for-device');rooted=True;assert adb('shell','id','-u').strip()=='0'
def unroot():
 global rooted
 restore_shell_identity(adb);rooted=False

def prototype_metrics():
 if not a.prototype:return None
 import urllib.request,websocket
 pid=adb('shell','pidof','dev.construct.runtime').strip();assert pid.isdigit(),'Expected one app process'
 adb('forward','tcp:9224','localabstract:webview_devtools_remote_'+pid)
 try:
  with urllib.request.urlopen('http://127.0.0.1:9224/json',timeout=5) as response:pages=json.load(response)
  page=next(p for p in pages if p.get('url','').startswith('https://dev.construct.camera.construct.invalid/'))
  with websocket.create_connection(page['webSocketDebuggerUrl'],timeout=5,suppress_origin=True) as ws:
   ws.send(json.dumps({'id':1,'method':'Runtime.evaluate','params':{'expression':'JSON.stringify(window.cameraMetrics)','returnByValue':True}}))
   while True:
    result=json.loads(ws.recv())
    if result.get('id')==1:return json.loads(result['result']['result']['value'])
 finally:adb('forward','--remove','tcp:9224')

def measure(kind,expected,index):
 action('Find '+kind);expect('Analysis complete. Original unchanged.',60)
 text=expect(kind.title()+' found:')
 if kind=='faces':assert expected in text,(kind,text)
 else:assert any(expected in item for item in labels()),(kind,labels())
 timing=expect('Local processing:');match=re.fullmatch(r'Local processing: (\d+) ms · Ready in (\d+) ms',timing)
 assert match,'Missing measured timing';receipt['timings'].append({'kind':kind,'case':index,'nativeMs':int(match[1]),'turnaroundMs':int(match[2]),'prototypeFrameProbe':prototype_metrics()})
 display('analysis-'+index+'-'+kind)

try:
 print('RESULTS:',run,flush=True);save();(CONFIG.root/'camera-emulated.flag').write_text('emulated\n')
 avd,snapshot,_=CONFIG.profile(True);subprocess.run([str(CONFIG.root/'runner.sh'),'start'],check=True);started=True
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
 assert 'uid=2000(shell)' in adb('shell','id'),'Expected unprivileged ADB'
 from webview_provider import installed_provider_sha
 assert installed_provider_sha(adb)=='e4ded2f4d0f22dce452fd0d9f485a9b78926a9e2c3d4ffe64f4a385346d20497','WebView identity changed'
 receipt['snapshot']={'avd':avd,'name':snapshot,'loaded':True};receipt['apiLevel']=adb('shell','getprop','ro.build.version.sdk').strip()
 wellbeing='com.google.android.apps.wellbeing'
 if 'package:'+wellbeing in adb('shell','pm','list','packages',wellbeing):adb('shell','pm','disable-user','--user','0',wellbeing)
 adb('logcat','-c');adb('install',str(a.apk.resolve()),timeout=120);launch();catalog_settings()
 replace_text(nodes,lambda v:ui._device(className='android.widget.EditText',packageName='dev.construct.runtime').set_text(v),a.catalog)
 apply_catalog();find('Catalog refreshed.');select_after(heading,('Review & install',));tap('Allow & install');installed_status()
 events=diagnostics();assert any(e.get('code')=='INSTALLED_TRIAL' and e.get('packageDigest')==a.module_sha for e in events),'Wrong signed module'
 library();select_after(heading,('Open',));find('Take a photo');action('Open private album');expect('[CAPABILITY_DENIED]');action('Take a photo');expect('[CAPABILITY_DENIED]')
 done('Fresh module cannot open private album or capture without new grants')
 tap('Construct menu');tap('Module access');find('Reopen module')
 for label in ['Allow taking private photos','Allow this module’s private photo library','Allow selected image pixels','Allow local face and object detection']:grant(label)
 tap_node(reach('Allow Android camera access',True));find('While using the app');tap('While using the app');find('Android camera access: allowed')
 tap_node(reach('Reopen module',True));find('Take a photo');action('Take a photo');expect('Camera preview ready.',60);display('native-capture')
 tap('Cancel capture');find('Take a photo');expect('Capture canceled.')
 action('Open private album');expect('No private photos yet.');done('Native capture can cancel without creating a private photo')
 action('Take a photo');expect('Camera preview ready.',60);tap('Take photo');expect('Private photo ready.',60);expect('Private photo 1 of 1');display('captured-photo')
 done('Real synthetic CameraX shutter returns to the module-owned private album')
 action('Delete private photo');find('Delete this private photo?');display('trusted-delete');tap('Cancel');expect('Canceled. Private photo unchanged.')
 action('Delete private photo');find('Delete this private photo?');tap('Delete photo');expect('No private photos yet.');done('Deletion requires a native image confirmation; cancel preserves the original')
 adb('shell','am','force-stop','dev.construct.runtime');root()
 assert not adb('shell','ls','-A',folder).strip(),'Refuse overwrite of private data'
 owner=adb('shell','stat','-c','%u:%g',folder).strip();assert re.fullmatch(r'[1-9][0-9]{4,}:[1-9][0-9]{4,}',owner)
 from PIL import Image
 fixtures=CONFIG.root/'vision-fixtures';locked=json.loads((fixtures/'vision-assets.json').read_text())
 for entry in locked:
  if entry['kind']=='fixture':assert hashlib.sha256((fixtures/entry['name']).read_bytes()).hexdigest()==entry['sha256']
 astronaut=Image.open(fixtures/'astronaut.png').convert('RGB')
 pictures=[Image.open(fixtures/'chelsea.png').convert('RGB'),Image.new('RGB',(512,512),'white'),astronaut.rotate(90,expand=True),astronaut]
 hashes={}
 for i,image in enumerate(pictures,1):
  name='00000000-0000-4000-8000-%012d.jpg'%i;local=run/name;exif=Image.Exif();exif[274]=6 if i==3 else 1;image.save(local,'JPEG',quality=95,exif=exif)
  hashes[name]=hashlib.sha256(local.read_bytes()).hexdigest();adb('push',str(local),folder+name);adb('shell','chown',owner,folder+name);adb('shell','chmod','600',folder+name);adb('shell','restorecon',folder+name);adb('shell','touch','-t','202001010000.00',folder+name)
 unroot();adb('shell','cmd','connectivity','airplane-mode','enable');adb('shell','svc','wifi','disable');adb('shell','svc','data','disable');assert adb('shell','settings','get','global','airplane_mode_on').strip()=='1'
 opened();action('Open private album');expect('Private photo 4 of 4');measure('faces','1','astronaut-cold');measure('objects','person','astronaut-cold')
 done('Offline saved-photo face/object inference returns module-rendered estimates')
 for i in range(2):measure('faces','1','astronaut-warm-'+str(i))
 action('Previous photo');expect('Private photo 3 of 4');measure('faces','1','exif-oriented')
 action('Previous photo');expect('Private photo 2 of 4');measure('faces','0','blank')
 action('Previous photo');expect('Private photo 1 of 4');measure('objects','cat','cat')
 done('EXIF, blank and object fixtures work through the same bounded image pipeline')
 for rotation in ('0','1'):
  adb('shell','settings','put','system','user_rotation',rotation);time.sleep(2);action('Find objects');expect('Analysis complete. Original unchanged.');display('layout-'+rotation)
  adb('shell','settings','put','system','font_scale','2.0');time.sleep(2);action('Find objects');expect('Analysis complete. Original unchanged.');display('large-'+rotation);adb('shell','settings','put','system','font_scale','1.0')
 adb('shell','settings','put','system','user_rotation','0');done('Photo and analysis controls operate in both orientations and two-times text')
 action('Save to phone gallery');find('Save this photo to phone gallery?');tap('Cancel');expect('Canceled. Private photo unchanged.')
 action('Save to phone gallery');find('Save this photo to phone gallery?');tap('Save copy');expect('Copy saved to phone gallery.');done('Gallery export requires native confirmation and preserves private original')
 adb('shell','input','keyevent','3');time.sleep(3);opened();expect('No photo selected');action('Open private album');expect('Private photo 4 of 4');done('Background clears transient display and preserves private album')
 tap('Construct menu');tap('Module access');find('Reopen module');label='Allow local face and object detection';tap_node(reach(label,True));tap('Turn off');find(label+': off.');tap_node(reach('Reopen module',True));find('Take a photo');action('Open private album');expect('Private photo 4 of 4');action('Find faces');expect('[CAPABILITY_DENIED]');done('Inference grant is independently revocable without losing photos')
 adb('shell','am','force-stop','dev.construct.runtime');root()
 for name,digest in hashes.items():assert hashlib.sha256(adb('exec-out','cat',folder+name,binary=True)).hexdigest()==digest,'Private original changed'
 unroot();done('Original private photo bytes unchanged after inference, lifecycle and export')
 receipt['complete']=True
except Exception as e:
 receipt['error']=str(e)
 try:(run/'failure-nodes.json').write_text(json.dumps([dict(n.attrib) for n in nodes()],indent=2));display('failure')
 except Exception:pass
 raise
finally:
 if started:
  if rooted:unroot()
  adb('shell','settings','put','system','font_scale','1.0');adb('shell','settings','put','system','user_rotation','0')
  adb('shell','cmd','connectivity','airplane-mode','disable');adb('shell','svc','wifi','enable');adb('shell','svc','data','enable')
  try:(run/'runtime.log').write_text(adb('logcat','-d','-t','6000'));(run/'crash-buffer.txt').write_text(adb('logcat','-b','crash','-d'))
  except Exception:pass
  subprocess.run([str(CONFIG.root/'runner.sh'),'stop'],check=True);receipt['stopped']=subprocess.run(['systemctl','--user','is-active','--quiet',CONFIG.service]).returncode!=0
 (CONFIG.root/'camera-emulated.flag').unlink(missing_ok=True);save();print(json.dumps(receipt,indent=2),flush=True)
