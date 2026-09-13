#!/usr/bin/env python3
"""Offline native inference on licensed test photos, only inside a disposable emulator."""
from config import CONFIG, require_runner
from ui import adb, nodes, labels, tap, tap_node, find, capture, RESULTS
from host_ui import restart, select_after, installed_status, diagnostics
from catalog_input import replace_text
from pathlib import Path
from PIL import Image
import ui
import hashlib, json, os, re, subprocess, time

require_runner()
result = {'complete': False, 'checks': [], 'source': 'Public-domain NASA astronaut and CC0 Chelsea cat; generated blank'}
heading = 'Pocket Camera · ' + os.environ['CONSTRUCT_CAMERA_VERSION']
folder = '/data/user/0/dev.construct.runtime/files/camera-photos/dev.construct.camera/'
rooted = False

def done(text):
    result['checks'].append(text); print('PASS:', text, flush=True)

def top():
    for _ in range(12):
        if 'Use configured registry' in labels(): return
        adb('shell', 'input', 'swipe', '360', '450', '360', '1050', '250')
    raise RuntimeError('Workshop top missing')

def expect(prefix):
    deadline = time.monotonic() + 60
    while time.monotonic() < deadline:
        current = labels()
        if any(t.startswith('[PHOTO_ANALYSIS') for t in current): raise RuntimeError('Native detector failed: ' + str(current))
        match = next((t for t in current if t.startswith(prefix)), None)
        if match: return match
        time.sleep(.25)
    raise RuntimeError('Missing native analysis result: ' + prefix)

def opened():
    restart(); top(); select_after(heading, ('Open',)); find('Open camera workspace')
    tap('Open camera workspace'); find('Close camera'); expect('Camera preview ready.')

def root():
    global rooted
    if adb('shell', 'getprop', 'ro.kernel.qemu').strip() != '1' or adb('shell', 'getprop', 'ro.build.type').strip() != 'userdebug':
        raise RuntimeError('Fixture injection requires disposable userdebug emulator')
    adb('root'); adb('wait-for-device'); rooted = True
    if adb('shell', 'id', '-u').strip() != '0': raise RuntimeError('Fixture root unavailable')

def unroot():
    global rooted
    adb('unroot'); adb('wait-for-device')
    if adb('shell', 'id', '-u').strip() == '0': raise RuntimeError('Could not restore non-root ADB')
    rooted = False

try:
    if not (CONFIG.root/'camera-emulated.flag').exists(): raise RuntimeError('Vision requires explicit synthetic-camera AVD')
    pid = subprocess.check_output(['systemctl', '--user', 'show', CONFIG.service, '-p', 'MainPID', '--value'], text=True).strip()
    command = Path('/proc/'+pid+'/cmdline').read_bytes().decode().split('\0')
    for option, value in [('-avd', 'construct-camera36'), ('-camera-back', 'emulated'), ('-camera-front', 'none')]:
        if option not in command or command[command.index(option)+1] != value: raise RuntimeError('Camera source is not synthetic')
    fixtures = CONFIG.root/'vision-fixtures'
    locked = json.loads((fixtures/'vision-assets.json').read_text())
    for entry in locked:
        if entry['kind'] != 'fixture': continue
        data = (fixtures/entry['name']).read_bytes()
        if len(data) != entry['bytes'] or hashlib.sha256(data).hexdigest() != entry['sha256']: raise RuntimeError('Test image checksum mismatch')
    restart()
    replace_text(nodes, lambda value: ui._device(className='android.widget.EditText', packageName='dev.construct.runtime').set_text(value), CONFIG.test_catalog)
    tap('Refresh catalog'); find('Catalog refreshed.'); select_after(heading, ('Review & install',))
    tap('Allow & install'); installed_status()
    top(); installed = [e for e in diagnostics() if e.get('code') == 'INSTALLED_TRIAL' and e.get('moduleId') == 'dev.construct.camera']
    if len(installed) != 1 or installed[0].get('packageDigest') != os.environ['CONSTRUCT_CAMERA_SHA256']: raise RuntimeError('Wrong signed launcher')
    top(); select_after(heading, ('Module access',))
    matches = [n for n in nodes() if n.get('content-desc') == 'Allow camera workspace' and n.get('checkable') == 'true']
    if len(matches) != 1 or matches[0].get('checked') != 'false': raise RuntimeError('Unexpected initial grant')
    tap_node(matches[0]); find('Allow camera workspace: on.')
    tap('Allow Android camera access'); find('While using the app'); tap('While using the app'); find('Android camera access: allowed')
    opened(); tap('Take photo'); find('Saved photos: 1 / 8'); find('Saved photo preview')
    tap('Delete photo'); tap('Delete permanently'); find('Saved photos: 0 / 8'); tap('Close camera')
    adb('shell', 'am', 'force-stop', 'dev.construct.runtime')
    root()
    if adb('shell', 'ls', '-A', folder).strip(): raise RuntimeError('Refusing to overwrite existing private photos')
    owner = adb('shell', 'stat', '-c', '%u:%g', folder).strip()
    if not re.fullmatch(r'[1-9][0-9]{4,}:[1-9][0-9]{4,}', owner): raise RuntimeError('Unexpected app storage owner')
    astronaut = Image.open(fixtures/'astronaut.png').convert('RGB')
    images = [Image.open(fixtures/'chelsea.png').convert('RGB'), Image.new('RGB', (512,512), 'white'), astronaut.rotate(90, expand=True), astronaut]
    hashes = {}
    for index, image in enumerate(images, 1):
        name = '00000000-0000-4000-8000-%012d.jpg' % index
        local = RESULTS/name
        exif = Image.Exif(); exif[274] = 6 if index == 3 else 1
        image.save(local, 'JPEG', quality=95, exif=exif)
        hashes[name] = hashlib.sha256(local.read_bytes()).hexdigest()
        adb('push', str(local), folder+name)
        adb('shell', 'chown', owner, folder+name); adb('shell', 'chmod', '600', folder+name)
        adb('shell', 'restorecon', folder+name); adb('shell', 'touch', '-t', '202001010000.00', folder+name)
    unroot()
    adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'enable')
    adb('shell', 'svc', 'wifi', 'disable'); adb('shell', 'svc', 'data', 'disable')
    if adb('shell', 'settings', 'get', 'global', 'airplane_mode_on').strip() != '1': raise RuntimeError('Offline mode did not apply')
    result['offlineBeforeFirstInference'] = True
    opened(); tap('Saved photos'); find('Saved photos: 4 / 8'); find('Saved photo preview')
    tap('Find faces'); text = expect('Faces found: ')
    if not re.search(r'Faces found: [1-9]', text): raise RuntimeError('Known face not detected')
    capture('vision-face'); done('Bundled face model detects public-domain face on first inference while offline')
    tap('Previous photo'); expect('Saved photo ready.')
    if any('Faces found:' in t or t.startswith('Face ') for t in labels()): raise RuntimeError('Previous analysis survived selection change')
    tap('Find faces'); expect('Faces found: '); capture('vision-oriented-face')
    done('Selection clears old results; EXIF-rotated face is detected after orientation-correct decoding')
    tap('Previous photo'); expect('Saved photo ready.'); tap('Find faces'); expect('No faces detected')
    tap('Find objects'); expect('No objects detected'); capture('vision-blank')
    done('Blank negative control produces no face or object detections, rather than fabricated labels')
    tap('Previous photo'); expect('Saved photo ready.'); tap('Find objects'); expect('Objects found: ')
    if not any(re.search(r'\bcat [0-9]+%', t, re.I) for t in labels()): raise RuntimeError('Known cat not detected')
    capture('vision-cat'); done('Bundled object model labels CC0 cat while offline')
    tap_node(find('Find objects')); adb('shell', 'input', 'keyevent', '3')
    opened(); tap('Saved photos'); find('Saved photo preview'); expect('Saved photo ready.')
    if any('on-device estimate' in t or 'Estimates can be wrong' in t for t in labels()): raise RuntimeError('Analysis persisted after background closure')
    tap('Close camera'); done('Background closes workspace and reopening does not retain analysis results')
    adb('shell', 'am', 'force-stop', 'dev.construct.runtime')
    root()
    for name, expected in hashes.items():
        if hashlib.sha256(adb('exec-out', 'cat', folder+name, binary=True)).hexdigest() != expected: raise RuntimeError('Analysis changed original JPEG')
    unroot(); done('Analysis preserves every original JPEG byte; ADB restored non-root')
    restart(); top(); events = diagnostics()
    result['environment'] = next(e for e in events if e.get('code') == 'ENVIRONMENT')
    analysis_events = [e for e in events if e.get('code') == 'PHOTO_ANALYZED']
    if len(analysis_events) < 5: raise RuntimeError('Missing native completion evidence')
    if any(e.get('code') in ('PHOTO_ANALYSIS', 'PHOTO_ANALYSIS_UNAVAILABLE', 'CAMERA_IMAGE', 'JAVASCRIPT_ERROR') for e in events): raise RuntimeError('Unexpected native/host error')
    if any(word in json.dumps(analysis_events).lower() for word in ('astronaut', 'chelsea', '.jpg', 'bounding', 'score', 'cat ')): raise RuntimeError('Image analysis details leaked to diagnostics')
    result['analysisEvents'] = analysis_events
    done('Diagnostics record completion only, not photo labels, boxes or contents')
    result['complete'] = True
except Exception as error:
    result['error'] = str(error)
    try:
        capture('vision-failure')
        (RESULTS/'vision-logcat.txt').write_text(adb('logcat', '-d', '-t', '300', 'AndroidRuntime:E', 'ConstructVision:E', 'mediapipe:E', 'linker:E', '*:S'))
    except Exception: pass
    raise
finally:
    if rooted: unroot()
    adb('shell', 'cmd', 'connectivity', 'airplane-mode', 'disable')
    adb('shell', 'svc', 'wifi', 'enable'); adb('shell', 'svc', 'data', 'enable')
    result['adbUnrooted'] = adb('shell', 'id', '-u').strip() != '0'
    (RESULTS/'camera-result.json').write_text(json.dumps(result, indent=2)+'\n')
