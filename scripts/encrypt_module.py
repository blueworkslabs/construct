#!/usr/bin/env python3
"""Seal, sign and publish an encrypted module package (construct-encrypted-v1).

Implements the publisher side of docs/encrypted-packages.md. The inner module is
built and validated by publish_module.build, then sealed as

  CENC0001 || u32 header length || header JSON || 12-byte nonce || AES-256-GCM(salt || ZIP) || tag

with the magic, length and header as associated data. The publisher signs every
byte of the envelope (SHA256withRSA, the existing scheme) and publishes it under
`encryptedModules` with the neutral label. Content keys and their nonce ledgers
live in a private key directory outside the repository; this tool never prints a
content key except through the explicit `key-record` command.
"""
import argparse
import base64
import fcntl
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import re
import stat
import zipfile
from cryptography.exceptions import InvalidSignature, InvalidTag
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import publish_module
from publish_module import require, validate_manifest, atomic_write

ROOT = Path(__file__).resolve().parents[1]
MAGIC = b'CENC0001'
FORMAT = 'construct-encrypted-v1'
LABEL = 'Locked module'
HEADER_FIELDS = {'format', 'id', 'version', 'keyId', 'zipBytes', 'manifestCommitment'}
MAX_HEADER = 4096
MAX_ENVELOPE = 4 * 1024 * 1024
MAX_ZIP = 4 * 1024 * 1024
MAX_KEY_RECORDS = 100
NONCE = 12
TAG = 16
SALT = 32
OPAQUE_ID = re.compile(r'sealed\.a[0-9a-f]{32}')
HEX32 = re.compile(r'[0-9a-f]{32}')
HEX64 = re.compile(r'[0-9a-f]{64}')
COMMITMENT_PREFIX = b'ConstructManifestV1\x00'


class EnvelopeError(ValueError):
    """A framing, header or binding violation: PACKAGE_INVALID / PACKAGE_FORMAT_UNSUPPORTED."""


class WrongKey(ValueError):
    """GCM authentication failed: PACKAGE_WRONG_KEY. Not proof of the cause."""


def commitment(salt, manifest_bytes):
    return hashlib.sha256(COMMITMENT_PREFIX + salt + manifest_bytes).hexdigest()


def _strict_object(pairs):
    keys = [k for k, _ in pairs]
    if len(keys) != len(set(keys)):
        raise EnvelopeError('Duplicate header field')
    return dict(pairs)


def _reject_constant(name):
    raise EnvelopeError('Header constant')


def encode_header(header):
    return json.dumps(header, separators=(',', ':'), sort_keys=True, ensure_ascii=False).encode('utf-8')


def check_header(header):
    if not isinstance(header, dict) or set(header) != HEADER_FIELDS:
        raise EnvelopeError('Header fields')
    if header['format'] != FORMAT:
        raise EnvelopeError('PACKAGE_FORMAT_UNSUPPORTED')
    if not (isinstance(header['id'], str) and OPAQUE_ID.fullmatch(header['id'])):
        raise EnvelopeError('Opaque ID')
    if not (isinstance(header['version'], str) and publish_module.VERSION.fullmatch(header['version']) and len(header['version']) <= 50):
        raise EnvelopeError('Version')
    if not (isinstance(header['keyId'], str) and HEX32.fullmatch(header['keyId'])):
        raise EnvelopeError('Key ID')
    size = header['zipBytes']
    if type(size) is not int or not 0 < size <= MAX_ZIP:
        raise EnvelopeError('ZIP length')
    if not (isinstance(header['manifestCommitment'], str) and HEX64.fullmatch(header['manifestCommitment'])):
        raise EnvelopeError('Manifest commitment')
    return header


def parse_envelope(envelope):
    """Strict framing and header parse. Returns (header, aad, nonce, sealed) without decrypting."""
    if not isinstance(envelope, (bytes, bytearray)) or len(envelope) > MAX_ENVELOPE:
        raise EnvelopeError('Envelope size')
    envelope = bytes(envelope)
    if len(envelope) < 12 or envelope[:8] != MAGIC:
        raise EnvelopeError('Magic')
    length = int.from_bytes(envelope[8:12], 'big')
    if not 1 <= length <= MAX_HEADER:
        raise EnvelopeError('Header length')
    end = 12 + length
    if len(envelope) < end + NONCE + TAG:
        raise EnvelopeError('Truncated envelope')
    try:
        text = envelope[12:end].decode('utf-8', 'strict')
        header = json.loads(text, object_pairs_hook=_strict_object, parse_constant=_reject_constant)
    except UnicodeDecodeError:
        raise EnvelopeError('Header UTF-8') from None
    except json.JSONDecodeError:
        raise EnvelopeError('Header JSON') from None
    check_header(header)
    sealed = envelope[end + NONCE:]
    if len(sealed) != SALT + header['zipBytes'] + TAG:
        raise EnvelopeError('Ciphertext length')
    return header, envelope[:end], envelope[end:end + NONCE], sealed


def seal(zip_blob, manifest_bytes, opaque_id, version, key, key_id, nonce, salt):
    """Deterministic given its random inputs (key, nonce, salt): the known-answer vectors use this."""
    require(len(key) == 32 and len(nonce) == NONCE and len(salt) == SALT, 'Key, nonce or salt length')
    header = check_header(dict(format=FORMAT, id=opaque_id, version=version, keyId=key_id,
        zipBytes=len(zip_blob), manifestCommitment=commitment(salt, manifest_bytes)))
    encoded = encode_header(header)
    require(len(encoded) <= MAX_HEADER, 'Header size')
    aad = MAGIC + len(encoded).to_bytes(4, 'big') + encoded
    envelope = aad + nonce + AESGCM(key).encrypt(nonce, salt + zip_blob, aad)
    require(len(envelope) <= MAX_ENVELOPE, 'Envelope size')
    return envelope


def open_envelope(envelope, key):
    """Private verification: GCM before any plaintext byte is used, then the inner ZIP checks.
    Returns (header, manifest dict, zip bytes)."""
    header, aad, nonce, sealed = parse_envelope(envelope)
    try:
        plain = AESGCM(key).decrypt(nonce, sealed, aad)
    except InvalidTag:
        raise WrongKey('PACKAGE_WRONG_KEY') from None
    if len(plain) != SALT + header['zipBytes']:
        raise EnvelopeError('Plaintext length')
    salt, blob = plain[:SALT], plain[SALT:]
    manifest_bytes, files = inner_files(blob)
    if not hmac.compare_digest(commitment(salt, manifest_bytes), header['manifestCommitment']):
        raise EnvelopeError('Manifest commitment')
    manifest = json.loads(manifest_bytes)
    validate_manifest(manifest)
    if manifest['id'] != header['id'] or manifest['version'] != header['version']:
        raise EnvelopeError('Inner identity')
    require(manifest['entry'] in files, 'Entry missing')
    return header, manifest, blob


def inner_files(blob):
    """The ordinary package's ZIP rules, bounded: paths, duplicates, extensions, counts, sizes."""
    require(len(blob) <= MAX_ZIP, 'ZIP size')
    # Exact framing: a local header first, and the end-of-central-directory record, with no
    # comment, as the last 22 bytes right after the central directory. No prepended or trailing data.
    require(len(blob) >= 22 and blob[:4] == b'PK\x03\x04' and blob[-22:-18] == b'PK\x05\x06', 'ZIP framing')
    cd_size, cd_offset, comment = int.from_bytes(blob[-10:-6], 'little'), int.from_bytes(blob[-6:-2], 'little'), int.from_bytes(blob[-2:], 'little')
    require(comment == 0 and cd_offset + cd_size == len(blob) - 22, 'ZIP framing')
    try:
        archive = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile:
        raise EnvelopeError('Inner ZIP') from None
    with archive:
        infos = archive.infolist()
        require(len(infos) <= 128, 'Too many entries')
        names = [i.filename for i in infos]
        require(len(names) == len(set(names)), 'Duplicate entry')
        files, total = {}, 0
        for info in infos:
            name = info.filename
            require(not info.is_dir() and len(name) <= 180 and publish_module.PATH.fullmatch(name), 'Invalid package path')
            require(name == 'manifest.json' or name.rsplit('.', 1)[-1] in publish_module.EXTENSIONS, 'Unsupported package file')
            require(not any(other.startswith(name + '/') for other in names), 'File/directory collision')
            # Claimed sizes are not authority: read at most the limit plus one byte.
            with archive.open(info) as stream:
                data = stream.read(2 * 1024 * 1024 + 1)
            require(len(data) <= 2 * 1024 * 1024, 'File limit')
            total += len(data)
            require(total <= 12 * 1024 * 1024, 'Expanded limits')
            if name.endswith('.cenc') or data[:8] == MAGIC:
                raise EnvelopeError('Nested envelope')
            files[name] = data
    require('manifest.json' in files and len(files['manifest.json']) <= 32768, 'Manifest')
    return files['manifest.json'], files


def sign(envelope, signing_key):
    signature = signing_key.sign(envelope, padding.PKCS1v15(), hashes.SHA256())
    signing_key.public_key().verify(signature, envelope, padding.PKCS1v15(), hashes.SHA256())
    return signature


def verify_then_open(envelope, entry, public_key, key_for):
    """The host's order: hash and signature over the complete envelope, then the outer binding,
    and only then a key lookup and decryption. `key_for(header)` returns the content key or None."""
    if hashlib.sha256(envelope).hexdigest() != entry['sha256']:
        raise EnvelopeError('Checksum')
    try:
        public_key.verify(base64.b64decode(entry['signature'], validate=True), envelope, padding.PKCS1v15(), hashes.SHA256())
    except (InvalidSignature, ValueError):
        raise EnvelopeError('Signature') from None
    header = parse_envelope(envelope)[0]
    if header['id'] != entry['id'] or header['version'] != entry['version'] or entry.get('format') != FORMAT:
        raise EnvelopeError('Outer binding')
    key = key_for(header)
    if key is None:
        raise EnvelopeError('PACKAGE_LOCKED')
    return open_envelope(envelope, key)


def fingerprint(public_key):
    der = public_key.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    return hashlib.sha256(der).hexdigest()


# ---- private key directory: one JSON record per key, with its nonce ledger ----

def key_dir(path):
    path = Path(path).expanduser().resolve()
    require(ROOT not in path.parents and path != ROOT, 'Keys must live outside the repository')
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(not path.is_symlink() and stat.S_IMODE(path.stat().st_mode) == 0o700, 'Key directory must be 0700')
    return path


def _record_path(keys, key_id):
    require(HEX32.fullmatch(key_id), 'Key ID')
    return keys / f'{key_id}.json'


def load_record(keys, key_id):
    path = _record_path(keys, key_id)
    require(path.is_file() and not path.is_symlink(), 'No such key record')
    require(stat.S_IMODE(path.stat().st_mode) == 0o600, 'Key record must be 0600')
    record = json.loads(path.read_text())
    require(set(record) == {'id', 'keyId', 'key', 'nonces'} and record['keyId'] == key_id, 'Key record')
    require(OPAQUE_ID.fullmatch(record['id']) and HEX64.fullmatch(record['key']), 'Key record')
    return record


def _write_record(keys, record):
    path = _record_path(keys, record['keyId'])
    data = (json.dumps(record, indent=2) + '\n').encode()
    atomic_write(path, data)
    os.chmod(path, 0o600)


def new_key(keys, opaque_id):
    require(OPAQUE_ID.fullmatch(opaque_id), 'Opaque ID')
    require(len(list(keys.glob('*.json'))) < MAX_KEY_RECORDS, 'Key record limit')
    key_id = os.urandom(16).hex()
    _write_record(keys, dict(id=opaque_id, keyId=key_id, key=os.urandom(32).hex(), nonces=[]))
    return key_id


def fresh_nonce(keys, record):
    """A new random nonce, recorded durably before it is used; reuse under a key is refused."""
    nonce = os.urandom(NONCE)
    require(nonce.hex() not in record['nonces'], 'Nonce reuse')
    record['nonces'].append(nonce.hex())
    _write_record(keys, record)
    return nonce


def new_opaque_id():
    return 'sealed.a' + os.urandom(16).hex()


# ---- catalog ----

def artifact_path(opaque_id, version):
    return f"sealed/{opaque_id.split('.', 1)[1]}/{version}.cenc"


def publish_encrypted(output, envelope, entry, latest=False):
    """`entry` carries the opaque ID; the catalog stores it on the module, not on each version."""
    published = entry
    output = Path(output)
    require(not output.is_symlink(), 'Registry cannot be a symlink')
    output.mkdir(parents=True, exist_ok=True)
    with (output / '.publish.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        index_path = output / 'index.json'
        require(not index_path.is_symlink(), 'Symlink index')
        index = json.loads(index_path.read_text()) if index_path.exists() else {'schemaVersion': 1, 'modules': []}
        require(index['schemaVersion'] == 1, 'Unsupported existing index')
        require(all(m['id'] != entry['id'] for m in index['modules']), 'ID already used by an ordinary module')
        sealed = index.setdefault('encryptedModules', [])
        module = next((m for m in sealed if m['id'] == entry['id']), None)
        if module is None:
            module = {'id': entry['id'], 'name': LABEL, 'versions': []}
            sealed.append(module)
        entry = {k: v for k, v in entry.items() if k != 'id'}
        old = next((v for v in module['versions'] if v['version'] == entry['version']), None)
        require(old is None or old == entry, 'Published version is immutable; increment version')
        target = output / entry['artifact']
        require(not target.is_symlink(), 'Symlink artifact')
        if target.exists():
            require(target.read_bytes() == envelope, 'Artifact is immutable; increment version')
        if old is None:
            module['versions'].append(entry)
        if latest:
            module['latest'] = entry['version']
        require(len(index['modules']) + len(sealed) <= 100 and all(len(m['versions']) <= 50 for m in index['modules'] + sealed), 'Catalog limits')
        encoded = (json.dumps(index, indent=2) + '\n').encode()
        require(len(encoded) <= 512 * 1024, 'Catalog size')
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            atomic_write(target, envelope)
        atomic_write(index_path, encoded)
    return published


def build_sealed(source, signing_key, keys, key_id, version=None):
    record = load_record(keys, key_id)
    # The ordinary builder validates the manifest and files; its detached ZIP signature is not used.
    blob, meta = publish_module.build(source, signing_key, version)
    require(meta['id'] == record['id'], 'Inner manifest ID must be the opaque ID')
    manifest_bytes, _ = inner_files(blob)
    nonce = fresh_nonce(keys, record)
    envelope = seal(blob, manifest_bytes, record['id'], meta['version'], bytes.fromhex(record['key']), key_id, nonce, os.urandom(SALT))
    open_envelope(envelope, bytes.fromhex(record['key']))
    signature = sign(envelope, signing_key)
    entry = dict(version=meta['version'], format=FORMAT, artifact=artifact_path(record['id'], meta['version']),
        sha256=hashlib.sha256(envelope).hexdigest(), signature=base64.b64encode(signature).decode())
    return envelope, dict(entry, id=record['id'])


def signing_key():
    keypath = Path(os.environ.get('CONSTRUCT_SIGNING_DIR', Path.home() / '.local/share/construct-signing')).expanduser() / 'module-development.pem'
    require(keypath.is_file(), 'Initialize development signing using build_demo.py first')
    key = serialization.load_pem_private_key(keypath.read_bytes(), password=None)
    public = key.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    require(public == (ROOT / 'core/app/src/main/assets/registry-public.der').read_bytes(), 'Publisher differs from pinned host key')
    return key


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest='command', required=True)
    sub.add_parser('new-id', help='print a fresh opaque module ID')
    p = sub.add_parser('new-key', help='create a content key record for an opaque ID; prints its key ID')
    p.add_argument('--keys', required=True, type=Path)
    p.add_argument('--id', required=True)
    p = sub.add_parser('seal', help='build, seal, sign and publish a module whose manifest ID is the opaque ID')
    p.add_argument('source', type=Path)
    p.add_argument('--keys', required=True, type=Path)
    p.add_argument('--key-id', required=True)
    p.add_argument('--output', required=True, type=Path)
    p.add_argument('--version')
    p.add_argument('--latest', action='store_true')
    p = sub.add_parser('open', help='private verification of a sealed artifact with its content key')
    p.add_argument('envelope', type=Path)
    p.add_argument('--keys', required=True, type=Path)
    p = sub.add_parser('key-record', help='print the import fields for private handoff (contains the key)')
    p.add_argument('--keys', required=True, type=Path)
    p.add_argument('--key-id', required=True)
    args = parser.parse_args()
    if args.command == 'new-id':
        print(new_opaque_id())
    elif args.command == 'new-key':
        print(new_key(key_dir(args.keys), args.id))
    elif args.command == 'seal':
        key = signing_key()
        envelope, entry = build_sealed(args.source, key, key_dir(args.keys), args.key_id, args.version)
        publish_encrypted(args.output, envelope, entry, args.latest)
        print(f"Sealed {entry['id']} {entry['version']}: {entry['sha256']} ({len(envelope)} B)")
    elif args.command == 'open':
        envelope = args.envelope.read_bytes()
        header = parse_envelope(envelope)[0]
        record = load_record(key_dir(args.keys), header['keyId'])
        require(record['id'] == header['id'], 'Key record is for another module')
        header, manifest, blob = open_envelope(envelope, bytes.fromhex(record['key']))
        print(f"Opened {header['id']} {header['version']}: ZIP {len(blob)} B, entry {manifest['entry']}, {len(manifest['capabilities'])} capabilities")
    elif args.command == 'key-record':
        record = load_record(key_dir(args.keys), args.key_id)
        print(json.dumps(dict(publisher=fingerprint(signing_key().public_key()), id=record['id'], keyId=record['keyId'], key=record['key'])))


if __name__ == '__main__':
    main()
