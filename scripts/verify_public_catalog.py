#!/usr/bin/env python3
"""Verify the published catalog locally or over direct HTTPS, without signing secrets."""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import re
import urllib.request
from urllib.parse import urlsplit
import zipfile

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding

ROOT = Path(__file__).resolve().parents[1]
PUBLISHER_SHA256 = '6d82e01afd38130c7634aec030f0c2b7da10bbac1104002727529dee19374a0f'


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def verify(directory, url=None):
    public = (directory / 'publisher-public.der').read_bytes()
    if hashlib.sha256(public).hexdigest() != PUBLISHER_SHA256:
        raise ValueError('Unexpected publisher key; compare with the official APK')
    key = serialization.load_der_public_key(public)
    opener = urllib.request.build_opener(NoRedirect())
    opener.addheaders = [('User-Agent', 'Construct-Catalog-Verifier/1.0')]
    if url:
        parts = urlsplit(url)
        if (parts.scheme != 'https' or not parts.hostname or parts.username is not None
                or parts.password is not None or parts.query or parts.fragment
                or not parts.path.endswith('/index.json')):
            raise ValueError('Use the final HTTPS /index.json URL')
        base = url.rsplit('/', 1)[0] + '/'

    def read(name, limit):
        if url:
            with opener.open(base + name, timeout=20) as response:
                if response.status != 200:
                    raise ValueError('Expected HTTP 200')
                data = response.read(limit + 1)
        else:
            path = directory / name
            if path.is_symlink():
                raise ValueError('Symlink is not a published artifact')
            with path.open('rb') as stream:
                data = stream.read(limit + 1)
        if len(data) > limit:
            raise ValueError('Artifact exceeds app size limit')
        # Migration verification also proves exact local/deployed byte equality.
        if url and data != (directory / name).read_bytes():
            raise ValueError('Deployed artifact differs from this checkout: ' + name)
        return data

    index = json.loads(read('index.json', 512 * 1024))
    if index.get('schemaVersion') != 1 or not 1 <= len(index['modules']) <= 100:
        raise ValueError('Unexpected catalog schema')
    seen = set()
    count = 0
    for module in index['modules']:
        versions = module['versions']
        if not 1 <= len(versions) <= 50 or module['latest'] not in {v['version'] for v in versions}:
            raise ValueError('Invalid version list')
        for version in versions:
            identity = (module['id'], version['version'])
            name = version['artifact']
            if identity in seen or not re.fullmatch(r'[A-Za-z0-9_-][A-Za-z0-9_.-]*\.zip', name):
                raise ValueError('Duplicate identity or unsafe filename')
            seen.add(identity)
            blob = read(name, 4 * 1024 * 1024)
            if hashlib.sha256(blob).hexdigest() != version['sha256']:
                raise ValueError('Hash mismatch: ' + name)
            key.verify(base64.b64decode(version['signature'], validate=True), blob,
                       padding.PKCS1v15(), hashes.SHA256())
            with zipfile.ZipFile(io.BytesIO(blob)) as archive:
                if archive.getinfo('manifest.json').file_size > 2 * 1024 * 1024:
                    raise ValueError('Manifest exceeds app size limit')
                manifest = json.loads(archive.read('manifest.json'))
                if (manifest['id'], manifest['version']) != identity:
                    raise ValueError('Signed identity differs from catalog')
            count += 1
    print(f'Verified {len(index["modules"])} modules / {count} signed versions'
          + ('; direct HTTPS and exact checkout bytes' if url else '; local artifacts'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', type=Path, default=ROOT / 'catalog')
    parser.add_argument('--url', help='Verify this deployment against the local checkout')
    args = parser.parse_args()
    verify(args.directory, args.url)
