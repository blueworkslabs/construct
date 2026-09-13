#!/usr/bin/env python3
"""Inject renderer process loss on the isolated emulator; never a module capability."""
from config import CONFIG, SERIAL, require_runner
import json
import socket
import time
from ui import adb, labels, tap, find, capture, RESULTS
from host_ui import restart, diagnostics

require_runner()
RESULTS.mkdir(parents=True, exist_ok=True)
result = {'complete':False, 'verdict':'FAIL', 'method':'ADB root on userdebug emulator; exact isolated renderer PID SIGKILL'}
rooted = False

def renderers():
    lines = adb('shell','ps','-A','-o','PID,UID,ARGS').splitlines()
    candidates = {}
    for line in lines[1:]:
        fields = line.split(None, 2)
        if len(fields) != 3: continue
        pid, uid, args = fields
        if 'com.google.android.webview:sandboxed_process' not in args or 'SandboxedProcessService' not in args: continue
        if not pid.isdigit(): raise RuntimeError('Invalid renderer PID')
        if not (uid.startswith('u0_i') or (uid.isdigit() and 90000 <= int(uid) <= 99999)):
            raise RuntimeError('Renderer is not an isolated UID')
        candidates[pid] = {'uid':uid, 'args':args}
    return candidates

try:
    if adb('shell','getprop','ro.build.type').strip() != 'userdebug': raise RuntimeError('Requires disposable userdebug emulator')
    if not adb('shell','getprop','ro.kernel.qemu').strip() == '1': raise RuntimeError('Not an emulator')
    # No wildcard kill: host restart clears the previous view and we require a
    # single newly created isolated WebView renderer after opening the checklist.
    restart()
    baseline = {json.dumps(e,sort_keys=True) for e in diagnostics()}
    time.sleep(2)
    before = renderers()
    tap('Open')
    find('Pocket Checklist')
    find('Ready. Works offline once installed.')
    deadline=time.monotonic()+15
    while True:
        candidates=renderers()
        new={pid:info for pid,info in candidates.items() if pid not in before}
        if len(new)==1: break
        if time.monotonic()>deadline: raise RuntimeError('Cannot uniquely identify newly created WebView renderer')
        time.sleep(.5)
    target=next(iter(new))
    host_pid=adb('shell','pidof','dev.construct.runtime').strip()
    if target in host_pid.split(): raise RuntimeError('Refusing host-process kill')
    result['renderer']={'pid':target, **new[target]}
    result['hostPid']=host_pid
    adb('root',timeout=30); rooted=True
    adb('wait-for-device',timeout=30)
    if adb('shell','id','-u').strip() != '0': raise RuntimeError('Emulator ADB root unavailable')
    current=renderers()
    if current.get(target) != new[target]: raise RuntimeError('Renderer identity changed before injection')
    adb('shell','kill','-9',target)
    # The host, not a test restart, must handle renderer death and expose recovery.
    find('[RENDERER_STOPPED] Module stopped. Retry, remove, or restore previous code from Installed.')
    if adb('shell','pidof','dev.construct.runtime').strip() != host_pid:
        raise RuntimeError('Host process restarted during renderer loss')
    if 'Mark working' in labels(): raise RuntimeError('Failed renderer is still markable')
    capture('renderer-stopped')
    fresh=[e for e in diagnostics() if json.dumps(e,sort_keys=True) not in baseline]
    if not any(e.get('source')=='host' and e.get('code')=='RENDERER_STOPPED' and e.get('moduleId')=='dev.construct.checklist' for e in fresh):
        raise RuntimeError('No native renderer-loss event')
    result['events']=fresh
    tap('Retry'); find('Pocket Checklist')
    try: find('Emulator-item',timeout=4)
    except RuntimeError:
        adb('shell','input','swipe','360','1100','360','800','300')
        adb('shell','input','swipe','360','800','360','1100','300')
        find('Emulator-item',timeout=10)
    if adb('shell','pidof','dev.construct.runtime').strip() != host_pid:
        raise RuntimeError('Host process changed while recovering')
    capture('renderer-recovered'); tap('Close module')
    result.update(complete=True, verdict='CONTAINED', reason='Renderer loss handled without host restart; retry retained item')
except Exception as error:
    result['error']=str(error)
    try: capture('renderer-failure')
    except Exception: pass
    raise
finally:
    if rooted:
        try:
            adb('unroot',timeout=30); adb('wait-for-device',timeout=30)
            result['adbUnrooted']=adb('shell','id','-u').strip() != '0'
            if not result['adbUnrooted']: result.update(complete=False,verdict='FAIL')
        except Exception as error: result.update(complete=False,verdict='FAIL',cleanupError=str(error))
    (RESULTS/'renderer-result.json').write_text(json.dumps(result,indent=2)+'\n')
    print(result['verdict']+': renderer loss/recovery',flush=True)
if not result['complete']: raise SystemExit(1)
