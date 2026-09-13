#!/usr/bin/env python3
"""Build signed, deterministic demo packages. Private key never enters the repo."""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import zipfile

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

ROOT = Path(__file__).resolve().parents[1]
KEY_DIR = Path(os.environ.get('CONSTRUCT_SIGNING_DIR', Path.home() / '.local/share/construct-signing')).expanduser().resolve()


def signing_key():
    if KEY_DIR == ROOT or ROOT in KEY_DIR.parents:
        raise ValueError('Signing directory must be outside the source checkout')
    KEY_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = KEY_DIR / 'module-development.pem'
    if not path.exists():
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        data = key.private_bytes(serialization.Encoding.PEM,
                                 serialization.PrivateFormat.PKCS8,
                                 serialization.NoEncryption())
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
    return serialization.load_pem_private_key(path.read_bytes(), password=None)


def package(key, version):
    source = ROOT / 'examples/hello-module'
    manifest = json.loads((source / 'manifest.json').read_text())
    manifest['version'] = version
    files = {'manifest.json': json.dumps(manifest, indent=2).encode()}
    for path in sorted((source / 'ui').rglob('*')):
        if path.is_file():
            files[path.relative_to(source).as_posix()] = path.read_bytes().replace(
                b'__VERSION__', version.encode())
    if version == '0.2.1':
        files['ui/app.js'] = b"'use strict'; throw new Error('Intentional startup failure fixture');\n"
        manifest['description'] = 'Intentionally broken startup fixture: expect JAVASCRIPT_ERROR, then restore the previous version.'
        files['manifest.json'] = json.dumps(manifest, indent=2).encode()
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    blob = buffer.getvalue()
    signature = key.sign(blob, padding.PKCS1v15(), hashes.SHA256())
    key.public_key().verify(signature, blob, padding.PKCS1v15(), hashes.SHA256())
    return blob, {
        'id': manifest['id'], 'name': manifest['name'], 'version': version,
        'artifact': f'hello-module-{version}.zip',
        'sha256': hashlib.sha256(blob).hexdigest(),
        'signature': base64.b64encode(signature).decode(),
    }


def main():
    key = signing_key()
    output = ROOT / 'dist/registry'
    output.mkdir(parents=True, exist_ok=True)
    versions = []
    for version in ('0.1.0', '0.2.0', '0.2.1'):
        blob, metadata = package(key, version)
        (output / metadata['artifact']).write_bytes(blob)
        if version == '0.2.1':
            metadata['testFixture'] = True
        versions.append(metadata)
    (output / 'index.json').write_text(json.dumps({
        'schemaVersion': 1,
        'modules': [{'id': 'dev.construct.hello', 'name': 'Hello Module',
                     'latest': '0.2.0', 'versions': versions}],
    }, indent=2) + '\n')
    assets = ROOT / 'core/app/src/main/assets'
    assets.mkdir(parents=True, exist_ok=True)
    (assets / 'registry-public.der').write_bytes(key.public_key().public_bytes(
        serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo))
    shutil.copytree(output, assets / 'demo', dirs_exist_ok=True)
    print('Built two signed working demos plus an intentional startup-failure fixture, registry index, and pinned public-key asset.')


if __name__ == '__main__':
    main()
