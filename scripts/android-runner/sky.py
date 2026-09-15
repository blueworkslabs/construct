#!/usr/bin/env python3
"""Exact signed Sky Watch pilot; public airport reference, disposable emulator only."""
import json
import os
import re
import time
from config import CONFIG, require_runner
import ui
from ui import adb,nodes,labels,find,tap,tap_node,capture,RESULTS
from host_ui import restart,diagnostics,select_after,installed_status,catalog_settings,apply_catalog,library
from catalog_input import replace_text

require_runner()
EXPECTED=os.environ['CONSTRUCT_SKY_SHA256']
location_only=os.environ.get('CONSTRUCT_SKY_LOCATION_ONLY')=='1'
result={'complete':False,'checks':[],'scope':'Sky Watch manual/live dual-provider map and synthetic foreground location, not physical GPS or full host regression'}
if location_only:result['scope']='Location/denial/background/offline/revoke continuation only; map/source/layout checks excluded'
font=adb('shell','settings','get','system','font_scale').strip()

def done(name):
    result['checks'].append(name); print('PASS:',name,flush=True)
    (RESULTS/'sky-result.json').write_text(json.dumps(result,indent=2)+'\n')

def contains(text,timeout=35):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        match=next((x for x in labels() if text in x),None)
        if match is not None:return match
        time.sleep(.5)
    raise RuntimeError('Expected text missing: '+text)

def choice(options,timeout=30):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        current=labels()
        for value in options:
            if value in current:return value
        time.sleep(.25)
    raise RuntimeError('Expected one of: '+repr(options))

def permission_tap(text):
    # The location dialog can expose its tree before the input window is ready.
    # Require its actual foreground focus and a stable package-owned target.
    deadline=time.monotonic()+15; previous=None; stable_since=None
    while time.monotonic()<deadline:
        focused=adb('shell','dumpsys','window')
        ready=any('mCurrentFocus=' in line and 'GrantPermissionsActivity' in line for line in focused.splitlines())
        matches=[n for n in nodes() if n.get('text')==text and n.get('package')=='com.google.android.permissioncontroller' and n.get('enabled')=='true']
        bounds=matches[0].get('bounds') if len(matches)==1 else None
        if ready and bounds and bounds==previous:
            if stable_since is not None and time.monotonic()-stable_since>=4.0:
                (RESULTS/('permission-'+str(len(result['checks']))+'-window.txt')).write_text(focused)
                tap_node(matches[0])
                until=time.monotonic()+12
                while time.monotonic()<until:
                    if not any(n.get('package')=='com.google.android.permissioncontroller' and n.get('text')==text for n in nodes()):return
                    time.sleep(.3)
                raise RuntimeError('Android permission dialog did not acknowledge the single settled tap')
        else:stable_since=time.monotonic() if ready and bounds else None
        previous=bounds;time.sleep(.3)
    raise RuntimeError('Android permission window did not settle: '+text)

def scroll_panel():
    # Only the lower portrait native panel; do not drag the map.
    adb('shell','input','swipe','350','1350','350','1050','250')

def fields(lat='50.0379',lon='8.5622'):
    ns=[n for n in nodes() if n.get('class')=='android.widget.EditText' and n.get('package')=='dev.construct.runtime']
    if len(ns)!=2:raise RuntimeError('Expected exactly two native coordinate fields')
    for index,value in enumerate((lat,lon)):
        ui._device(className='android.widget.EditText',packageName='dev.construct.runtime',instance=index).set_text(value)
    values=[n.get('text') for n in nodes() if n.get('class')=='android.widget.EditText' and n.get('package')=='dev.construct.runtime']
    if values!=[lat,lon]:raise RuntimeError('Coordinate fields differ from public reference')
    adb('shell','input','keyevent','111')

def open_sky():
    restart();select_after('Sky Watch · 0.1.0',('Open',));tap('Open aircraft map');find('Use my location')

def map_ready():
    find('Refresh',timeout=60);contains('aircraft');find('Zoom in');find('Zoom out')

def source_status(expected):
    if 'Hide source details' not in labels():tap('Sources & status')
    for text in expected:contains(text)
    capture('sources-'+str(len(result['checks'])))
    tap('Hide source details')

def mode(current,target):
    tap(current);tap(target);map_ready()

def grant_switch():
    matches=[n for n in nodes() if n.get('content-desc')=='Allow Sky Watch map and data' and n.get('checkable')=='true']
    if len(matches)!=1:raise RuntimeError('Expected one native map grant switch')
    tap_node(matches[0])

def app_permission(name):
    dump=adb('shell','dumpsys','package','dev.construct.runtime')
    return re.search(re.escape(name)+r': granted=true',dump) is not None

try:
    restart();catalog_settings()
    replace_text(nodes,lambda value:ui._device(className='android.widget.EditText',packageName='dev.construct.runtime').set_text(value),CONFIG.test_catalog)
    adb('shell','input','keyevent','111');apply_catalog();find('Catalog refreshed.')
    select_after('Sky Watch · 0.1.0',('Review & install',));tap('Allow & install');installed_status()
    events=diagnostics(); installs=[e for e in events if e.get('code')=='INSTALLED_TRIAL' and e.get('moduleId')=='dev.construct.sky-watch']
    if len(installs)!=1 or installs[0].get('packageDigest')!=EXPECTED:raise RuntimeError('Sky Watch candidate identity mismatch')
    env=next(e for e in events if e.get('kind')=='environment') if any(e.get('kind')=='environment' for e in events) else None
    # Native installed-path hashing, independent of screen labels.
    path=adb('shell','pm','path','dev.construct.runtime').strip().removeprefix('package:')
    result['environment']={'apkSha256':adb('shell','sha256sum',path).split()[0]}
    library();select_after('Sky Watch · 0.1.0',('Open',));tap('Open aircraft map');contains('[CAPABILITY_DENIED]')
    capture('sky-default-denied');tap('Module access');find('Allow Sky Watch map and data');grant_switch();find('Allow Sky Watch map and data: on.');tap('Back')
    done('Exact signed launcher installed; sky.watch denied by default and explicitly granted')
    if not location_only:
        open_sky();fields('91','8.5622');tap('Show aircraft');contains('Enter latitude −85 to 85')
        fields();tap('Show aircraft');map_ready();tap('Automatic refresh every 30 seconds');source_status(['ADSB.lol: Updated'])
        if app_permission('android.permission.ACCESS_FINE_LOCATION') or app_permission('android.permission.ACCESS_COARSE_LOCATION'):raise RuntimeError('Manual area unexpectedly granted location')
        capture('sky-adsb-map');done('Manual reference area validates coordinates and loads live ADSB.lol without location permission')
        mode('ADSB.lol','OpenSky');source_status(['OpenSky: Updated']);capture('sky-opensky-map')
        done('Single-source OpenSky mode obtains live public state data')
        # Respect the provider floor rather than forcing repeated calls.
        time.sleep(16);mode('OpenSky','Combined');source_status(['ADSB.lol: Updated','OpenSky: Updated'])
        capture('sky-combined-map');done('Combined mode receives both live providers; deterministic merge semantics tested separately')
        time.sleep(16);tap('25 km');tap('50 km');map_ready();find('50 km');tap('Zoom in');tap('Zoom out');tap('Center')
        capture('sky-radius-map');done('Radius and zoom/center controls remain usable with live data')
        # Actual configuration changes, not CSS simulation.
        adb('shell','settings','put','system','accelerometer_rotation','0');adb('shell','settings','put','system','user_rotation','1');time.sleep(2)
        find('Sky Watch');find('50 km');find('Zoom in');capture('sky-landscape')
        adb('shell','settings','put','system','user_rotation','0');time.sleep(2)
        adb('shell','settings','put','system','font_scale','2.0');time.sleep(2)
        find('Sky Watch');find('50 km');find('Zoom in');capture('sky-font2')
        adb('shell','settings','put','system','font_scale',font);time.sleep(2)
        done('Native map retained through landscape and Android 2x font; screenshots retained for visual review')
    if not location_only:tap('Close')
    open_sky();tap('Use my location')
    denial=choice(["Don’t allow","Don't allow"])
    permission_tap(denial);contains('Location permission not granted');capture('sky-location-denied')
    done('Android location denial leaves manual area available without closing workspace')
    adb('shell','cmd','location','set-location-enabled','true')
    tap('Use my location')
    allow=choice(['While using the app','Only this time'])
    permission_tap(allow)
    adb('shell','cmd','location','set-location-enabled','true')
    for _ in range(3):adb('emu','geo','fix','8.5622','50.0379');time.sleep(2)
    map_ready();contains('Phone location');capture('sky-synthetic-location')
    tap('Area')
    fix=[n.get('text') for n in nodes() if n.get('class')=='android.widget.EditText' and n.get('package')=='dev.construct.runtime']
    if fix!=['50.03790','8.56220']:raise RuntimeError('Location center did not match the injected public airport fixture')
    tap('Cancel')
    done('Native foreground location uses an explicit Android grant and public synthetic GPS fix')
    adb('shell','input','keyevent','3');time.sleep(2)
    activities=adb('shell','dumpsys','activity','activities')
    if 'SkyActivity' in activities:raise RuntimeError('Sky workspace survived real backgrounding')
    open_sky();find('Use my location')
    if any('Phone location' in x for x in labels()):raise RuntimeError('Location restored on fresh workspace')
    done('Real backgrounding closes Sky Watch; reopen does not restore prior coordinates')
    fields();time.sleep(16);adb('shell','cmd','connectivity','airplane-mode','enable');adb('shell','svc','wifi','disable');adb('shell','svc','data','disable')
    tap('Show aircraft');map_ready();contains('Could not refresh')
    tap(choice(['Sources & status · issue','Sources & status']));contains('connection failed');capture('sky-offline')
    done('Offline request ends with explicit unavailable status, not a fabricated live result')
    adb('shell','cmd','connectivity','airplane-mode','disable');adb('shell','svc','wifi','enable');adb('shell','svc','data','enable')
    tap('Close');restart();select_after('Sky Watch · 0.1.0',('Module access',));grant_switch()
    tap('Turn off');find('Allow Sky Watch map and data: off.');tap('Back');restart();select_after('Sky Watch · 0.1.0',('Open',));tap('Open aircraft map');contains('[CAPABILITY_DENIED]')
    done('Revoking native map access remains effective after process restart')
    result['complete']=True
except Exception as e:
    result['error']=str(e)
    try:capture('sky-failure')
    except Exception:pass
    raise
finally:
    for command in [('cmd','connectivity','airplane-mode','disable'),('settings','put','system','font_scale',font),('settings','put','system','user_rotation','0'),('svc','wifi','enable'),('svc','data','enable')]:
        try:adb('shell',*command)
        except Exception:pass
    (RESULTS/'sky-result.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(result,indent=2),flush=True)
