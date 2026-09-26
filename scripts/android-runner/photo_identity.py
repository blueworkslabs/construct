#!/usr/bin/env python3
"""API 0.12 stable private-photo ID acceptance on a disposable synthetic-camera emulator.
Ties every observation to one APK and three signed fixture versions of
dev.construct.photo-identity: 0.1.0 (API 0.11, legacy shape), 0.2.0 and 0.3.0 (API 0.12).
Cross-module non-correlation is a JVM check (PhotoIdentityTest), not claimed here.
"""
import argparse,datetime,fcntl,hashlib,json,os,re,subprocess,time,uuid
from pathlib import Path
from config import CONFIG,SERIAL,require_runner,catalog
p=argparse.ArgumentParser();p.add_argument('--apk',type=Path,required=True);p.add_argument('--sha',required=True)
p.add_argument('--catalog',required=True);p.add_argument('--legacy-sha',required=True,help='0.1.0 package digest (API 0.11)')
p.add_argument('--module-sha',required=True,help='0.2.0 package digest (API 0.12)');p.add_argument('--update-sha',required=True,help='0.3.0 package digest (API 0.12)')
a=p.parse_args();require_runner();catalog(a.catalog)
assert hashlib.sha256(a.apk.read_bytes()).hexdigest()==a.sha,'APK checksum mismatch'
lock=(CONFIG.root/'suite.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
assert subprocess.run(['systemctl','--user','is-active','--quiet',CONFIG.service]).returncode!=0,'Preserve running emulator'
assert not any(x.startswith(SERIAL+'\t') for x in subprocess.check_output([str(CONFIG.sdk/'platform-tools/adb'),'devices'],text=True).splitlines()),'Preserve occupied port'
run=CONFIG.root/'results'/(datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-photo-identity-'+uuid.uuid4().hex[:8]);run.mkdir(parents=True)
os.environ['CONSTRUCT_RESULTS']=str(run)
import ui
from ui import adb,nodes,labels,tap,tap_node,find,capture
from host_ui import host_ready,catalog_settings,apply_catalog,library,select_after,installed_status,diagnostics
from catalog_input import replace_text
from adb_identity import restore_shell_identity
receipt={'complete':False,'stopped':False,'apkSha256':a.sha,'moduleSha256':{'0.1.0':a.legacy_sha,'0.2.0':a.module_sha,'0.3.0':a.update_sha},
 'crossModule':'JVM only (PhotoIdentityTest)','checks':[],'idsObserved':[]}
started=False;rooted=False
name='Photo identity probe';heading=name+' · 0.1.0'
folder='/data/user/0/dev.construct.runtime/files/camera-photos/dev.construct.photo-identity/'
key=folder+'.identity-key'
seen=set()
def save():(run/'result.json').write_text(json.dumps(receipt,indent=2)+'\n')
def done(text):receipt['checks'].append(text);save();print('PASS:',text,flush=True)
def status():
 for text in labels():
  m=re.fullmatch(r'(.*) #(\d+)',text or '',re.S)
  if m:return m[1],int(m[2])
 raise RuntimeError('Fixture status not visible')
def act(label,wait=True,timeout=40):
 _,before=status();tap(label)
 if not wait:return before
 return result(before,timeout)
def result(before,timeout=40):
 until=time.monotonic()+timeout
 while time.monotonic()<until:
  try:
   text,n=status()
   if n>before:return text
  except RuntimeError:pass
  time.sleep(.25)
 raise RuntimeError('No fixture result after '+str(before))
def listed():
 texts=labels();count=next((int(t.split(': ')[1]) for t in texts if re.fullmatch(r'Photo count: \d+',t or '')),None)
 assert count is not None,'Missing photo count'
 ids=[m[2] for m in (re.fullmatch(r'ID (\d+): (not provided|[\x21-\x7e]+)',t or '') for t in texts) if m]
 assert len(ids)==count,('Every listed photo must be rendered',count,ids)
 receipt['idsObserved'].append(ids);save();return ids
def list_ids():
 assert act('List photos')=='Listed.';return listed()
def stable(ids):
 assert all(re.fullmatch(r'[\x21-\x7e]{1,80}',i) for i in ids) and len(set(ids))==len(ids),ids;return ids
def launch():adb('shell','am','start','-n','dev.construct.runtime/.MainActivity');host_ready()
def opened():launch();library();select_after(heading,('Open',));find('List photos')
def module_access():tap('Construct menu');tap('Module access');find('Module access')
def reopen():
 n=next((n for n in nodes() if (n.get('text') or n.get('content-desc'))=='Reopen module'),None)
 for _ in range(12):
  if n is not None:break
  adb('shell','input','swipe','360','1000','360','500','250');time.sleep(.3)
  n=next((n for n in nodes() if (n.get('text') or n.get('content-desc'))=='Reopen module'),None)
 assert n is not None,'Reopen module not reachable';tap_node(n);find('List photos')
def switch(label,checked):
 for _ in range(12):
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
def shoot():
 before=act('Capture a photo',wait=False);find('Take photo',60)
 until=time.monotonic()+60
 while time.monotonic()<until and not any((t or '').startswith('Camera preview ready.') for t in labels()):time.sleep(.3)
 tap('Take photo');assert result(before,60)=='Captured and listed.'
def root():
 global rooted
 assert adb('shell','getprop','ro.kernel.qemu').strip()=='1' and adb('shell','getprop','ro.build.type').strip()=='userdebug','Disposable image required'
 adb('root');adb('wait-for-device');rooted=True;assert adb('shell','id','-u').strip()=='0'
def unroot():
 global rooted
 restore_shell_identity(adb);rooted=False
def has_key():return adb('shell','ls','-A',folder).split().count('.identity-key')==1
def install(version,digest,choice='Review & install'):
 global heading
 library();select_after(name+' · '+version,(choice,));tap('Allow & install');installed_status();heading=name+' · '+version
 assert any(e.get('code')=='INSTALLED_TRIAL' and e.get('packageDigest')==digest for e in diagnostics()),'Wrong signed module '+version
def installed_apk():
 paths=adb('shell','pm','path','dev.construct.runtime').splitlines();assert len(paths)==1 and paths[0].startswith('package:/data/app/')
 assert adb('shell','sha256sum',paths[0].removeprefix('package:')).split()[0]==a.sha,'Installed APK changed'

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
 assert 'uid=2000(shell)' in adb('shell','id'),'Expected unprivileged ADB'
 receipt['snapshot']={'avd':avd,'name':snapshot,'loaded':True};receipt['apiLevel']=adb('shell','getprop','ro.build.version.sdk').strip()
 adb('shell','settings','put','system','accelerometer_rotation','0')
 adb('logcat','-c');adb('install',str(a.apk.resolve()),timeout=120);launch();catalog_settings()
 replace_text(nodes,lambda v:ui._device(className='android.widget.EditText',packageName='dev.construct.runtime').set_text(v),a.catalog)
 apply_catalog();find('Catalog refreshed.');install('0.1.0',a.legacy_sha)
 library();select_after(heading,('Open',));find('List photos')
 assert act('List photos').startswith('[CAPABILITY_DENIED]');assert not any(re.fullmatch(r'ID \d+: .*',t or '') for t in labels())
 module_access()
 for label in ['Allow taking private photos','Allow this module’s private photo library','Allow selected image pixels']:switch(label,True)
 n=next((n for n in nodes() if n.get('text')=='Allow Android camera access'),None)
 if n is not None:tap_node(n);find('While using the app');tap('While using the app');find('Android camera access: allowed')
 reopen();done('Denied listing publishes no IDs before grants')

 # Legacy (API 0.11) photos: one real shutter capture plus two byte-identical synthetic originals.
 shoot();assert listed()==['not provided']
 adb('shell','am','force-stop','dev.construct.runtime');root()
 owner=adb('shell','stat','-c','%u:%g',folder).strip();assert re.fullmatch(r'[1-9][0-9]{4,}:[1-9][0-9]{4,}',owner)
 from PIL import Image
 local=run/'identical.jpg';Image.new('RGB',(320,240),'white').save(local,'JPEG',quality=90)
 hashes={}
 for i in (1,2):
  f='00000000-0000-4000-8000-%012d.jpg'%i;adb('push',str(local),folder+f)
  for c in (['chown',owner],['chmod','600'],['restorecon'],['touch','-t','202001010000.00']):adb('shell',*c,folder+f)
  hashes[f]=hashlib.sha256(local.read_bytes()).hexdigest()
 assert not has_key(),'API 0.11 must not allocate identity';unroot()
 opened();assert list_ids()==['not provided']*3
 adb('shell','am','force-stop','dev.construct.runtime');root();assert not has_key(),'API 0.11 listing allocated identity';unroot()
 done('API 0.11 module keeps the legacy list shape and allocates no identity')

 opened();tap('Construct menu');tap('Mark working');install('0.2.0',a.module_sha)
 opened();first=stable(list_ids());assert len(first)==3;seen.update(first)
 adb('shell','am','force-stop','dev.construct.runtime');root();assert has_key();unroot()
 done('Update to API 0.12 backfills distinct IDs for legacy and byte-identical originals')
 opened();assert list_ids()==first and list_ids()==first
 adb('shell','am','force-stop','dev.construct.runtime');opened();assert list_ids()==first
 done('IDs are unchanged across repeated list and process restart')

 assert act('Use first ID as ref').startswith('[PHOTO_STALE]');assert list_ids()==first
 done('A stable ID is rejected as open authority')

 tap('Construct menu');tap('Mark working');install('0.3.0',a.update_sha)
 opened();assert list_ids()==first;tap('Construct menu');tap('Close module')
 library();select_after(heading,('Roll back',));tap('Restore');library();heading=name+' · 0.2.0'
 opened();assert list_ids()==first;installed_apk()
 done('IDs survive signed module update and rollback on identical APK bytes')

 module_access();switch('Allow this module’s private photo library',False);reopen()
 assert act('List photos').startswith('[CAPABILITY_DENIED]');assert not any(re.fullmatch(r'ID \d+: .*',t or '') for t in labels())
 module_access();switch('Allow this module’s private photo library',True);reopen();assert list_ids()==first
 done('Revoked library grant lists nothing; restored grant returns the same IDs')

 adb('shell','am','force-stop','dev.construct.runtime');root()
 saved=adb('exec-out','cat',key,binary=True);assert len(saved)==32
 adb('shell','truncate','-s','12',key);unroot()
 opened();assert act('List photos').startswith('[PHOTO_FAILED]'),'Damaged identity must fail, not list'
 assert not any(re.fullmatch(r'Photo count: \d+',t or '') for t in labels())
 adb('shell','am','force-stop','dev.construct.runtime');root()
 assert adb('shell','stat','-c','%s',key).strip()=='12','Host re-keyed silently'
 restore=run/'identity-key.bin';restore.write_bytes(saved);adb('push',str(restore),key)
 for c in (['chown',owner],['chmod','600'],['restorecon']):adb('shell',*c,key)
 restore.unlink();unroot()
 opened();assert list_ids()==first
 done('Damaged identity storage fails the list without re-keying; restored key returns the same IDs')

 before=act('Delete first photo',wait=False);find('Delete this private photo?');capture('trusted-delete');tap('Delete photo')
 assert result(before,30)=='Deleted and listed.';after=listed();assert after==first[1:],(first,after)
 shoot();now=stable(listed());fresh=[i for i in now if i not in after];assert len(fresh)==1 and fresh[0] not in seen,'Recapture reused an ID';seen.update(now)
 done('Deletion retires an ID; recapture receives a new ID')

 module_access()
 for _ in range(12):
  if 'Delete all saved photos' in labels():break
  adb('shell','input','swipe','360','1000','360','500','250');time.sleep(.3)
 tap('Delete all saved photos');find('Delete all saved photos?');tap('Delete permanently');find('Saved photos deleted.')
 reopen();assert list_ids()==[]
 shoot();shoot();now=stable(listed());assert len(now)==2 and not set(now)&seen,'Clear-all and recapture reused an ID'
 done('Native clear-all retires IDs; new captures never reuse them')

 adb('shell','am','force-stop','dev.construct.runtime');root()
 for f in hashes:
  assert f not in adb('shell','ls','-A',folder).split(),'Cleared original survived'
 unroot();installed_apk()
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
    if rooted:unroot()
    try:(run/'runtime.log').write_text(adb('logcat','-d','-t','6000'));(run/'crash-buffer.txt').write_text(adb('logcat','-b','crash','-d'))
    except Exception:pass
   finally:
    subprocess.run([str(CONFIG.root/'runner.sh'),'stop'],check=True)
    receipt['stopped']=subprocess.run(['systemctl','--user','is-active','--quiet',CONFIG.service]).returncode!=0
 finally:
  (CONFIG.root/'camera-emulated.flag').unlink(missing_ok=True);save();print(json.dumps(receipt,indent=2),flush=True)
