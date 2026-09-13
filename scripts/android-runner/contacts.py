#!/usr/bin/env python3
"""Synthetic-only contacts acceptance on disposable staging; no real phone data."""
from config import CONFIG, SERIAL, require_runner
import json, os, re, socket, time, struct
from ui import adb, nodes, labels, tap, tap_node, find, capture, RESULTS
from host_ui import restart, diagnostics, select_after, installed_status
require_runner()
expected=os.environ['CONSTRUCT_CONTACTS_SHA256'];heading='Pocket Contacts · 0.2.1'
result={'complete':False,'checks':[]}
def done(name):result['checks'].append(name);print('PASS:',name,flush=True)
def top():
    for _ in range(10):
        if 'Use configured registry' in labels():return
        adb('shell','input','swipe','360','450','360','1050','300')
    raise RuntimeError('Host controls missing')
def card(action):
    top();(RESULTS/'contacts-card-before.json').write_text(json.dumps([dict(n.attrib) for n in nodes()],indent=2)+'\n');select_after(heading,(action,))
def opened():
    restart();find('Trial — not yet marked working');card('Open');find('Pocket Contacts')
def status(prefix):
    until=time.monotonic()+12
    while time.monotonic()<until:
        if any(s.startswith(prefix) for s in labels()):return
        time.sleep(.25)
    raise RuntimeError('Missing status '+prefix)
def web_find(text,up=False):
    for _ in range(12):
        if text in labels():return find(text)
        adb('shell','input','swipe','360','650' if up else '1100','360','1100' if up else '650','250')
    raise RuntimeError('WebView text not visible: '+text)
def web_button(text):
    # Result names also occur in the search EditText and keyboard suggestions.
    # Only a real enabled WebView button may satisfy this action.
    previous=None
    for _ in range(16):
        candidates=[n for n in nodes() if n.get('class')=='android.widget.Button' and n.get('text')==text and n.get('package')=='dev.construct.runtime' and n.get('enabled')=='true']
        if len(candidates)==1:
            current=candidates[0]
            if current.get('bounds')==previous:
                tap_node(current);return
            previous=current.get('bounds');time.sleep(.3)
        else:
            previous=None;adb('shell','input','swipe','360','1100','360','650','250')
    raise RuntimeError('Unique WebView button missing: '+text)
def query(text):
    web_find('Contact name',up=True)
    def field():
        choices=[n for n in nodes() if n.get('class')=='android.widget.EditText' and n.get('package')=='dev.construct.runtime' and n.get('enabled')=='true']
        if len(choices)!=1:raise RuntimeError('Unique search field missing')
        return choices[0]
    tap_node(field())
    # Reopening can expose the field before IME focus/layout has settled. Wait
    # for focused, stable input; replacement is idempotent and bounded to twice.
    previous=None;until=time.monotonic()+10
    while time.monotonic()<until:
        n=field();bounds=n.get('bounds')
        if n.get('focused')=='true' and bounds==previous:break
        previous=bounds;time.sleep(.4)
    else:raise RuntimeError('Search field did not settle with focus')
    for attempt in range(2):
        adb('shell','input','keycombination','113','29');adb('shell','input','keyevent','67')
        if text:adb('shell','input','text',text)
        time.sleep(.4)
        if field().get('text','')==text:break
        if attempt==0:print('Retrying synthetic query replacement after input mismatch',flush=True)
    else:raise RuntimeError('Search input does not exactly match synthetic query')
    # Escape clears HTML input[type=search]; Android Back dismisses its keyboard.
    adb('shell','input','keyevent','4');tap('Search')
def reach(text):
    for _ in range(10):
        if text in labels():return
        adb('shell','input','swipe','360','1080','360','600','300')
    raise RuntimeError('Native access control not visible: '+text)
def native_tap(text):
    reach(text);tap(text)
    if text=='Reopen module':find('Ready to search. Or choose Browse contacts.')
def grant_switch():
    find('Allow reading contacts');previous=None;until=time.monotonic()+10
    while time.monotonic()<until:
        choices=[n for n in nodes() if n.get('content-desc')=='Allow reading contacts' and n.get('checkable')=='true']
        if len(choices)==1:
            current=choices[0]
            if previous==current.get('bounds'):return current
            previous=current.get('bounds')
        time.sleep(.2)
    raise RuntimeError('Contacts grant switch missing or moving')
def switch(on):
    reach('Allow reading contacts');choice=grant_switch()
    if (choice.get('checked')=='true')!=on:
        tap_node(choice)
        if not on:tap('Turn off')
        find('Allow reading contacts: '+('on.' if on else 'off.'))
def insert(uri,bindings):
    args=['shell','content','insert','--uri',uri]
    for b in bindings:args+=['--bind',b]
    out=adb(*args)
    if 'Error' in out or 'Exception' in out:raise RuntimeError('Synthetic contacts seeding failed')
    return out

def seed():
    for i in reversed(range(26)):
        insert('content://com.android.contacts/raw_contacts',['sourceid:s:construct-'+str(i),'aggregation_mode:i:3'])
        out=adb('shell','content','query','--uri','content://com.android.contacts/raw_contacts','--projection','_id:sourceid')
        rows=[line for line in out.splitlines() if re.search(r'sourceid=construct-'+str(i)+r'(?:,|$)',line)]
        matches=[re.search(r'_id=(\d+)',line) for line in rows]
        if len(matches)!=1 or not matches[0]:raise RuntimeError('No unique synthetic raw contact id')
        rid=matches[0][1]
        insert('content://com.android.contacts/data',['raw_contact_id:l:'+rid,'mimetype:s:vnd.android.cursor.item/name','data2:s:'+(['MüllerSample','AnnSample','JordanSample'][i-23] if i>=23 else 'ConstructTest%02d'%(19 if i==20 else i))])
        if i==0:
            insert('content://com.android.contacts/data',['raw_contact_id:l:'+rid,'mimetype:s:vnd.android.cursor.item/phone_v2','data1:s:+15550100000','data2:i:2'])
            insert('content://com.android.contacts/data',['raw_contact_id:l:'+rid,'mimetype:s:vnd.android.cursor.item/email_v2','data1:s:synthetic@example.invalid','data2:i:1'])
    result['syntheticContacts']=26
try:
    restart()
    for n in nodes():
        if n.get('class')=='android.widget.EditText':
            tap_node(n);adb('shell','input','keycombination','113','29');adb('shell','input','text',CONFIG.test_catalog);break
    else:raise RuntimeError('Catalog field missing')
    adb('shell','input','keyevent','111');tap('Refresh catalog');find('Catalog refreshed.');select_after(heading,('Review & install',))
    # The opt-in defaults off; install without changing it.
    if grant_switch().get('checked')!='false':raise RuntimeError('Contacts not off by default')
    tap('Allow & install');installed_status()
    top();events=diagnostics()
    installs=[e for e in events if e.get('moduleId')=='dev.construct.contacts' and e.get('code')=='INSTALLED_TRIAL']
    if len(installs)!=1 or installs[0].get('packageDigest')!=expected:raise RuntimeError('Wrong signed candidate')
    opened();tap('Search');find('Enter a name, or choose Browse contacts.');tap('Browse contacts');status('[CAPABILITY_DENIED]');capture('contacts-module-denied');tap('Module access');switch(True)
    native_tap('Reopen module');tap('Browse contacts');status('[ANDROID_PERMISSION_DENIED]');tap('Module access')
    done('Signed install defaults off; module grant alone cannot bypass Android permission')
    if adb('shell','getprop','ro.kernel.qemu').strip()!='1' or adb('shell','getprop','ro.build.type').strip()!='userdebug':
        raise RuntimeError('Synthetic seeding requires disposable userdebug emulator')
    try:
        adb('root',timeout=30);adb('wait-for-device',timeout=30)
        if adb('shell','id','-u').strip()!='0':raise RuntimeError('Synthetic seeding root unavailable')
        seed()
    finally:
        adb('unroot',timeout=30);adb('wait-for-device',timeout=30)
        result['adbUnrooted']=adb('shell','id','-u').strip()!='0'
        if not result['adbUnrooted']:raise RuntimeError('Must unroot before permission acceptance')
    native_tap('Allow Android contacts access')
    # Actual Android permission dialog, not pm grant for the positive flow.
    find('Allow');tap('Allow');find('Android contacts access: allowed');native_tap('Reopen module')
    query('ConstructTest00');status('1 contact shown.');web_button('ConstructTest00');status('Contact details. Read only.');web_find('Mobile: +15550100000');web_find('Home: synthetic@example.invalid');capture('contacts-detail');web_find('Back to results',up=True);web_button('Back to results')
    done('Android permission dialog enables bounded name search and typed synthetic phone/email detail')
    query('NoSuchSyntheticContact');status('No matching contacts.')
    query('ConstructTest');status('20 contacts shown.')
    first=[n.get('text') for n in nodes() if n.get('class')=='android.widget.Button' and (n.get('text') or '').startswith('ConstructTest')]
    if not first or first[0]!='ConstructTest00':raise RuntimeError('Search is not alphabetical despite reversed insertion order')
    # More is beneath the first page; scroll within WebView, never invoke an unrelated card.
    for _ in range(12):
        if 'More results' in labels():break
        adb('shell','input','swipe','360','1100','360','650','250')
    tap('More results')
    for _ in range(12):
        if any(s.startswith('23 contacts shown.') for s in labels()):break
        adb('shell','input','swipe','360','650','360','1100','250')
    status('23 contacts shown.');capture('contacts-page-two')
    done('Empty search result and keyset pagination return exactly 23 synthetic contacts')
    query('muller');status('1 contact shown.');web_find('MüllerSample')
    query('an');status('1 contact shown.');web_find('AnnSample')
    if 'JordanSample' in labels():raise RuntimeError('Substring-only match leaked into token search')
    query('ConstructTest19');status('2 contacts shown.')
    done('Provider matching folds the tested accent and respects word starts; equal sort keys remain distinct')
    web_find('Contact name',up=True);tap('Browse contacts');status('20 contacts shown.')
    first=[n.get('text') for n in nodes() if n.get('class')=='android.widget.Button' and n.get('text') in ('AnnSample','ConstructTest00')]
    if not first or first[0]!='AnnSample':raise RuntimeError('Browse is not alphabetical')
    web_find('More results');web_button('More results');web_find('26 contacts shown.',up=True)
    capture('contacts-alpha8-browse')
    done('Explicit Browse is alphabetical and bounded across all 26 synthetic contacts')
    tap('Module access');switch(False);native_tap('Reopen module');tap('Browse contacts');status('[CAPABILITY_DENIED]')
    tap('Close module');restart();opened();tap('Browse contacts');status('[CAPABILITY_DENIED]')
    tap('Module access');switch(True);native_tap('Reopen module');query('ConstructTest00');status('1 contact shown.')
    done('Revoking module access clears the view and persists through process restart while Android stays allowed')
    adb('shell','pm','revoke','dev.construct.runtime','android.permission.READ_CONTACTS')
    restart();opened();tap('Browse contacts');status('[ANDROID_PERMISSION_DENIED]');capture('contacts-android-revoked')
    tap('Module access');find('Android contacts access: not allowed')
    done('Android permission revocation denies access despite the persisted module grant')
    # Restore by Android UI; then prove offline read and background clear/requery.
    native_tap('Allow Android contacts access');find('Allow');tap('Allow');find('Android contacts access: allowed');native_tap('Reopen module')
    adb('shell','svc','wifi','disable');adb('shell','svc','data','disable')
    try:
        query('ConstructTest00');status('1 contact shown.');web_button('ConstructTest00');status('Contact details. Read only.');web_find('Home: synthetic@example.invalid')
        adb('shell','input','keyevent','3');restart();opened();find('Ready to search. Or choose Browse contacts.')
        if any(token in json.dumps(labels(),ensure_ascii=False) for token in ('synthetic@example.invalid','ConstructTest00')):raise RuntimeError('Contact detail or query persisted on reopen')
    finally:
        adb('shell','svc','wifi','enable');adb('shell','svc','data','enable')
    query('ConstructTest00');status('1 contact shown.')
    fields=[n for n in nodes() if n.get('class')=='android.widget.EditText' and n.get('package')=='dev.construct.runtime']
    if len(fields)!=1:raise RuntimeError('Missing search field before keyboard rotation')
    tap_node(fields[0]);time.sleep(.7)
    try:
        adb('shell','wm','user-rotation','lock','1')
        until=time.monotonic()+12
        while time.monotonic()<until:
            raw=adb('exec-out','screencap','-p',binary=True);width,height=struct.unpack('>II',raw[16:24])
            if width>height:break
            time.sleep(.3)
        else:raise RuntimeError('Contacts landscape did not settle')
        find('Pocket Contacts');find('Construct menu')
        fields=[n for n in nodes() if n.get('class')=='android.widget.EditText' and n.get('package')=='dev.construct.runtime']
        if len(fields)!=1 or fields[0].get('text')!='ConstructTest00':raise RuntimeError('Rotation lost focused search text')
        # Android may rebuild its IME during rotation; explicitly focus it before Back.
        tap_node(fields[0]);time.sleep(.7)
        capture('contacts-landscape-keyboard')
        adb('shell','input','keyevent','4');find('Pocket Contacts')
    finally:
        adb('shell','wm','user-rotation','lock','0')
    find('Pocket Contacts');status('1 contact shown.')
    done('Landscape keeps contact search and keyboard text in the same module; Back dismisses keyboard')
    tap('Close module');top();events=diagnostics()
    if any(s in json.dumps(events,ensure_ascii=False) for s in ('ConstructTest','MüllerSample','AnnSample','JordanSample','synthetic@example.invalid','15550100000')):raise RuntimeError('Contact data leaked into diagnostics')
    meta=[e for e in events if e.get('code')=='ENVIRONMENT']
    if len(meta)!=1:raise RuntimeError('Environment metadata missing')
    result['environment']=meta[0]
    result['events']=[e for e in events if e.get('moduleId')=='dev.construct.contacts']
    if any(e.get('code') in ('JAVASCRIPT_ERROR','RENDERER_STOPPED') for e in result['events']):raise RuntimeError('Contacts runtime failure')
    done('Offline read works; background/reopen clears details; diagnostics omit synthetic personal data')
    result['complete']=True
except Exception as error:
    result['error']=str(error)
    try:capture('contacts-failure')
    except Exception:pass
    raise
finally:
    (RESULTS/'contacts-result.json').write_text(json.dumps(result,indent=2)+'\n')
