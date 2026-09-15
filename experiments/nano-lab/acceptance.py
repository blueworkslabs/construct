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
from uiautomator2.exceptions import UiObjectNotFoundError

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--serial', required=True)
p.add_argument('--apk', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)
p.add_argument('--paste-key', action='store_true', help='Verify real clipboard using native Paste key instead of a floating menu')
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
def hide_keyboard():
    if d(packageName=ime_package).exists:
        d.press('back'); time.sleep(.3)
        require(d.app_current().get('package')==package, 'Keyboard dismissal left Nano Lab')
def seek(label):
    hide_keyboard()
    target = d(text=label, packageName=package)
    if not target.exists: top()
    height = d.window_size()[1]
    for attempt in range(9):
        hide_keyboard()
        if target.exists:
            try: b = target.info['bounds']
            except UiObjectNotFoundError:
                time.sleep(.4); continue
            center = (b['top']+b['bottom'])/2
            if .15*height <= center <= .94*height and b['bottom']-b['top'] >= 40:
                time.sleep(.3)
                try:
                    if target.exists and target.info['bounds']==b: return target
                except UiObjectNotFoundError:
                    continue
            if attempt < 8:
                if center < .15*height: d.swipe(.5,.35,.5,.7,duration=.3)
                else: d.swipe(.5,.7,.5,.35,duration=.3)
        elif attempt < 8: d.swipe(.5,.7,.5,.35,duration=.3)
    raise RuntimeError('Control not tappable at stable safe bounds: '+label)
def top():
    hide_keyboard()
    for attempt in range(9):
        if d(text='Construct Nano Lab', packageName=package).exists: return
        if attempt < 8: d.swipe(.5, .35, .5, .75, duration=.3)
    raise RuntimeError('Unable to reach top of Nano Lab')
def prompt():
    hide_keyboard()
    target = d(description='Your prompt', packageName=package)
    if not target.exists: top()
    for attempt in range(9):
        if target.exists: return target
        if attempt < 8: d.swipe(.5, .75, .5, .35, duration=.3)
    raise RuntimeError('Prompt field not found')
def write_prompt(value):
    prompt().set_text(value)
    # Text replacement can open IME asynchronously; settle before navigation.
    time.sleep(1)
    hide_keyboard()
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
    ime_package = adb('shell','settings','get','secure','default_input_method').strip().split('/')[0]
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
    write_prompt(marker)
    (a.out/'after-entry.xml').write_text(tree())
    require(prompt().get_text()==marker, 'Input replacement failed')
    # Native copy then paste into the app's own field verifies the actual report.
    seek('Copy technical report').click()
    seek('Clear text').click()
    if a.paste_key:
        prompt().click()
        adb('shell', 'input', 'keyevent', 'KEYCODE_PASTE')
        receipt['clipboardInput'] = 'native Paste key into focused EditText'
    else:
        prompt().long_click()
        require(d(text='Paste').wait(timeout=5), 'Native Paste menu missing')
        d(text='Paste').click()
        receipt['clipboardInput'] = 'native floating Paste menu'
    deadline = time.monotonic()+5
    while True:
        report = prompt().get_text()
        if 'Construct Nano Lab' in report or time.monotonic()>=deadline: break
        time.sleep(.2)
    require('Construct Nano Lab 0.1.0-alpha1' in report, 'Technical report was not copied')
    require('SDK: genai-prompt 1.0.0-beta4' in report and 'Android:' in report, 'Missing report metadata')
    require(marker not in report, 'Technical report included prompt text')
    (a.out/'technical-report.txt').write_text(report+'\n')
    done('Technical clipboard report contains versions/status and excludes synthetic prompt')
    write_prompt(marker)
    pid = adb('shell','pidof',package).strip()
    d.press('home'); time.sleep(1); resume()
    require(adb('shell','pidof',package).strip()==pid, 'Background check must retain process')
    require(prompt().get_text() in ('', 'Your prompt'), 'Prompt retained across background')
    top(); require('Session cleared after leaving.' in text(), 'Session not invalidated')
    done('Background/return clears text and readiness without process restart')
    write_prompt(marker); d.set_orientation('l'); time.sleep(1)
    require(prompt().get_text() in ('', 'Your prompt'), 'Prompt restored across rotation')
    d.set_orientation('n'); time.sleep(1)
    top(); require('Not checked. Tap Check availability.' in text(), 'Rotation unexpectedly restores readiness')
    done('Rotation starts a fresh empty session')
    write_prompt(marker)
    clear = seek('Clear text')
    (a.out/'before-clear.xml').write_text(tree())
    clear.click()
    time.sleep(.3)
    require(prompt().get_text() in ('', 'Your prompt'), 'Clear did not clear text')
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
