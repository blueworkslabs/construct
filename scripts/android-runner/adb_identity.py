"""Bounded ADB privilege cleanup; the resulting identity, not command exit, is proof."""
import subprocess
import time


def acquire_root_identity(adb, pause=time.sleep):
    if (adb('shell','getprop','ro.kernel.qemu').strip()!='1' or
            adb('shell','getprop','ro.build.type').strip()!='userdebug'):
        raise RuntimeError('Disposable userdebug emulator required for root fixture setup')
    command_errors=0
    for attempt in range(2):
        try:adb('root',timeout=30)
        except subprocess.CalledProcessError:
            # Like unroot, root may apply successfully while closing its transport.
            command_errors+=1
        adb('wait-for-device',timeout=30)
        for _ in range(12):
            try:identity=adb('shell','id','-u',timeout=10).strip()
            except subprocess.CalledProcessError:
                pause(.25);continue
            if identity=='0':return command_errors
            if identity=='2000':break
            raise RuntimeError('Unexpected ADB identity after root fixture setup')
    raise RuntimeError('ADB did not reach verified root identity')


def restore_shell_identity(adb, pause=time.sleep):
    command_errors=0
    for attempt in range(2):
        try:adb('unroot',timeout=30)
        except subprocess.CalledProcessError:
            # adbd can close the initiating transport while applying unroot.
            command_errors+=1
        adb('wait-for-device',timeout=30)
        for _ in range(12):
            try:identity=adb('shell','id','-u',timeout=10).strip()
            except subprocess.CalledProcessError:
                pause(.25);continue
            if identity=='2000':return command_errors
            if identity=='0':break  # One bounded cleanup reissue, never a UI replay.
            raise RuntimeError('Unexpected ADB identity after privilege cleanup')
    raise RuntimeError('ADB did not return to verified shell identity')
