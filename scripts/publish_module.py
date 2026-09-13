#!/usr/bin/env python3
"""Validate, deterministically package, sign and atomically publish a v0 module.
Existing versions are immutable. Signing identity must already exist and match
this host's pinned public key. Registry readers never see a partial index.
"""
import argparse
import base64
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import tempfile
import zipfile
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

ROOT = Path(__file__).resolve().parents[1]
ID = re.compile(r'[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+')
VERSION = re.compile(r'(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)')
PATH = re.compile(r'[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*(?:/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*)*')
EXTENSIONS = {'html', 'js', 'css', 'json', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'woff2'}
CAPS = {'storage.kv', 'log.write', 'device.toast', 'device.tone', 'contacts.read', 'camera.capture'}


def require(ok, message):
    if not ok:
        raise ValueError(message)


def validate_manifest(m):
    required = {'schemaVersion', 'id', 'name', 'version', 'constructApi', 'runtime', 'entry', 'capabilities'}
    require(required <= m.keys() <= required | {'description', 'author', 'homepage', 'themeColor'}, 'Manifest fields')
    require(type(m['schemaVersion']) is int and m['schemaVersion'] == 1, 'Schema version')
    for field, maxlen in [('id', 120), ('version', 50), ('name', 80), ('entry', 180)]:
        require(isinstance(m[field], str) and m[field].strip() and len(m[field]) <= maxlen, field)
    require(ID.fullmatch(m['id']) and VERSION.fullmatch(m['version']), 'Identity/version')
    require(m['constructApi'] in ({'min': '0.1.0', 'target': '0.1.0'}, {'min': '0.2.0', 'target': '0.2.0'}, {'min': '0.3.0', 'target': '0.3.0'}, {'min': '0.4.0', 'target': '0.4.0'}, {'min': '0.5.0', 'target': '0.5.0'}, {'min': '0.6.0', 'target': '0.6.0'}), 'API compatibility')
    if 'themeColor' in m:
        require(isinstance(m['themeColor'], str) and re.fullmatch(r'#[0-9a-fA-F]{6}', m['themeColor']), 'Theme colour must be #RRGGBB')
        require(m['constructApi']['min'] == '0.6.0', 'Theme colour requires API 0.6.0')
    require(m['runtime'] == {'kind': 'webview-js'}, 'Runtime')
    require(PATH.fullmatch(m['entry']) and m['entry'].endswith('.html'), 'Entry path')
    caps = m['capabilities']
    require(isinstance(caps, list) and len(caps) <= len(CAPS), 'Capabilities')
    for cap in caps:
        require({'id', 'reason'} <= cap.keys() <= {'id', 'reason', 'optional'}, 'Capability fields')
        require(cap['id'] in CAPS, 'Unknown capability')
        require(cap['id'] != 'device.tone' or m['constructApi']['min'] in ('0.2.0', '0.3.0', '0.4.0', '0.5.0', '0.6.0'), 'Tone requires API 0.2.0')
        require(cap['id'] != 'contacts.read' or m['constructApi']['min'] in ('0.3.0', '0.4.0', '0.5.0', '0.6.0'), 'Contacts require API 0.3.0')
        require(cap['id'] != 'camera.capture' or m['constructApi']['min'] in ('0.4.0', '0.5.0', '0.6.0'), 'Camera requires API 0.4.0')
        require(isinstance(cap['reason'], str) and 0 < len(cap['reason'].strip()) <= 240, 'Capability reason')
        require('optional' not in cap or type(cap['optional']) is bool, 'Optional flag')
    require(len({c['id'] for c in caps}) == len(caps), 'Duplicate capability')
    for field, maxlen in [('description', 500), ('author', 120), ('homepage', 500)]:
        require(field not in m or isinstance(m[field], str) and len(m[field]) <= maxlen, field)


def build(source, key, version=None):
    source = Path(source)
    require(source.is_dir() and not source.is_symlink(), 'Source must be a real directory')
    require(not (source / 'manifest.json').is_symlink(), 'Symlink manifest')
    m = json.loads((source / 'manifest.json').read_text())
    if version is not None:
        m['version'] = version
    validate_manifest(m)
    files = {'manifest.json': json.dumps(m, indent=2).encode()}
    require(len(files['manifest.json']) <= 32768, 'Manifest size')
    # Dedicated package source: no ignored/private files are silently included.
    for path in sorted(source.rglob('*')):
        require(not path.is_symlink(), 'Symlinks are not package inputs')
        if path.is_dir():
            continue
        name = path.relative_to(source).as_posix()
        if name == 'manifest.json':
            continue
        require(path.is_file() and len(name) <= 180 and PATH.fullmatch(name), 'Invalid package path')
        require(path.suffix[1:] in EXTENSIONS, 'Unsupported package file')
        require(path.stat().st_size <= 2 * 1024 * 1024, 'File too large')
        data = path.read_bytes()
        if path.suffix in {'.html', '.js', '.css'}:
            data = data.replace(b'__VERSION__', m['version'].encode())
        files[name] = data
    require(m['entry'] in files, 'Entry missing')
    require(len(files) <= 128 and sum(map(len, files.values())) <= 12 * 1024 * 1024, 'Expanded limits')
    require(all(len(v) <= 2 * 1024 * 1024 for v in files.values()), 'File limit')
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    blob = buffer.getvalue()
    require(len(blob) <= 4 * 1024 * 1024, 'ZIP size')
    signature = key.sign(blob, padding.PKCS1v15(), hashes.SHA256())
    key.public_key().verify(signature, blob, padding.PKCS1v15(), hashes.SHA256())
    return blob, dict(id=m['id'], name=m['name'], version=m['version'],
        artifact=f"{m['id']}-{m['version']}.zip", sha256=hashlib.sha256(blob).hexdigest(),
        signature=base64.b64encode(signature).decode())


def sync_dir(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic_write(path, data):
    fd, temp = tempfile.mkstemp(prefix='.publish-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fchmod(stream.fileno(), 0o644)
            os.fsync(stream.fileno())
        os.replace(temp, path)
        sync_dir(path.parent)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def publish(output, blob, metadata, latest=False, fixture=False):
    output = Path(output)
    require(not output.is_symlink(), 'Registry cannot be a symlink')
    output.mkdir(parents=True, exist_ok=True)
    metadata = dict(metadata)
    if fixture:
        metadata['testFixture'] = True
    require(not (latest and fixture), 'A fixture cannot be latest working')
    with (output / '.publish.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        index_path = output / 'index.json'
        require(not index_path.is_symlink(), 'Symlink index')
        index = json.loads(index_path.read_text()) if index_path.exists() else {'schemaVersion': 1, 'modules': []}
        require(index['schemaVersion'] == 1, 'Unsupported existing index')
        module = next((m for m in index['modules'] if m['id'] == metadata['id']), None)
        if module is None:
            module = {'id': metadata['id'], 'name': metadata['name'], 'versions': []}
            index['modules'].append(module)
        old = next((v for v in module['versions'] if v['version'] == metadata['version']), None)
        require(old is None or old == metadata, 'Published version is immutable; increment version')
        target = output / metadata['artifact']
        require(not target.is_symlink(), 'Symlink artifact')
        if target.exists():
            require(target.read_bytes() == blob, 'Artifact is immutable; increment version')
        if old is None:
            module['versions'].append(metadata)
        if latest:
            module['latest'] = metadata['version']
        require(len(index['modules']) <= 100 and all(len(m['versions']) <= 50 for m in index['modules']), 'Catalog limits')
        encoded = (json.dumps(index, indent=2) + '\n').encode()
        require(len(encoded) <= 512 * 1024, 'Catalog size')
        if not target.exists():
            atomic_write(target, blob)
        # Artifact is durable before the discoverable index references it.
        atomic_write(index_path, encoded)
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--version')
    parser.add_argument('--latest', action='store_true')
    parser.add_argument('--test-fixture', action='store_true')
    args = parser.parse_args()
    keypath = Path(os.environ.get('CONSTRUCT_SIGNING_DIR', Path.home() / '.local/share/construct-signing')).expanduser() / 'module-development.pem'
    require(keypath.is_file(), 'Initialize development signing using build_demo.py first')
    key = serialization.load_pem_private_key(keypath.read_bytes(), password=None)
    public = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    require(public == (ROOT / 'core/app/src/main/assets/registry-public.der').read_bytes(), 'Publisher differs from pinned host key')
    blob, meta = build(args.source, key, args.version)
    publish(args.output, blob, meta, args.latest, args.test_fixture)
    print(f"Published {meta['id']} {meta['version']}: {meta['sha256']}")


if __name__ == '__main__':
    main()
