#!/usr/bin/env python3
"""Small staging-only ADB UI driver; no Appium or changes to the target APK."""
from config import CONFIG, SERIAL, require_runner
import argparse
from http.client import RemoteDisconnected
import os
import uiautomator2 as u2
import json
from pathlib import Path
import re
import socket
import subprocess
import time
import xml.etree.ElementTree as ET

ADB=str(CONFIG.sdk/'platform-tools/adb')
RESULTS=Path(os.environ.get('CONSTRUCT_RESULTS', str(CONFIG.root/'results')))

def adb(*args, binary=False, timeout=25):
    require_runner()
    return subprocess.check_output([ADB,'-s',SERIAL,*args],timeout=timeout,text=not binary)

_device = None

def nodes():
    require_runner()
    # Keep the device-side accessibility service alive between calls. Repeated
    # one-shot `uiautomator dump` disconnects hid reopened WebView descendants.
    global _device
    if _device is None:
        os.environ.setdefault('ANDROID_HOME',str(CONFIG.sdk))
        _device=u2.connect_usb(SERIAL)
    try:
        raw=_device.dump_hierarchy(compressed=False)
    except (RemoteDisconnected, ConnectionResetError):
        # A new suite child can catch the accessibility HTTP service reconnecting.
        # Retry only this read once; never replay taps or reuse an old hierarchy.
        print('UI hierarchy transport disconnected; reconnecting once', flush=True)
        _device = None
        time.sleep(.5)
        _device = u2.connect_usb(SERIAL)
        raw = _device.dump_hierarchy(compressed=False)
    return list(ET.fromstring(raw).iter('node'))

def labels():
    return [n.attrib.get('text') or n.attrib.get('content-desc') for n in nodes() if n.attrib.get('text') or n.attrib.get('content-desc')]

def enabled(node, parents):
    while node is not None:
        if node.attrib.get('enabled') == 'false':
            return False
        node=parents.get(node)
    return True

def find(text, timeout=30):
    if text.startswith('Saved photos: '): camera_controls_top()
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        try:
            current=nodes()
        except (RuntimeError,subprocess.CalledProcessError,subprocess.TimeoutExpired):
            time.sleep(.5); continue
        parents={child:parent for parent in current for child in parent}
        for n in current:
            if text in (n.attrib.get('text'),n.attrib.get('content-desc')) and enabled(n,parents):
                return n
        time.sleep(.5)
    raise RuntimeError('UI label not found: '+text)

def tap_node(n):
    x1,y1,x2,y2=map(int,re.findall(r'\d+',n.attrib['bounds']))
    if not (x2 > x1 and y2 > y1): raise RuntimeError('Element is not visible')
    adb('shell','input','tap',str((x1+x2)//2),str((y1+y2)//2))

CAMERA_CONTROLS = {'Close camera','Back to camera','Saved photos','Find faces','Find objects',
                   'Previous photo','Next photo','Delete photo','Save to phone gallery',
                   'Take photo','Switch camera','Camera help','Hide camera help'}


def camera_controls_top():
    current=nodes()
    panes=[n for n in current if n.get('content-desc')=='Camera controls' and n.get('package')=='dev.construct.runtime']
    if not panes: return
    if len(panes)!=1: raise RuntimeError('Ambiguous native camera control panel')
    x1,y1,x2,y2=map(int,re.findall(r'\d+',panes[0].get('bounds','')))
    if x2<=x1 or y2-y1<32: raise RuntimeError('Camera controls have no viewport')
    for _ in range(5):
        adb('shell','input','swipe',str((x1+x2)//2),str(y1+(y2-y1)//5),str((x1+x2)//2),str(y2-(y2-y1)//5),'200')


def reveal_camera_control(text):
    """Scroll only the identified native camera panel, never the photo or a WebView."""
    if text not in CAMERA_CONTROLS: return
    current = nodes()
    panes = [n for n in current if n.get('content-desc') == 'Camera controls'
             and n.get('package') == 'dev.construct.runtime']
    if not panes: return  # Legacy camera layout; original selection rules apply.
    if len(panes) != 1: raise RuntimeError('Ambiguous native camera control panel')
    x1,y1,x2,y2=map(int,re.findall(r'\d+',panes[0].get('bounds','')))
    if x2<=x1 or y2-y1<32:raise RuntimeError('Camera control panel has no usable viewport')
    x=(x1+x2)//2; top=y1+(y2-y1)//5; bottom=y2-(y2-y1)//5
    for direction, attempts in [('up',5),('down',10)]:
        for _ in range(attempts):
            current=nodes()
            parents={child:parent for parent in current for child in parent}
            if any(text in (n.get('text'),n.get('content-desc')) and enabled(n,parents)
                   and n.get('bounds') not in ('[0,0][0,0]',None) for n in current): return
            start,end=(top,bottom) if direction=='up' else (bottom,top)
            adb('shell','input','swipe',str(x),str(start),str(x),str(end),'250')
    raise RuntimeError('Native camera action not reachable: '+text)


def tap(text):
    reveal_camera_control(text)
    # Explicit native shell navigation, never an arbitrary retry of a missing module control.
    if text in ('Close module', 'Module access', 'Mark working', 'Diagnostics'):
        current = labels()
        if text not in current and 'Construct menu' in current:
            tap('Construct menu')
    # Compose can expose enabled dialog text before its enter/layout transition
    # settles. Require a stable target rectangle rather than tapping stale bounds.
    deadline = time.monotonic() + 8
    previous = find(text)
    while True:
        time.sleep(.3)
        current = find(text)
        if current.attrib.get('bounds') == previous.attrib.get('bounds'):
            tap_node(current)
            break
        if time.monotonic() > deadline: raise RuntimeError('Unstable UI target: '+text)
        previous = current
    if text == 'Close module':
        # Do not let the next host-navigation read race the closing menu/tree.
        # This is the native activity-result completion state, not a delay.
        find('Module stopped.')
    print('Tapped:',text,flush=True)

def capture(name):
    RESULTS.mkdir(parents=True,exist_ok=True)
    (RESULTS/(name+'.png')).write_bytes(adb('exec-out','screencap','-p',binary=True))
    (RESULTS/(name+'.json')).write_text(json.dumps(labels(),indent=2)+'\n')

def main():
    require_runner()
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('action',choices=['labels','tap','type','capture','scroll'])
    p.add_argument('value',nargs='?')
    a=p.parse_args()
    if a.action=='labels': print(json.dumps(labels(),indent=2))
    elif a.action=='tap': tap(a.value)
    elif a.action=='type': adb('shell','input','text',a.value)
    elif a.action=='capture': capture(a.value or 'screen')
    elif a.action=='scroll': adb('shell','input','swipe','360','1050','360','450','400')

if __name__=='__main__': main()
