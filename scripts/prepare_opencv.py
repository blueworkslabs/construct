#!/usr/bin/env python3
"""Fetch checksum-pinned OpenCV source for the small native measurement bridge."""
import hashlib
from pathlib import Path
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
VERSION = '4.12.0'
SHA256 = '44c106d5bb47efec04e531fd93008b3fcd1d27138985c5baf4eafac0e1ec9e9d'
URL = f'https://github.com/opencv/opencv/archive/refs/tags/{VERSION}.tar.gz'

def prepare():
    folder = ROOT/'dist/native-source'
    folder.mkdir(parents=True, exist_ok=True)
    archive = folder/f'opencv-{VERSION}.tar.gz'
    if not archive.exists():
        with urllib.request.urlopen(URL, timeout=120) as response:
            if not response.url.startswith('https://'):
                raise ValueError('OpenCV source redirect must use HTTPS')
            data = response.read(110 * 1024 * 1024)
        if hashlib.sha256(data).hexdigest() != SHA256:
            raise ValueError('OpenCV source checksum mismatch')
        archive.write_bytes(data)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
        raise ValueError('OpenCV source checksum mismatch')
    # Re-extract verified source, never use an unverified downloaded library.
    with tarfile.open(archive) as source:
        for member in source.getmembers():
            path = Path(member.name)
            if (path.is_absolute() or '..' in path.parts or member.issym()
                    or member.islnk() or not (member.isdir() or member.isfile())
                    or path.parts[0] != f'opencv-{VERSION}'):
                raise ValueError('Unexpected OpenCV archive member')
        source.extractall(folder)
    print('Verified OpenCV source', VERSION, SHA256)

if __name__ == '__main__':
    prepare()
