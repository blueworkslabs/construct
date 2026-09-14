#!/usr/bin/env python3
"""Fail closed on wrong-architecture/heavy native packaging; report actual APK bytes."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import zipfile

MACHINES = {'arm64-v8a': 183, 'x86_64': 62}

def check_elf(data, abi):
    if len(data) < 64 or data[:6] != b'\x7fELF\x02\x01':
        raise ValueError('Expected little-endian 64-bit ELF')
    if struct.unpack_from('<H', data, 18)[0] != MACHINES[abi]:
        raise ValueError('ELF machine does not match APK architecture')
    offset = struct.unpack_from('<Q', data, 32)[0]
    stride, count = struct.unpack_from('<HH', data, 54)
    if stride != 56 or not count or offset + stride * count > len(data):
        raise ValueError('Invalid ELF program headers')
    loads = 0
    for index in range(count):
        kind, _, file_offset, virtual, _, _, _, alignment = struct.unpack_from('<IIQQQQQQ', data, offset + index * stride)
        if kind == 1:
            loads += 1
            if alignment < 16384 or (virtual-file_offset) % 16384:
                raise ValueError('Native load segment is not 16 KB compatible')
    if not loads:
        raise ValueError('ELF has no load segments')

def inspect(path, abi, max_mb):
    size = path.stat().st_size
    if size > max_mb * 1_000_000:
        raise ValueError('APK exceeds explicit size budget')
    libraries = {}
    with zipfile.ZipFile(path) as apk:
        for entry in apk.infolist():
            if not entry.filename.startswith('lib/') or entry.is_dir():
                continue
            parts = entry.filename.split('/')
            if len(parts) != 3 or parts[1] != abi or not parts[2].endswith('.so'):
                raise ValueError('Unexpected native architecture or layout')
            if 'opencv_java' in parts[2]:
                raise ValueError('Full OpenCV JNI runtime must not be packaged')
            data = apk.read(entry)
            check_elf(data, abi)
            libraries[parts[2]] = {'bytes': len(data), 'apkBytes': entry.compress_size,
                                  'sha256': hashlib.sha256(data).hexdigest()}
        if 'libconstruct_measure.so' not in libraries:
            raise ValueError('Measurement bridge missing')
        manifest = Path(__file__).with_name('vision-assets.json')
        for entry in json.loads(manifest.read_text()):
            if entry['kind'] == 'model':
                data = apk.read('assets/vision/' + entry['name'])
                if len(data) != entry['bytes'] or hashlib.sha256(data).hexdigest() != entry['sha256']:
                    raise ValueError('Bundled vision model changed')
    return {'apk': path.name, 'bytes': size, 'abi': abi,
            'sha256': hashlib.sha256(path.read_bytes()).hexdigest(), 'native': libraries}

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('apk', type=Path)
    parser.add_argument('--abi', choices=MACHINES, required=True)
    parser.add_argument('--max-mb', type=float, required=True)
    args = parser.parse_args()
    print(json.dumps(inspect(args.apk, args.abi, args.max_mb), indent=2))
