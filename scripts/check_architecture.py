#!/usr/bin/env python3
"""Small, explicit architecture ratchet, not a proof of semantic decoupling."""
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
# Existing debt may shrink, not silently grow. See docs/shell-retirement.md.
NATIVE_WORKSPACES = {}
# PhotoCaptureActivity is a generic foreground acquisition surface, not an album/workflow.
ACTIVITIES = {'.MainActivity', '.ModuleActivity', '.PhotoCaptureActivity'}

def check(root=ROOT):
    errors = []
    src = root/'core/app/src/main/java/dev/construct/runtime'
    for path in src.rglob('*.kt'):
        text = path.read_text()
        if re.search(r'\bSky(?:Activity|Data|Identity|Map|Metadata|Network|Aircraft|Source|Point)\b|api\.adsb|opensky-network|tile\.openstreetmap', text):
            errors.append(f'{path.name}: aviation implementation/provider dependency belongs in a module')
        if re.search(r'\bMeasure(?:Activity|Editor|Geometry|Overlay|Sheet|Viewport|Detector|Point|Plane)\b', text):
            errors.append(f'{path.name}: measurement interpretation/workflow belongs in a module')
        if any(literal in text for literal in ('"sky.watch"', '"photo.measure"', '"camera.capture"')) and path != src/'CapabilityLifecycle.kt':
            errors.append(f'{path.name}: historical ID belongs only in the retirement registry')
        if re.search(r'\bCameraActivity\b', text):
            errors.append(f'{path.name}: camera application workflow belongs in a module')
        if re.search(r'\bDexClassLoader\b|\bInMemoryDexClassLoader\b', text):
            errors.append(f'{path.name}: downloadable native execution is not the module contract')
    capture = src/'PhotoCaptureActivity.kt'
    if capture.exists() and re.search(r'PhotoAnalyzer|GalleryExport|showGallery|analyzePhoto|deletePhoto', capture.read_text()):
        errors.append('Capture surface must not own album/analysis application workflow')
    bridge = (src/'ModuleWebView.kt').read_text()
    workspaces = dict(re.findall(r'"([\w.]+)"\s*->\s*\{\s*(\w+Activity)\.open\(', bridge))
    if workspaces != NATIVE_WORKSPACES:
        errors.append('Native workspace dispatch changed: update the explicit debt inventory; do not add launcher-only apps')
    manifest = ET.parse(root/'core/app/src/main/AndroidManifest.xml')
    activities = {n.attrib['{http://schemas.android.com/apk/res/android}name'] for n in manifest.findall('./application/activity')}
    if activities != ACTIVITIES:
        errors.append('Activity inventory changed: review host/module ownership and reduce the debt allowlist')
    return errors

if __name__ == '__main__':
    errors = check()
    for error in errors: print(error, file=sys.stderr)
    if errors: sys.exit(1)
    print('Architecture ratchet passed: no native Sky/Measure/Camera application workspaces; bounded acquisition and inference only.')
