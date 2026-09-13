#!/usr/bin/env python3
"""Snake controls, saved state and interruptions on a clean staging emulator."""
from config import CONFIG, SERIAL, require_runner
import json
import os
import re
import socket
import struct
import time
from ui import adb, nodes, labels, tap, tap_node, find, capture, RESULTS
from host_ui import restart, diagnostics, select_after, installed_status
require_runner()
expected=os.environ['CONSTRUCT_SNAKE_SHA256']
heading='Pocket Snake · 0.1.5'
result={'complete':False,'moduleSha256':expected,'checks':[]}

def done(name): result['checks'].append(name); print('PASS:',name,flush=True)
def top():
    for _ in range(8):
        if 'Use configured registry' in labels(): return
        adb('shell','input','swipe','360','450','360','1050','300')
    raise RuntimeError('Host controls missing')
def card(action): top(); select_after(heading,(action,))
def opened(): card('Open'); find('Pocket Snake')
def board():
    for n in nodes():
        text=n.get('text') or n.get('content-desc','')
        m=re.fullmatch(r'Game board\. Head (\d+), (\d+)\. Facing (\w+)\. Moves (\d+)\.',text)
        if m:return {'x':int(m[1]),'y':int(m[2]),'direction':m[3],'moves':int(m[4]),'label':text,'node':n}
    raise RuntimeError('Accessible game board missing')
def stable_board():
    previous=board()
    for _ in range(10):
        time.sleep(.15);current=board()
        if current['label']==previous['label']:return current
        previous=current
    raise RuntimeError('Paused board did not settle')
def number(prefix):
    values=[s for s in labels() if re.fullmatch(prefix+r' \d+',s)]
    if len(values)!=1:raise RuntimeError('Missing unique '+prefix)
    return int(values[0].split()[-1])
def access(on):
    if 'Construct menu' in labels() or 'Close module' in labels():tap('Module access')
    else:card('Module access')
    label='Allow saving data on this phone';find(label)
    matches=[n for n in nodes() if n.get('content-desc')==label and n.get('checkable')=='true']
    if len(matches)!=1:raise RuntimeError('Storage toggle missing')
    if (matches[0].get('checked')=='true')!=on:
        tap_node(matches[0])
        if not on:tap('Turn off')
        find(label+': '+('on.' if on else 'off.'))
    tap('Reopen module');find('Pocket Snake')

def controls():
    # Acquire stable visible controls while paused. During play, HTTP hierarchy
    # reads are too slow for a 300ms game tick; issue the bounded input sequence
    # directly, then inspect evidence after pausing. Fixed toolbar widths keep
    # Play/Resume from moving the Pause target.
    wanted={'Pause','Turn up','Turn left'}
    previous=None
    for _ in range(12):
        current={}
        for n in nodes():
            text=n.get('text') or n.get('content-desc','')
            if text in wanted: current[text]=n
        positions={k:v.get('bounds') for k,v in current.items()}
        if len(current)==len(wanted) and positions==previous:return current
        previous=positions;time.sleep(.2)
    raise RuntimeError('Game controls not stable')

def rotate(rotation):
    adb('shell','wm','user-rotation','lock',str(rotation))
    deadline=time.monotonic()+10
    while time.monotonic()<deadline:
        raw=adb('exec-out','screencap','-p',binary=True)
        width,height=struct.unpack('>II',raw[16:24])
        if (width>height)==bool(rotation):
            result.setdefault('orientations',[]).append({'rotation':rotation,'width':width,'height':height})
            return raw
        time.sleep(.3)
    raise RuntimeError('Requested display rotation never settled')

def fresh_game():
    tap('New game');find('New game ready. Best score kept.');find('Play')

try:
    restart()
    import ui
    nodes()
    field=ui._device(className='android.widget.EditText')
    if field.count!=1:raise RuntimeError('Catalog field not unique')
    url=CONFIG.test_catalog
    field.set_text(url)
    if field.get_text()!=url:raise RuntimeError('Catalog URL mismatch')
    adb('shell','input','keyevent','111');tap('Refresh catalog')
    select_after(heading,('Review & install',));tap('Allow & install');installed_status()
    top();es=diagnostics();installs=[e for e in es if e.get('moduleId')=='dev.construct.snake' and e.get('code')=='INSTALLED_TRIAL']
    if len(installs)!=1 or installs[0].get('packageDigest')!=expected:raise RuntimeError('Wrong signed Snake candidate')
    opened();find('Play');initial=board()
    if (initial['x'],initial['y'],initial['moves'])!=(6,9,0):raise RuntimeError('Unexpected initial board')
    x1,y1,x2,y2=map(int,re.findall(r'\d+',initial['node'].get('bounds')))
    result['portraitBoardPx']={'width':x2-x1,'height':y2-y1}
    if x2-x1<500:raise RuntimeError('Portrait board does not reclaim the available viewport')
    capture('snake-ready');tap_node(initial['node']);find('Game over',timeout=15)
    if not any('New best!' in s for s in labels()):raise RuntimeError('New-best feedback missing')
    score=number('Score');best=number('Best')
    if score<1 or score!=best:raise RuntimeError('Straight run failed fruit/high-score check')
    capture('snake-game-over');tap('Close module');restart();opened();find('Game over')
    if number('Best')!=best:raise RuntimeError('Best did not survive restart')
    done('Exact signed Canvas game eats fruit, hits wall and persists its best score')
    fresh_game();c=controls();tap('Play');tap_node(c['Turn up']);time.sleep(.5);tap_node(c['Pause']);time.sleep(.3);find('Paused')
    paused=stable_board()
    if paused['direction']!='up' or paused['moves']<1:raise RuntimeError('Directional input not applied')
    capture('snake-paused');tap('Close module');restart();opened();find('Resume')
    if stable_board()['label']!=paused['label'] or number('Best')!=best:raise RuntimeError('Paused game changed on restart')
    time.sleep(.7)
    if board()['label']!=paused['label']:raise RuntimeError('Reopened game advanced without Resume')
    done('Directional controls work; complete board and high score reopen paused')
    fresh_game();c=controls();b=board();x1,y1,x2,y2=map(int,re.findall(r'\d+',b['node'].get('bounds')))
    tap('Play');adb('shell','input','swipe',str((x1+x2)//2),str(y1+(y2-y1)*3//4),str((x1+x2)//2),str(y1+(y2-y1)//4),'180')
    time.sleep(.35);tap_node(c['Pause']);find('Paused')
    if stable_board()['direction']!='up':raise RuntimeError('Swipe did not turn Snake')
    fresh_game();c=controls();tap('Play');tap_node(c['Turn left']);time.sleep(.5);tap_node(c['Pause']);find('Paused')
    opposite=stable_board()
    if opposite['direction']!='right' or opposite['moves']<1:raise RuntimeError('Reverse input accepted or no move observed')
    done('Real swipe turns; opposite-direction button cannot reverse into the body')
    tap('Resume');adb('shell','input','keyevent','3');time.sleep(.5)
    restart();opened();find('Resume');saved=stable_board()['label'];tap('Close module')
    adb('shell','svc','wifi','disable');adb('shell','svc','data','disable')
    try:
        restart();opened();find('Resume')
        if stable_board()['label']!=saved:raise RuntimeError('Offline reopening lost board')
        capture('snake-offline-paused')
    finally:
        adb('shell','svc','wifi','enable');adb('shell','svc','data','enable')
    done('Backgrounding stops play; offline process restart preserves the last saved board')
    # Same WebView stays on-screen; portrait/landscape must not create a new run.
    tap('Construct menu');find('Return to module');capture('snake-menu')
    adb('shell','input','keyevent','4');find('Resume')
    if stable_board()['label']!=saved:raise RuntimeError('Menu changed paused board')
    # Back from a module is non-destructive, and diagnostics retain the same session.
    adb('shell','input','keyevent','4');find('Return to module')
    tap('Diagnostics');find('Copy diagnostics');find('Back to menu')
    capture('snake-diagnostics')
    tap('Back to menu');find('Return to module');tap('Return to module');find('Resume')
    if stable_board()['label']!=saved:raise RuntimeError('In-session diagnostics lost the board')
    done('Back opens native controls; diagnostics and return retain the same paused session')
    raw=rotate(1);find('Pocket Snake');find('Resume')
    time.sleep(.7)
    capture('snake-landscape')
    if 'Installed' in labels():raise RuntimeError('Rotation returned to host')
    if stable_board()['label']!=saved:raise RuntimeError('Landscape changed paused game')
    # Board and all controls fit the landscape screen without scrolling and avoid native menu.
    menu=find('Construct menu');bx1,by1,bx2,by2=map(int,re.findall(r'\d+',board()['node'].get('bounds')))
    mx1,my1,mx2,my2=map(int,re.findall(r'\d+',menu.get('bounds')))
    result['landscapeBoardPx']={'width':bx2-bx1,'height':by2-by1,'bounds':[bx1,by1,bx2,by2],'menuBounds':[mx1,my1,mx2,my2]}
    if bx2-bx1<390:raise RuntimeError('Landscape board is too small for the available viewport')
    if min(bx2,mx2)>max(bx1,mx1) and min(by2,my2)>max(by1,my1):raise RuntimeError('Menu overlaps game board')
    c=controls();tap('Resume');tap_node(c['Turn up']);time.sleep(.35);tap_node(c['Pause']);find('Paused')
    saved=stable_board()['label']
    rotate(0);find('Resume')
    if stable_board()['label']!=saved:raise RuntimeError('Portrait return lost live board')
    capture('snake-portrait-return')
    # Opening the native menu while playing must pause, including after menu dismissal.
    fresh_game();menu_target=find('Construct menu')
    tap('Play');time.sleep(.4);tap_node(menu_target);find('Return to module')
    time.sleep(1);tap('Return to module');find('Paused')
    saved=stable_board()['label'];time.sleep(.6)
    if board()['label']!=saved:raise RuntimeError('Menu dismissal auto-resumed play')
    done('Native menu pauses play; same module survives landscape, controls and portrait return')
    fresh_game();tap('Play');time.sleep(.4);rotate(1);find('Paused')
    saved=stable_board()['label'];time.sleep(.6)
    if board()['label']!=saved:raise RuntimeError('Rotation left gameplay advancing')
    rotate(0);find('Resume')
    if stable_board()['label']!=saved:raise RuntimeError('Rotation while playing lost the settled board')
    done('Rotating during active gameplay pauses in place without subsequent catch-up')
    access(False);find('Save unavailable')
    if not any('CAPABILITY_DENIED' in s for s in labels()):raise RuntimeError('Storage denial not visible')
    access(True);find('Resume')
    if stable_board()['label']!=saved or number('Best')!=best:raise RuntimeError('Regrant failed to restore saved game/best')
    capture('snake-recovered');tap('Close module');top();es=diagnostics()
    result['events']=[e for e in es if e.get('moduleId')=='dev.construct.snake']
    if any(e.get('code') in ('JAVASCRIPT_ERROR','RENDERER_STOPPED') for e in result['events']):raise RuntimeError('Unexpected Snake runtime failure')
    meta=[e for e in es if e.get('code')=='ENVIRONMENT']
    if len(meta)!=1:raise RuntimeError('Missing environment metadata')
    result['environment']=meta[0]
    done('Revoked storage pauses safely; regrant restores saved game without resetting best')
    result['complete']=True
except Exception as error:
    result['error']=str(error)
    try:capture('snake-failure')
    except Exception:pass
    raise
finally:
    adb('shell','wm','user-rotation','lock','0')
    (RESULTS/'snake-result.json').write_text(json.dumps(result,indent=2)+'\n')
