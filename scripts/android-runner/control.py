#!/usr/bin/env python3
"""On-demand controls for an explicitly configured disposable emulator."""
import os
from pathlib import Path
import subprocess
import sys
from config import CONFIG, SERIAL, require_runner

def main():
    c=require_runner()
    os.environ['ANDROID_HOME']=str(c.sdk)
    os.environ['ANDROID_AVD_HOME']=str(c.avd)
    args=sys.argv[1:];action=args.pop(0) if args else 'status'
    adb=[str(c.sdk/'platform-tools/adb'),'-s',SERIAL]
    if action in ('start','stop'):
        if action == 'start':
            devices=subprocess.check_output([str(c.sdk/'platform-tools/adb'),'devices'],text=True)
            if any(line.startswith(SERIAL+'\t') for line in devices.splitlines()):
                raise RuntimeError('Emulator port already occupied; preserve the running device')
        subprocess.run(['systemctl','--user',action,c.service],check=True)
    elif action=='status':
        subprocess.run(['systemctl','--user','show',c.service,'-p','ActiveState','-p','MemoryCurrent','-p','MemoryPeak'],check=True)
        subprocess.run(adb+['get-state'],check=False)
    elif action=='adb':
        os.execv(adb[0],adb+args)
    elif action in ('ui','suite','smoke','probes'):
        os.execv(sys.executable,[sys.executable,str(c.root/(action+'.py'))]+args)
    elif action in ('snapshot-save','snapshot-reset'):
        _,snapshot,_=c.profile((c.root/'camera-emulated.flag').is_file())
        command=['emu','avd','snapshot','save' if action=='snapshot-save' else 'load',snapshot]
        subprocess.run(adb+command,check=True,timeout=60)
    elif action=='emulator':
        camera=(c.root/'camera-emulated.flag').is_file()
        avd,snapshot,camera=c.profile(camera)
        emulator=str(c.sdk/'emulator/emulator')
        os.execv(emulator,[emulator,'-avd',avd,'-port','5554','-accel','on','-memory',str(c.memory_mb),'-cores','2',
            '-no-window','-no-metrics','-no-audio','-no-boot-anim','-gpu','swiftshader','-snapshot',snapshot,
            *(['-feature','GLDirectMem,HasSharedSlotsHostMemoryAllocator'] if c.direct_memory else []),
            '-no-snapshot-save','-camera-back','emulated' if camera else 'none','-camera-front','none'])
    else:raise SystemExit('Use start|stop|status|adb|ui|suite|smoke|probes|snapshot-save|snapshot-reset')

if __name__=='__main__':main()
