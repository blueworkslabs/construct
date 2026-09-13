#!/usr/bin/env python3
"""Fetch pinned build-time models / public test photos. No app-time download path."""
import hashlib
import json
from pathlib import Path
import urllib.request
import local_mediapipe

ROOT = Path(__file__).resolve().parents[1]

def verified(data, entry):
    if len(data) != entry['bytes'] or hashlib.sha256(data).hexdigest() != entry['sha256']:
        raise ValueError('Vision asset size/hash mismatch: ' + entry['name'])
    return data

def prepare():
    for entry in json.loads((ROOT/'scripts/vision-assets.json').read_text()):
        folder = ROOT/({'model': 'core/app/src/main/assets/vision', 'fixture': 'dist/vision-fixtures', 'runtime': 'dist/vision-runtime'}[entry['kind']])
        folder.mkdir(parents=True, exist_ok=True)
        target = folder/entry['name']
        if target.exists():
            verified(target.read_bytes(), entry)
        else:
            with urllib.request.urlopen(entry['url'], timeout=30) as response:
                if not response.url.startswith('https://'): raise ValueError('Vision download redirected away from HTTPS')
                data = verified(response.read(entry['bytes'] + 1), entry)
            stage = target.with_suffix(target.suffix + '.pending')
            try: stage.write_bytes(data); stage.replace(target)
            finally: stage.unlink(missing_ok=True)
        print('Verified vision asset:', entry['name'])
    local_mediapipe.build(ROOT, ROOT/'dist/vision-runtime/tasks-core-0.10.35.aar')

if __name__ == '__main__': prepare()
