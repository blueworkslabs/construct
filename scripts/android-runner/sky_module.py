#!/usr/bin/env python3
"""Real module UI and explicit native gates; separate signed synthetic update proof."""
import json
import os
import re
import time
from config import require_runner
import ui
from ui import adb,nodes,labels,find,tap,tap_node,capture,RESULTS
from host_ui import restart,diagnostics,select_after,installed_status,catalog_settings,apply_catalog,library,reveal_host_control,scroll_top
from catalog_input import replace_text

require_runner()
C=json.loads(os.environ['CONSTRUCT_SKY_MODULE_CANDIDATES'])
result={'complete':False,'checks':[],'scope':'Actual Sky module live data/UI/grants plus separate synthetic glossary update/rollback; not physical GPS or full host baseline'}
font=adb('shell','settings','get','system','font_scale').strip()

def done(name):
    result['checks'].append(name)
    (RESULTS/'sky-module-result.json').write_text(json.dumps(result,indent=2)+'\n')
    print('PASS:',name,flush=True)

def contains(text,timeout=35):
    end=time.monotonic()+timeout
    while time.monotonic()<end:
        value=next((x for x in labels() if text in x),None)
        if value is not None:return value
        time.sleep(.4)
    raise RuntimeError('Expected text missing: '+text)

def bounds(n):return list(map(int,re.findall(r'\d+',n.get('bounds',''))))

def visible(n):
    b=bounds(n)
    return len(b)==4 and b[2]>b[0] and b[3]-b[1]>=12 and n.get('enabled')!='false'

def scroll(direction='down'):
    # The gutter outside the module Canvas scrolls HTML without panning the map.
    current=nodes();web=next((n for n in current if n.get('class')=='android.webkit.WebView' and visible(n)),None)
    if web is None:raise RuntimeError('No module WebView viewport for scrolling')
    x1,y1,x2,y2=bounds(web)
    close=next((n for n in current if 'Close aircraft info' in (n.get('text'),n.get('content-desc')) and visible(n)),None)
    x=(x1+x2)//2 if close is not None else x1+4
    lo=y1+(y2-y1)*3//10;hi=y1+(y2-y1)*4//5
    if close is not None:
        # Start inside scrollable content, never on the sticky action row.
        hi=min(hi,bounds(close)[1]-24);lo=min(lo,hi-100)
        if lo<=y1 or hi<=lo:raise RuntimeError('Dialog has no usable scroll viewport')
    adb('shell','input','swipe',str(x),str(hi if direction=='down' else lo),str(x),str(lo if direction=='down' else hi),'300')
    time.sleep(.3)

def reveal(text):
    for direction in ('up','down'):
        for _ in range(9):
            candidates=[n for n in nodes() if text in (n.get('text'),n.get('content-desc')) and visible(n)]
            if candidates:return candidates[0]
            scroll(direction)
    raise RuntimeError('Module control is not reachable: '+text)

def reveal_fragment(text):
    for direction in ('up','down'):
        for _ in range(12):
            current=nodes()
            close=next((n for n in current if 'Close aircraft info' in (n.get('text'),n.get('content-desc')) and visible(n)),None)
            # WebView accessibility can report content hidden behind a sticky dialog
            # footer. Require the field (and room for its value) above that footer.
            bottom=bounds(close)[1]-90 if close is not None else None
            matches=[n for n in current if text in (n.get('text','')+' '+n.get('content-desc','')) and visible(n)
                     and (bottom is None or bounds(n)[3]<=bottom)]
            if matches:return matches[0]
            scroll(direction)
    raise RuntimeError('Module content is not reachable: '+text)

def click(text):tap_node(reveal(text))

def use_catalog(url):
    catalog_settings()
    replace_text(nodes,lambda value:ui._device(className='android.widget.EditText',packageName='dev.construct.runtime').set_text(value),url)
    adb('shell','input','keyevent','111');apply_catalog();find('Catalog refreshed.')

def exact_install(name,version,sha,from_versions=False):
    select_after(name+' · '+version,('Review & install','Review update','Review version','Install'))
    tap('Allow & install');installed_status()
    events=diagnostics()
    matches=[e for e in events if e.get('code')=='INSTALLED_TRIAL' and e.get('moduleVersion')==version and e.get('packageDigest')==sha]
    if not matches:raise RuntimeError('Installed signed digest not found in native diagnostics')
    library()

def open_module(name='Sky Watch',version=None,expect='picker'):
    if expect=='map':inject_fix() # location.read accepts a cached fix at most 120 s old
    restart();library();select_after(name+' · '+(version or C['sky']['version']),('Open',))
    if expect=='map':
        # Both location gates granted: 0.3.0 opens straight onto the map from one fix.
        contains('Your location · ',45)
    else:
        find('Choose area');contains('What’s flying nearby?')

def close_module():tap('Construct menu');tap('Close module');library()

def access():
    tap('Construct menu');tap('Module access')
    # This returns from ModuleActivity to the native host. Do not scroll a
    # transient window hierarchy before the destination page has appeared.
    find('The module is stopped. Changes apply immediately and survive updates and rollback.')

def native_status(text):
    scroll_top();return contains(text)

def leave_access():
    scroll_top();tap('Back')

def switch(label):
    reveal_host_control(label)
    matches=[n for n in nodes() if n.get('content-desc')==label and n.get('checkable')=='true' and visible(n)]
    if len(matches)!=1:raise RuntimeError('Expected exactly one trusted grant switch: '+label)
    tap_node(matches[0])

def fields(lat='50.0379',lon='8.5622'):
    deadline=time.monotonic()+20
    previous=None
    while time.monotonic()<deadline:
        current=[n for n in nodes() if n.get('class')=='android.widget.EditText' and visible(n)
                 and n.get('resource-id') in ('latitude','longitude')]
        state={n.get('resource-id'):n.get('bounds') for n in current}
        if len(current)==2 and set(state)=={'latitude','longitude'} and state==previous:break
        previous=state;time.sleep(.3)
    else:raise RuntimeError('Expected the two stable visible coordinate fields')
    for identifier,value in [('latitude',lat),('longitude',lon)]:
        ui._device(className='android.widget.EditText',packageName='dev.construct.runtime',resourceId=identifier).set_text(value)
    # Accessibility set_text does not open the IME. Escape would cancel the HTML dialog.

def area(lat='50.0379',lon='8.5622'):
    time.sleep(16) # Respect module-persisted provider floor across reopen/update.
    # Welcome card offers "Choose area"; the map header offers "Area". Both open the same dialog.
    click('Choose area' if any(n.get('text')=='Choose area' and visible(n) for n in nodes()) else 'Area')
    fields(lat,lon);tap('Show aircraft')

def coordinates():
    return [n.get('text') for n in nodes() if n.get('class')=='android.widget.EditText' and n.get('resource-id') in ('latitude','longitude')]

def inject_fix():
    adb('shell','cmd','location','set-location-enabled','true')
    for _ in range(3):adb('emu','geo','fix','8.5622','50.0379');time.sleep(1)

def ready(source):
    contains(source+' · live',60)
    count=contains(' aircraft')
    if not any(re.fullmatch(r'[1-9]\d* aircraft',x) for x in labels()):raise RuntimeError('No live aircraft in public reference area')
    find('Zoom in');find('Zoom out')

def auto_switch():
    for _ in range(8):
        matches=[n for n in nodes() if n.get('resource-id')=='auto' and visible(n)]
        if len(matches)==1:return matches[0]
        scroll()
    raise RuntimeError('Auto switch is not reachable')

def select_source(old,new):click(old);tap(new)

def app_permission(name):return re.search(re.escape(name)+r': granted=true',adb('shell','dumpsys','package','dev.construct.runtime')) is not None

def settled_permission(text):
    deadline=time.monotonic()+20;prior=None;since=0
    while time.monotonic()<deadline:
        matches=[n for n in nodes() if n.get('text')==text and n.get('package')=='com.google.android.permissioncontroller' and visible(n)]
        focused=any('mCurrentFocus=' in line and 'GrantPermissionsActivity' in line for line in adb('shell','dumpsys','window').splitlines())
        b=matches[0].get('bounds') if len(matches)==1 and focused else None
        if b and b==prior and time.monotonic()-since>=3:tap_node(matches[0]);return
        if b!=prior:prior=b;since=time.monotonic()
        time.sleep(.3)
    raise RuntimeError('Permission dialog did not settle')

def choose_permission(options):
    end=time.monotonic()+20
    while time.monotonic()<end:
        for x in options:
            if x in labels():settled_permission(x);return
        time.sleep(.3)
    raise RuntimeError('Android permission choices missing')

def screenshot_layouts(prefix,expected):
    field_target=None
    for scale,rotation,suffix in [('1.0','0','portrait'),('1.0','1','landscape'),('2.0','0','font2'),('2.0','1','font2-landscape')]:
        adb('shell','settings','put','system','accelerometer_rotation','0')
        adb('shell','settings','put','system','font_scale',scale)
        adb('shell','settings','put','system','user_rotation',rotation);time.sleep(2)
        reveal_fragment(expected);capture(prefix+'-'+suffix)
        if prefix=='modular-metadata':
            field_target=field_target or next((x for x in ('Registry owner','Callsign airline') if x in labels()),None)
            reveal_fragment(field_target or 'Aircraft retrieved:');capture(prefix+'-'+suffix+'-fields')
    adb('shell','settings','put','system','user_rotation','0')
    adb('shell','settings','put','system','font_scale',font);time.sleep(2)

try:
    restart();use_catalog(C['catalog']);exact_install('Sky Watch',C['sky']['version'],C['sky']['sha256'])
    path=adb('shell','pm','path','dev.construct.runtime').strip().removeprefix('package:')
    apk=adb('shell','sha256sum',path).split()[0];result['environment']={'apkSha256':apk}
    open_module();area();contains('Enable the requested capability');capture('modular-default-denied')
    access();switch('Allow approved internet sources');native_status('Allow approved internet sources: on.')
    for origin in ['api.adsb.lol','opensky-network.org','tile.openstreetmap.org','api.adsbdb.com']:
        reveal_host_control('https://'+origin)
    leave_access();open_module();time.sleep(16);done('Exact signed module; net.http denied by default and explicitly granted in native access')
    click('Choose area');fields('91','8.5622');tap('Show aircraft');contains('Enter latitude −85 to 85')
    fields();tap('Show aircraft');ready('ADSB.lol')
    if app_permission('android.permission.ACCESS_FINE_LOCATION') or app_permission('android.permission.ACCESS_COARSE_LOCATION'):raise RuntimeError('Manual area unexpectedly granted location')
    capture('modular-adsb-map');done('Module-owned parser/map loads live ADSB.lol after manual coordinate validation without location permission')
    map_label='Aircraft map. Select aircraft in the nearby list for accessible details.'
    b=bounds(find(map_label));cx=(b[0]+b[2])//2;cy=(b[1]+b[3])//2
    ui._device(description=map_label).gesture((cx-80,cy),(cx+80,cy),(cx-130,cy),(cx+130,cy),steps=25)
    contains('Search here');capture('modular-pinch-after')
    click('Zoom out');click('Center map')
    done('Real two-pointer WebView pinch exposes Search here; before/after map captures retained for zoom review')
    select_source('ADSB.lol','OpenSky');ready('OpenSky');capture('modular-opensky-map');done('Module-owned OpenSky adapter loads live data')
    time.sleep(16);select_source('OpenSky','Combined');ready('ADSB.lol');contains('OpenSky · live');capture('modular-combined-map');done('Combined receives both live feeds; deterministic identity/merge rules tested separately')
    time.sleep(16);click('50 km');tap('100 km');ready('ADSB.lol');click('Zoom in');click('Zoom out');click('Center map')
    # Reveal an actual live list row; do not select a hard-coded aircraft.
    for _ in range(8):
        candidates=[n for n in nodes() if re.search(r'\d+(?:\.\d+)? km · ',n.get('text','')+' '+n.get('content-desc','')) and visible(n)]
        if candidates:tap_node(candidates[0]);break
        scroll()
    else:raise RuntimeError('No selectable live aircraft row')
    contains('Dismiss details');click('More aircraft info');find('Look up with ADSBdb');capture('modular-metadata-optin')
    tap('Look up with ADSBdb');contains('Look up again',60);reveal_fragment('Aircraft retrieved:')
    if any('HTTP ' in x or 'Unexpected ' in x or 'Request unavailable' in x for x in labels()):raise RuntimeError('Metadata lookup failed')
    screenshot_layouts('modular-metadata','ADSBdb record');tap('Close aircraft info');done('Selected-aircraft metadata requires explicit lookup and returns attributed results; layout screenshots retained')
    click('Area');fields();tap('Show aircraft');ready('ADSB.lol');click('Center map');screenshot_layouts('modular-map','100 km');done('Map, radius and controls survive both orientations and Android 2x text')
    tap('Construct menu');tap('Return to module');reveal_fragment('Auto is off')
    if any('Refresh paused while' in x for x in labels()):raise RuntimeError('Pause notice survived return to the module')
    capture('modular-menu-resume');done('Native menu returns to module state without a stale pause notice')
    click('Area');tap('Use my location');contains('Enable the requested capability');tap('Cancel')
    access();switch('Allow reading phone location');native_status('Allow reading phone location: on.')
    reveal_host_control('Allow Android location access');tap('Allow Android location access');choose_permission(["Don’t allow","Don't allow"])
    native_status('Android location access denied');leave_access();open_module();click('Choose area');tap('Use my location');contains('Enable Allow reading phone location');tap('Cancel')
    done('Location module grant and Android denial remain separate; module cannot launch OS prompt')
    access();reveal_host_control('Allow Android location access');tap('Allow Android location access');choose_permission(['While using the app','Only this time'])
    native_status('Android location access allowed');leave_access()
    # The synthetic fix must exist before the reopen: 0.3.0 requests it at start.
    open_module(expect='map');contains('Your location · 50.038, 8.562')
    if any(x in ('Choose your viewing area','Finding your location…') for x in labels()):raise RuntimeError('Welcome card still shown after an auto-start fix')
    click('Area')
    if coordinates()!=['50.037900','8.562200']:raise RuntimeError('Module did not receive the injected location')
    capture('modular-synthetic-location');tap('Cancel');ready('ADSB.lol')
    done('Granted location.read opens straight onto the map from one synthetic foreground fix; no confirmation step')
    if not all(x in labels() for x in ('Combined','100 km')):raise RuntimeError('Source/radius preferences were not restored')
    tap_node(auto_switch());time.sleep(.5);close_module();open_module(expect='map')
    if auto_switch().get('checked')!='true':raise RuntimeError('Auto preference was not restored')
    tap_node(auto_switch());time.sleep(.5)
    done('Source, radius and Auto preferences persist across close/reopen')
    time.sleep(16);area('51','9');contains('Chosen area · 51.000, 9.000')
    time.sleep(16);click('Area');tap('Use my location');contains('Your location · 50.038, 8.562',25)
    if 'Chosen area · 51.000, 9.000' in labels():raise RuntimeError('Use my location did not replace the manual area directly')
    done('Use my location shows aircraft directly without Show aircraft')
    time.sleep(16);area('51','9');contains('Chosen area · 51.000, 9.000')
    adb('shell','input','keyevent','3');time.sleep(2);open_module(expect='map')
    if any('51.000, 9.000' in x for x in labels()):raise RuntimeError('Manual area survived a real background exit')
    done('Real background exit discards the module area; reopening takes a fresh fix, not the old coordinates')
    click('Area');tap('Start with my location when opening');tap('Cancel');close_module();open_module()
    contains('Choose your viewing area');capture('modular-start-picker')
    click('Choose area');tap('Start with my location when opening');tap('Cancel');close_module();open_module(expect='map')
    done('Start-with-location preference persists across close/reopen and restores auto-start when re-enabled')
    adb('shell','svc','wifi','disable');adb('shell','svc','data','disable');area();contains('unavailable',40);capture('modular-offline')
    adb('shell','svc','wifi','enable');adb('shell','svc','data','enable');done('Offline transport failure is visible without crashing module')
    access();switch('Allow approved internet sources')
    if 'Turn off' in labels():tap('Turn off')
    native_status('Allow approved internet sources: off.');leave_access();open_module(expect='map');contains('Enable the requested capability');close_module()
    done('Revoked internet grant remains denied after reopen while location auto-start still works')
    # Separate fixtures: same actual Sky parser/UI with synthetic feed and only glossary/version differences.
    use_catalog(C['updateCatalog']);v1,v2=C['updates']
    exact_install('Synthetic Sky',v1['version'],v1['sha256'],from_versions=True)
    open_module('Synthetic Sky',v1['version']);area();contains('Beechcraft King Air');capture('module-update-before')
    if any('Beechcraft King Air 300' in x for x in labels()):raise RuntimeError('Old glossary already contains changed name')
    tap('Construct menu');tap('Mark working');library();use_catalog(C['updateCatalog'])
    exact_install('Synthetic Sky',v2['version'],v2['sha256'])
    open_module('Synthetic Sky',v2['version']);area();contains('Beechcraft King Air 300');capture('module-update-after')
    if adb('shell','sha256sum',path).split()[0]!=apk:raise RuntimeError('Host APK changed during module-only update')
    close_module();select_after('Synthetic Sky · '+v2['version'],('Roll back','Restore '+v1['version'],'Restore previous'))
    tap('Restore');library();open_module('Synthetic Sky',v1['version']);area();contains('Beechcraft King Air')
    if any('Beechcraft King Air 300' in x for x in labels()):raise RuntimeError('Rollback failed to restore glossary')
    capture('module-update-rollback');close_module()
    result['moduleUpdate']={'before':v1,'after':v2,'apkSha256Before':apk,'apkSha256After':adb('shell','sha256sum',path).split()[0]}
    done('Two signed synthetic module versions change real glossary behavior and rollback on the same checksummed APK')
    result['complete']=True
except Exception as e:
    result['error']=str(e)
    try:
        capture('modular-failure')
        (RESULTS/'modular-failure-nodes.json').write_text(json.dumps([n.attrib for n in nodes()],indent=2))
    except Exception:pass
    raise
finally:
    adb('shell','svc','wifi','enable');adb('shell','svc','data','enable')
    adb('shell','settings','put','system','font_scale',font);adb('shell','settings','put','system','user_rotation','0')
    (RESULTS/'sky-module-result.json').write_text(json.dumps(result,indent=2)+'\n')
