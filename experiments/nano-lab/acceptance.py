#!/usr/bin/env python3
"""Real-SDK unavailable-path acceptance on an explicitly selected disposable device.

Does not start/stop an emulator: the invoking runner must stop it in finally.
Only synthetic text is entered; no inference is requested or claimed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import xml.etree.ElementTree as ET
import uiautomator2 as u2

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--serial', required=True)
p.add_argument('--apk', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)
a = p.parse_args()
apk = a.apk.resolve()
a.out.mkdir(parents=True, exist_ok=False)
sdk = Path(os.environ['ANDROID_HOME'])
package = 'dev.construct.nanolab'
receipt = {'scope': 'Real SDK unavailable path only; no inference or model download',
           'apkSha256': hashlib.sha256(apk.read_bytes()).hexdigest(),
           'checks': [], 'complete': False}
def adb(*args):
    return subprocess.check_output([str(sdk/'platform-tools/adb'), '-s', a.serial, *args], text=True, timeout=60)
def save():
    (a.out/'result.json').write_text(json.dumps(receipt, indent=2)+'\n')
def require(condition, message):
    if not condition: raise RuntimeError(message)
def done(name):
    receipt['checks'].append(name); save(); print('PASS:', name, flush=True)
def tree():
    return d.dump_hierarchy(compressed=False)
def text():
    return '\n'.join(n.attrib.get('text', '') for n in ET.fromstring(tree()).iter('node'))
def seek(label):
    if not d(text=label).exists:
        d(scrollable=True).scroll.to(text=label, max_swipes=8)
    require(d(text=label).exists, 'Missing control: '+label)
    return d(text=label)
def top():
    d(scrollable=True).scroll.toBeginning(max_swipes=8)
def prompt():
    if not d(description='Your prompt').exists:
        d(scrollable=True).scroll.to(description='Your prompt', max_swipes=8)
    return d(description='Your prompt')
def resume():
    adb('shell', 'am', 'start', '-n', package+'/.NanoActivity')
    require(d(packageName=package).wait(timeout=10), 'App did not become visible')

save()
try:
    require(package not in adb('shell','pm','list','packages',package), 'Require a clean disposable device')
    receipt['android'] = adb('shell','getprop','ro.build.version.release').strip()
    receipt['aicorePackage'] = adb('shell','pm','list','packages','com.google.android.aicore').strip()
    adb('install', str(apk))
    d = u2.connect_usb(a.serial)
    resume()
    require('Not checked. Tap Check availability.' in text(), 'Unexpected automatic availability check')
    require(not seek('Download model').info['enabled'], 'Download enabled before check')
    done('Fresh launch makes no automatic check or download')
    seek('Check availability').click()
    deadline = time.monotonic()+35
    while time.monotonic()<deadline:
        status = text()
        if 'UNAVAILABLE — Prompt API' in status: break
        if 'Request failed [' in status or 'Timed out.' in status:
            raise RuntimeError('SDK initialization/check error, not an unavailable pass: '+status)
        time.sleep(.5)
    require('UNAVAILABLE — Prompt API' in text(), 'Expected real SDK UNAVAILABLE')
    (a.out/'unavailable.xml').write_text(tree())
    done('Real Prompt SDK returns UNAVAILABLE without crashing')
    require(not seek('Download model').info['enabled'], 'Unsupported download enabled')
    require(not seek('Send prompt').info['enabled'], 'Unsupported inference enabled')
    done('Unavailable state disables download and inference')
    top(); seek('Tiny story').click()
    require('robot and a lost sock' in prompt().get_text(), 'Preset missing')
    marker = 'SYNTHETIC-NANO-PRIVATE-TEXT-914'
    prompt().set_text(marker)
    require(prompt().get_text()==marker, 'Input replacement failed')
    # Native copy then paste into the app's own field verifies the actual report.
    seek('Copy technical report').click()
    seek('Clear text').click()
    prompt().long_click()
    require(d(text='Paste').wait(timeout=5), 'Native Paste menu missing')
    d(text='Paste').click()
    report = prompt().get_text()
    require('Construct Nano Lab 0.1.0-alpha1' in report, 'Technical report was not copied')
    require('SDK: genai-prompt 1.0.0-beta4' in report and 'Android:' in report, 'Missing report metadata')
    require(marker not in report, 'Technical report included prompt text')
    (a.out/'technical-report.txt').write_text(report+'\n')
    done('Technical clipboard report contains versions/status and excludes synthetic prompt')
    prompt().set_text(marker)
    pid = adb('shell','pidof',package).strip()
    d.press('home'); time.sleep(1); resume()
    require(adb('shell','pidof',package).strip()==pid, 'Background check must retain process')
    require(prompt().get_text()=='', 'Prompt retained across background')
    top(); require('Session cleared after leaving.' in text(), 'Session not invalidated')
    done('Background/return clears text and readiness without process restart')
    prompt().set_text(marker); d.set_orientation('l'); time.sleep(1)
    require(prompt().get_text()=='', 'Prompt restored across rotation')
    d.set_orientation('n'); time.sleep(1)
    top(); require('Not checked. Tap Check availability.' in text(), 'Rotation unexpectedly restores readiness')
    done('Rotation starts a fresh empty session')
    prompt().set_text(marker); seek('Clear text').click()
    require(prompt().get_text()=='', 'Clear did not clear text')
    seek('Close Nano Lab').click()
    require(d.app_current().get('package')!=package, 'Close did not leave Nano Lab')
    done('Explicit Clear and Close work')
    receipt['complete'] = True
except BaseException as error:
    receipt['failure'] = str(error)
    if 'd' in globals():
        try: (a.out/'failure.xml').write_text(tree())
        except Exception: pass
    raise
finally:
    save()
    if 'd' in globals():
        d.set_orientation('n'); d.app_stop(package)
