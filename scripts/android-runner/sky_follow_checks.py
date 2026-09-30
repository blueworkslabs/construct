"""Native Sky Follow checks, called inside the canonical disposable suite.

The signed aircraft fixture replaces only network data, never orientation.
"""
import math
import re
import time
from types import SimpleNamespace
from orientation_checks import active_connections, resumed_unfocused


def run(context, version):
    h = SimpleNamespace(**context)
    adb = h.adb
    uid = int(re.search(r'uid:(\d+)', adb('shell','pm','list','packages','-U','dev.construct.runtime')).group(1))
    def sensors(label, expected):
        deadline=time.monotonic()+5
        while True:
            raw=adb('shell','dumpsys','sensorservice')
            count=active_connections(raw,uid)
            if count==expected or time.monotonic()>deadline:break
            time.sleep(.2)
        (h.RESULTS/('sky-sensors-'+label+'.txt')).write_text(raw)
        h.result.setdefault('nativeCompassConnections',{})[label]=count
        assert count==expected,(label,count,expected)
    def inject(acc,mag):
        adb('emu','sensor','set','gyroscope','0:0:0')
        adb('emu','sensor','set','acceleration',acc)
        adb('emu','sensor','set','magnetic-field',mag)
    def point(az,el,roll=0):
        a,e,r=map(math.radians,(az,el,roll))
        right=(math.cos(a),-math.sin(a),0)
        up=(-math.sin(e)*math.sin(a),-math.sin(e)*math.cos(a),math.cos(e))
        z=(-math.cos(e)*math.sin(a),-math.cos(e)*math.cos(a),-math.sin(e))
        x=tuple(right[i]*math.cos(r)-up[i]*math.sin(r) for i in range(3))
        y=tuple(right[i]*math.sin(r)+up[i]*math.cos(r) for i in range(3))
        inject(':'.join(str(9.80665*v[2]) for v in (x,y,z)), ':'.join(str(50*v[1]-20*v[2]) for v in (x,y,z)))
    def text(fragment):return h.reveal_fragment(fragment)
    def reopen():
        h.leave_access();h.open_module('Synthetic Sky',version['version']);h.area()
    h.click('Follow');text('Allow reading compass and tilt');sensors('denied',0)
    h.capture('sky-follow-denied');h.done('Follow denied without native compass grant; ordinary aircraft list remains usable')
    h.access();h.switch('Allow reading compass and tilt');h.native_status('Allow reading compass and tilt: on.')
    h.switch('Allow approved internet sources');h.native_status('Allow approved internet sources: on.');reopen()
    # Keep reports fresh throughout the long native pose/layout sequence.
    h.tap_node(h.auto_switch());h.contains('next in')
    inject('0:0:9.80665','0:50:-20');h.click('Follow');text('Facing N · compass');sensors('watching',1);h.capture('sky-follow-north')
    inject('0:0:9.80665','-50:0:-20');text('Facing E · compass');h.capture('sky-follow-east')
    label='Aircraft map. Select aircraft in the nearby list for accessible details.'
    b=h.bounds(h.reveal(label));cx=(b[0]+b[2])//2;cy=(b[1]+b[3])//2
    h.ui._device(description=label).gesture((cx-60,cy),(cx+60,cy),(cx-100,cy),(cx+100,cy),steps=25)
    text('Search here');h.capture('sky-follow-pinch');h.click('Center map')
    h.done('Native north/east Follow and rotated-map pinch work; original map captures retained')
    # Select the named synthetic aircraft using the actual accessible list row.
    for _ in range(12):
        rows=[n for n in h.nodes() if n.get('class')=='android.widget.Button' and 'SYNTHETIC' in (n.get('text','')+' '+n.get('content-desc','')) and h.visible(n)]
        if rows:h.tap_node(rows[0]);break
        h.scroll()
    else:raise RuntimeError('Synthetic aircraft list row unavailable')
    text('left');h.capture('sky-follow-relative')
    for elevation,roll,label in [(30,0,'raised'),(60,0,'high'),(30,35,'rolled')]:
        point(0,elevation,roll);text('Pointing ');text('Move the phone');h.capture('sky-point-'+label)
    h.done('Selected aircraft has relative bearing and raised/high/rolled native viewfinder guidance')
    for rotation,scale,label in [('1','1.0','landscape'),('0','2.0','large-text')]:
        adb('shell','settings','put','system','accelerometer_rotation','0')
        adb('shell','settings','put','system','user_rotation',rotation);time.sleep(3)
        adb('shell','settings','put','system','font_scale',scale);time.sleep(3)
        text('Pointing ');h.capture('sky-point-'+label)
        text('Move the phone');h.capture('sky-point-'+label+'-guidance')
    adb('shell','settings','put','system','user_rotation','0');time.sleep(3)
    adb('shell','settings','put','system','font_scale','1.0');time.sleep(2)
    h.done('Pointing UI remains usable in landscape and 200% text; captures require visual review')
    inject('0:0:9.80665','-50:0:-20');text('Facing E · compass')
    h.click('Follow');sensors('off',0);h.capture('sky-follow-off')
    h.click('Follow');text('Facing E · compass')
    h.tap('Construct menu');sensors('menu',0);h.tap('Return to module');text('Facing E · compass');sensors('menu-return',1)
    h.done('Flat return, explicit Off and native-menu pause release the compass; menu return resumes')
    adb('shell','cmd','statusbar','expand-settings');time.sleep(3)
    system=adb('shell','dumpsys','activity','activities');client=adb('shell','dumpsys','activity','dev.construct.runtime/.ModuleActivity')
    (h.RESULTS/'sky-focus-system.txt').write_text(system);(h.RESULTS/'sky-focus-client.txt').write_text(client)
    assert resumed_unfocused(system,client),'Expected resumed-but-unfocused module under Quick Settings'
    sensors('quick-settings',0);h.capture('sky-follow-quick-settings')
    adb('shell','cmd','statusbar','collapse');time.sleep(2)
    text('lost the foreground');sensors('focus-return',0)
    inject('0:0:9.80665','0:50:-20');time.sleep(2);sensors('still-off',0)
    h.click('Follow');text('Facing N · compass');sensors('explicit-restart',1)
    h.done('Quick Settings ends Follow with explanation and no silent restart; explicit tap restores it')
    h.access();h.switch('Allow reading compass and tilt')
    if 'Turn off' in h.labels():h.tap('Turn off')
    h.native_status('Allow reading compass and tilt: off.');reopen()
    h.click('Follow');text('Allow reading compass and tilt');sensors('revoked',0)
    adb('shell','am','force-stop','dev.construct.runtime');h.open_module('Synthetic Sky',version['version']);h.area();sensors('restart',0)
    h.done('Revocation denies new Follow watches and process restart starts with zero compass listeners')
