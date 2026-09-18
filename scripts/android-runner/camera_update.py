#!/usr/bin/env python3
"""Signed Camera module update/rollback proof on a disposable emulator.
Debug timing evidence is explicitly distinct from optimized artifact acceptance.
"""
import argparse,datetime,fcntl,hashlib,json,os,re,subprocess,time,uuid
from pathlib import Path
from config import CONFIG,SERIAL,require_runner,catalog
p=argparse.ArgumentParser();p.add_argument('--apk',type=Path,required=True);p.add_argument('--sha',required=True)
p.add_argument('--catalog',required=True);p.add_argument('--module-sha',required=True);p.add_argument('--module-version',default='0.2.0')
p.add_argument('--old-module-sha',required=True);p.add_argument('--prototype',action='store_true');a=p.parse_args();require_runner();catalog(a.catalog)
assert hashlib.sha256(a.apk.read_bytes()).hexdigest()==a.sha,'APK checksum mismatch'
lock=(CONFIG.root/'suite.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
assert subprocess.run(['systemctl','--user','is-active','--quiet',CONFIG.service]).returncode!=0,'Preserve running emulator'
assert not any(x.startswith(SERIAL+'\t') for x in subprocess.check_output([str(CONFIG.sdk/'platform-tools/adb'),'devices'],text=True).splitlines()),'Preserve occupied port'
run=CONFIG.root/'results'/(datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-camera-update-'+uuid.uuid4().hex[:8]);run.mkdir(parents=True)
os.environ['CONSTRUCT_RESULTS']=str(run)
import ui
from ui import adb,nodes,labels,tap,tap_node,find,capture
from host_ui import host_ready,catalog_settings,apply_catalog,library,select_after,installed_status,diagnostics
from catalog_input import replace_text
from adb_identity import restore_shell_identity
receipt={'complete':False,'stopped':False,'prototypeDebug':a.prototype,'apkSha256':a.sha,'moduleSha256':a.module_sha,'oldModuleSha256':a.old_module_sha,'oldModuleVersion':'0.2.0','newModuleVersion':a.module_version,'checks':[],'timings':[]}
started=False;rooted=False
heading='Pocket Camera · 0.2.0'
folder='/data/user/0/dev.construct.runtime/files/camera-photos/dev.construct.camera/'
def save():(run/'result.json').write_text(json.dumps(receipt,indent=2)+'\n')
def done(name):receipt['checks'].append(name);save();print('PASS:',name,flush=True)
def display(name):
 capture(name);target=run/(name+'-display');target.mkdir();adb('emu','screenrecord','screenshot',str(target))
 assert len(list(target.glob('*.png')))==1,'Missing secure-console capture'
def expect(prefix,timeout=35):
 until=time.monotonic()+timeout;begin=time.monotonic()
 while time.monotonic()<until:
  texts=labels();match=next((x for x in texts if x.startswith(prefix)),None)
  if match:return match
  if any('[IMAGE_ANALYSIS_UNAVAILABLE]' in x or '[JAVASCRIPT_ERROR]' in x for x in texts):raise RuntimeError('Inference or module failure')
  if time.monotonic()-begin>2 and not prefix.startswith('Camera preview'):
   n=reach(prefix,prefix=True);return n.get('text') or n.get('content-desc')
  time.sleep(.25)
 raise RuntimeError('Missing: '+prefix)
def finish_analysis(timeout=60):
 # Status is in the scrollable panel, not guaranteed to remain in the accessibility tree.
 until=time.monotonic()+timeout
 while time.monotonic()<until:
  texts=labels()
  if any(t.startswith('Analysis complete. Original unchanged.') for t in texts):return
  errors=[t for t in texts if t.startswith('[')]
  if errors:raise RuntimeError('Analysis failed: '+errors[0])
  if not any(t.startswith('Finding ') for t in texts):
   w,h=ui._device.window_size();x=int(w*(.8 if w>h else .45));top=int(h*(.3 if w>h else .63))
   adb('shell','input','swipe',str(x),str(top),str(x),str(int(h*.9)),'250')
  time.sleep(.3)
 raise RuntimeError('Analysis status did not become visible')

def reach(label,host=False,prefix=False):
 previous=None
 top_first=prefix and label.startswith(('[','Private photo ready','Capture canceled','No private photos','Copy saved','Canceled.'))
 for i in range(24):
  ns=nodes();w,h=ui._device.window_size();panel=[0,0,w,h]
  if host:
   controls=next((n for n in ns if n.get('content-desc')=='Capture controls'),None)
   if controls is not None:
    bounds=list(map(int,re.findall(r'-?\d+',controls.get('bounds',''))))
    if len(bounds)==4 and bounds[2]>bounds[0] and bounds[3]>bounds[1]:panel=bounds
  if not host:
   photo=next((n for n in ns if 'Selected photo with estimated detection boxes' in (n.get('text'),n.get('content-desc'))),None)
   if photo is not None:
    b=list(map(int,re.findall(r'-?\d+',photo.get('bounds',''))))
    if len(b)==4:panel=[b[2],b[1],w,h] if w>h else [0,b[3],w,h]
  matches=[n for n in ns if (any((n.get(k) or '').startswith(label) for k in ('text','content-desc')) if prefix else label in (n.get('text'),n.get('content-desc'))) and n.get('package')=='dev.construct.runtime']
  toward_top=None;settling=False
  for n in matches:
   b=list(map(int,re.findall(r'-?\d+',n.get('bounds',''))))
   if len(b)!=4:continue
   if panel[0]<=b[0]<b[2]<=panel[2] and panel[1]<=b[1]<b[3]<=panel[3]:
    if previous==n.get('bounds'):return n
    previous=n.get('bounds');settling=True;break
   if b[1]<panel[1]:toward_top=True
   elif b[3]>panel[3]:toward_top=False
  if not settling:
   x=(panel[0]+panel[2])//2;top=panel[1]+int((panel[3]-panel[1])*.2);bottom=panel[3]-int((panel[3]-panel[1])*.15)
   if toward_top is None:toward_top=top_first if i<12 else not top_first
   first,last=(top,bottom) if toward_top else (bottom,top)
   adb('shell','input','swipe',str(x),str(first),str(x),str(last),'250');previous=None
  time.sleep(.3)
 raise RuntimeError('Control not reachable inside its visible panel: '+label)
def action(label):tap_node(reach(label))
def launch():adb('shell','am','start','-n','dev.construct.runtime/.MainActivity');host_ready()
def opened():
 launch();library();select_after(heading,('Open',));find('Take a photo')
def grant(label):
 n=reach(label,True)
 matches=[n for n in nodes() if n.get('content-desc')==label and n.get('checkable')=='true']
 assert len(matches)==1 and matches[0].get('checked')=='false','Fresh grant not off: '+label
 tap_node(matches[0])
 deadline=time.monotonic()+10
 while time.monotonic()<deadline:
  if any(n.get('content-desc')==label and n.get('checkable')=='true' and n.get('checked')=='true' for n in nodes()):return
  time.sleep(.25)
 raise RuntimeError('Grant did not become checked: '+label)
def no_camera_client():
 until=time.monotonic()+12
 while time.monotonic()<until:
  section=adb('shell','dumpsys','media.camera').split('Active Camera Clients:',1)
  assert len(section)==2,'Missing active-client section'
  if 'dev.construct.runtime' not in section[1].split('\n\n',1)[0]:return
  time.sleep(.3)
 raise RuntimeError('Capture retained a live camera client')

def root():
 global rooted
 assert adb('shell','getprop','ro.kernel.qemu').strip()=='1' and adb('shell','getprop','ro.build.type').strip()=='userdebug','Disposable image required'
 adb('root');adb('wait-for-device');rooted=True;assert adb('shell','id','-u').strip()=='0'
def unroot():
 global rooted
 restore_shell_identity(adb);rooted=False

def prototype_evaluate(expression):
 if not a.prototype:return None
 import urllib.request,websocket
 pid=adb('shell','pidof','dev.construct.runtime').strip();assert pid.isdigit(),'Expected one app process'
 adb('forward','tcp:9224','localabstract:webview_devtools_remote_'+pid)
 try:
  with urllib.request.urlopen('http://127.0.0.1:9224/json',timeout=5) as response:pages=json.load(response)
  page=next(p for p in pages if p.get('url','').startswith('https://dev.construct.camera.construct.invalid/'))
  ws=websocket.create_connection(page['webSocketDebuggerUrl'],timeout=60,suppress_origin=True)
  try:
   ws.send(json.dumps({'id':1,'method':'Runtime.evaluate','params':{'expression':expression,'returnByValue':True,'awaitPromise':True}}))
   while True:
    result=json.loads(ws.recv())
    if result.get('id')==1:return json.loads(result['result']['result']['value'])
  finally:ws.close()
 finally:adb('forward','--remove','tcp:9224')

def prototype_metrics():
 return prototype_evaluate('JSON.stringify(window.cameraMetrics)')

def controlled_probe():
 if not a.prototype:return
 # No accessibility dumps, screenshots or native-driver polling during these samples.
 expression="""(async()=>{
  const wait=ms=>new Promise(r=>setTimeout(r,ms));
  async function baseline(painting){
   const gaps=[];let previous=performance.now(),start=previous;
   await new Promise(resolve=>{const tick=now=>{gaps.push(now-previous);previous=now;
    if(painting)schedulePaint();if(now-start<2000)requestAnimationFrame(tick);else resolve();};requestAnimationFrame(tick);});
   gaps.sort((a,b)=>a-b);return {frames:gaps.length,maxGapMs:gaps.at(-1),medianGapMs:gaps[Math.floor(gaps.length/2)]};
  }
  const result={idle:await baseline(false),canvasOnly:await baseline(true),inference:[]};
  for(const kind of ['faces','objects','faces','objects']){
   await wait(1200);const start=performance.now();await document.getElementById(kind).onclick();
   if(window.cameraMetrics?.kind!==kind||!document.getElementById('status').textContent.startsWith('Analysis complete.'))throw Error('Controlled inference failed');
   await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
   result.inference.push({...window.cameraMetrics,throughNextPaintMs:performance.now()-start});
  }
  return JSON.stringify(result);
 })()"""
 receipt['controlledFrameProbe']=prototype_evaluate(expression);save()

def measure(kind,expected,index):
 action('Find '+kind);finish_analysis()
 node=reach(kind.title()+' found:',prefix=True);text=node.get('text') or node.get('content-desc')
 if kind=='faces':assert re.match(r'Faces found: '+re.escape(expected)+r'(?:$|\D)',text),(kind,text)
 else:assert any(expected in item for item in labels()),(kind,labels())
 node=reach('Local processing:',prefix=True);timing=node.get('text') or node.get('content-desc');match=re.fullmatch(r'Local processing: (\d+) ms · Ready in (\d+) ms',timing)
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
 adb('shell','settings','put','system','accelerometer_rotation','0')
 adb('logcat','-c');adb('install',str(a.apk.resolve()),timeout=120);launch();catalog_settings()
 replace_text(nodes,lambda v:ui._device(className='android.widget.EditText',packageName='dev.construct.runtime').set_text(v),a.catalog)
 apply_catalog();find('Catalog refreshed.');select_after(heading,('Review & install',));tap('Allow & install');installed_status()
 events=diagnostics();assert any(e.get('code')=='INSTALLED_TRIAL' and e.get('packageDigest')==a.old_module_sha for e in events),'Wrong signed module'
 library();select_after(heading,('Open',));find('Take a photo');action('Open private album');expect('[CAPABILITY_DENIED]');action('Take a photo');expect('[CAPABILITY_DENIED]')
 done('Fresh module cannot open private album or capture without new grants')
 tap('Construct menu');tap('Module access');find('Module access')
 for label in ['Allow taking private photos','Allow this module’s private photo library','Allow selected image pixels','Allow local face and object detection']:grant(label)
 tap_node(reach('Allow Android camera access',True));find('While using the app');tap('While using the app');find('Android camera access: allowed')
 tap_node(reach('Reopen module',True));find('Take a photo');action('Take a photo');expect('Camera preview ready.',60);display('native-capture')
 def connected_camera():
  dump=adb('shell','dumpsys','media.camera');active=dump.split('Active Camera Clients:',1)[1].split('Allowed user IDs:',1)[0]
  assert 'dev.construct.runtime' in active,'No active Construct capture client'
  matches=re.findall(r'Camera ID:\s*([^,]+),[^\n]*Client Package Name:\s*dev\.construct\.runtime(?:,|\))',active)
  assert len(matches)==1,'Expected one active Construct camera descriptor';return matches[0].strip()
 original_camera=connected_camera()
 for expected in (None,original_camera):
  tap('Switch camera');deadline=time.monotonic()+30
  while time.monotonic()<deadline:
   try:
    selected=connected_camera()
    if (selected!=original_camera if expected is None else selected==expected):break
   except AssertionError:pass
   time.sleep(.3)
  else:raise RuntimeError('Camera selector did not change the active camera device')
  expect('Camera preview ready.',60)
 display('native-camera-switched-back')
 done('Native camera switching binds the other synthetic device and returns to the original')
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
 def installed_apk():
  paths=adb('shell','pm','path','dev.construct.runtime').splitlines();assert len(paths)==1 and paths[0].startswith('package:/data/app/')
  digest=adb('shell','sha256sum',paths[0].removeprefix('package:')).split()[0];assert digest==a.sha
  return digest
 def inspect_cat(label):
  opened();action('Open private album');expect('Private photo 4 of 4')
  for position in (3,2,1):action('Previous photo');expect('Private photo '+str(position)+' of 4')
  measure('objects','cat',label)
 receipt['installedApkHashes']=[installed_apk()]
 inspect_cat('before-update');assert 'Minimum detection score' not in labels()
 tap('Construct menu');tap('Mark working');library()
 adb('shell','cmd','connectivity','airplane-mode','disable');adb('shell','svc','wifi','enable');adb('shell','svc','data','enable')
 heading='Pocket Camera · '+a.module_version
 select_after(heading,('Review & install',));tap('Allow & install');installed_status()
 events=diagnostics();assert any(e.get('code')=='INSTALLED_TRIAL' and e.get('packageDigest')==a.module_sha for e in events)
 receipt['installedApkHashes'].append(installed_apk())
 adb('shell','cmd','connectivity','airplane-mode','enable');adb('shell','svc','wifi','disable');adb('shell','svc','data','disable')
 inspect_cat('after-update');action('50% or higher');tap('90% or higher')
 node=reach('Objects found:',prefix=True);assert 'showing 0' in (node.get('text') or node.get('content-desc'))
 display('module-only-filtered');action('90% or higher');tap('50% or higher')
 node=reach('Objects found:',prefix=True);assert 'showing 1' in (node.get('text') or node.get('content-desc'))
 display('module-only-restored')
 done('Signed module update adds working score filtering on identical installed APK bytes')
 tap('Construct menu');tap('Close module');library();select_after(heading,('Roll back',));tap('Restore');library()
 heading='Pocket Camera · 0.2.0';receipt['installedApkHashes'].append(installed_apk())
 inspect_cat('after-rollback');assert 'Minimum detection score' not in labels()
 adb('shell','am','force-stop','dev.construct.runtime');root()
 for name,digest in hashes.items():assert hashlib.sha256(adb('exec-out','cat',folder+name,binary=True)).hexdigest()==digest,'Private original changed'
 unroot();done('Supported rollback restores previous controls and offline inference with original photos and APK unchanged')
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
