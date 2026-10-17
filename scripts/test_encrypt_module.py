"""Publisher side of construct-encrypted-v1 (docs/encrypted-packages.md, acceptance items 1, 2 and 7).

The known-answer vectors in encrypted-package-vectors.json are synthetic and redistributable:
fixed key, nonce and salt over a tiny synthetic module, the expected header, commitment and
envelope, and negative envelopes with the error category the host must report. The Android
side reads the same file. Regenerate only on a deliberate format change:
  python3 scripts/test_encrypt_module.py --write-vectors
"""
import base64
import hashlib
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from cryptography.hazmat.primitives.asymmetric import rsa
import encrypt_module as em

VECTORS = Path(__file__).resolve().parent / 'encrypted-package-vectors.json'
SYNTHETIC_ID = 'sealed.a0123456789abcdef0123456789abcdef'
MARKER = 'SYNTHETIC-PRIVATE-MARKER-7f3a'


def synthetic_zip(opaque_id=SYNTHETIC_ID, version='1.0.0', extra=None):
    manifest = json.dumps(dict(schemaVersion=1, id=opaque_id, name=MARKER, version=version,
        constructApi=dict(min='0.1.0', target='0.1.0'), runtime=dict(kind='webview-js'),
        entry='index.html', capabilities=[]), indent=2).encode()
    files = {'manifest.json': manifest, 'index.html': f'<h1>{MARKER}</h1>'.encode(), **(extra or {})}
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        for name, data in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, data)
    return buffer.getvalue(), manifest


KEY = bytes(range(32))
WRONG_KEY = bytes(range(1, 33))
NONCE = bytes.fromhex('000102030405060708090a0b')
SALT = bytes(range(64, 96))
KEY_ID = '00112233445566778899aabbccddeeff'


def frame(header_bytes, nonce, sealed):
    return em.MAGIC + len(header_bytes).to_bytes(4, 'big') + header_bytes + nonce + sealed


def reseal(header_bytes, plaintext, key=KEY, nonce=NONCE):
    """An envelope whose GCM is valid for an arbitrary header and plaintext (for checks after GCM)."""
    aad = em.MAGIC + len(header_bytes).to_bytes(4, 'big') + header_bytes
    return aad + nonce + em.AESGCM(key).encrypt(nonce, plaintext, aad)


def header_of(blob, manifest, **changes):
    header = dict(format=em.FORMAT, id=SYNTHETIC_ID, version='1.0.0', keyId=KEY_ID, zipBytes=len(blob),
        manifestCommitment=em.commitment(SALT, manifest))
    header.update(changes)
    return header


def flip(data, index):
    data = bytearray(data)
    data[index] ^= 1
    return bytes(data)


def category(envelope, key):
    try:
        em.open_envelope(envelope, key)
    except em.WrongKey:
        return 'PACKAGE_WRONG_KEY'
    except em.EnvelopeError as e:
        return 'PACKAGE_FORMAT_UNSUPPORTED' if str(e) == 'PACKAGE_FORMAT_UNSUPPORTED' else 'PACKAGE_INVALID'
    except ValueError:
        return 'PACKAGE_INVALID'
    return 'OK'


def vectors():
    blob, manifest = synthetic_zip()
    envelope = em.seal(blob, manifest, SYNTHETIC_ID, '1.0.0', KEY, KEY_ID, NONCE, SALT)
    header, aad, nonce, sealed = em.parse_envelope(envelope)
    hb = aad[12:]
    end = len(aad)
    neg = []
    def add(name, data, key=KEY, expect=None):
        neg.append(dict(name=name, key=key.hex(), envelope=data.hex(), expect=expect or category(data, key)))
    add('wrong key', envelope, WRONG_KEY, 'PACKAGE_WRONG_KEY')
    add('nonce changed', flip(envelope, end), expect='PACKAGE_WRONG_KEY')
    add('header value changed', envelope.replace(b'"version":"1.0.0"', b'"version":"1.0.1"'), expect='PACKAGE_WRONG_KEY')
    add('ciphertext changed', flip(envelope, end + 12 + 40), expect='PACKAGE_WRONG_KEY')
    add('tag changed', flip(envelope, len(envelope) - 1), expect='PACKAGE_WRONG_KEY')
    add('truncated', envelope[:-1], expect='PACKAGE_INVALID')
    add('trailing byte', envelope + b'\x00', expect='PACKAGE_INVALID')
    add('bad magic', b'CENC0002' + envelope[8:], expect='PACKAGE_INVALID')
    add('header length 0', em.MAGIC + (0).to_bytes(4, 'big') + envelope[12:], expect='PACKAGE_INVALID')
    add('header length 4097', em.MAGIC + (4097).to_bytes(4, 'big') + envelope[12:], expect='PACKAGE_INVALID')
    dup = hb[:-1] + b',"keyId":"' + KEY_ID.encode() + b'"}'
    add('duplicate header field', frame(dup, nonce, sealed), expect='PACKAGE_INVALID')
    add('unknown header field', frame(hb[:-1] + b',"x":1}', nonce, sealed), expect='PACKAGE_INVALID')
    add('invalid UTF-8 header', frame(hb.replace(b'"format"', b'"form\xffat"'), nonce, sealed), expect='PACKAGE_INVALID')
    add('zipBytes as string', reseal(em.encode_header(header_of(blob, manifest, zipBytes=str(len(blob)))), SALT + blob), expect='PACKAGE_INVALID')
    add('unsupported format', reseal(em.encode_header(header_of(blob, manifest, format='construct-encrypted-v2')), SALT + blob), expect='PACKAGE_FORMAT_UNSUPPORTED')
    add('commitment mismatch', reseal(em.encode_header(header_of(blob, manifest, manifestCommitment='0' * 64)), SALT + blob), expect='PACKAGE_INVALID')
    other, other_manifest = synthetic_zip(opaque_id='sealed.afedcba9876543210fedcba9876543210')
    add('inner ID differs from outer', reseal(em.encode_header(header_of(other, other_manifest)), SALT + other), expect='PACKAGE_INVALID')
    add('ZIP with a trailing byte', reseal(em.encode_header(header_of(blob, manifest, zipBytes=len(blob) + 1)), SALT + blob + b'\x00'), expect='PACKAGE_INVALID')
    add('ZIP with a prepended byte', reseal(em.encode_header(header_of(b'\x00' + blob, manifest)), SALT + b'\x00' + blob), expect='PACKAGE_INVALID')
    nested_blob, nested_manifest = synthetic_zip(extra={'inner.txt': envelope})
    add('nested envelope', reseal(em.encode_header(header_of(nested_blob, nested_manifest)), SALT + nested_blob), expect='PACKAGE_INVALID')
    return dict(
        format=em.FORMAT,
        note='Synthetic, redistributable test data. Not a deployment identifier or key.',
        inputs=dict(key=KEY.hex(), keyId=KEY_ID, nonce=NONCE.hex(), salt=SALT.hex(), id=SYNTHETIC_ID, version='1.0.0',
            zip=blob.hex(), manifest=manifest.hex()),
        outputs=dict(commitment=header['manifestCommitment'], header=hb.decode(), envelope=envelope.hex(),
            envelopeSha256=hashlib.sha256(envelope).hexdigest(), envelopeBytes=len(envelope)),
        negative=neg)


class KnownAnswers(unittest.TestCase):
    def test_vectors_match_and_every_negative_fails_as_recorded(self):
        stored = json.loads(VECTORS.read_text())
        i = stored['inputs']
        envelope = bytes.fromhex(stored['outputs']['envelope'])
        # The stored inputs seal to exactly the stored envelope (the ZIP is an input, so this does
        # not depend on this machine's zlib).
        self.assertEqual(em.seal(bytes.fromhex(i['zip']), bytes.fromhex(i['manifest']), i['id'], i['version'],
            bytes.fromhex(i['key']), i['keyId'], bytes.fromhex(i['nonce']), bytes.fromhex(i['salt'])), envelope)
        self.assertEqual(hashlib.sha256(envelope).hexdigest(), stored['outputs']['envelopeSha256'])
        header, manifest, blob = em.open_envelope(envelope, bytes.fromhex(i['key']))
        self.assertEqual(blob.hex(), i['zip'])
        self.assertEqual(header['manifestCommitment'],
            hashlib.sha256(b'ConstructManifestV1\x00' + bytes.fromhex(i['salt']) + bytes.fromhex(i['manifest'])).hexdigest())
        # The layout, independently of the implementation: magic, length, header, nonce, ciphertext+tag.
        hb = stored['outputs']['header'].encode()
        self.assertEqual(envelope[:8], b'CENC0001')
        self.assertEqual(int.from_bytes(envelope[8:12], 'big'), len(hb))
        self.assertEqual(envelope[12:12 + len(hb)], hb)
        self.assertEqual(envelope[12 + len(hb):24 + len(hb)].hex(), i['nonce'])
        self.assertEqual(len(envelope), 24 + len(hb) + 32 + len(bytes.fromhex(i['zip'])) + 16)
        self.assertGreaterEqual(len(stored['negative']), 20)
        for n in stored['negative']:
            with self.subTest(n['name']):
                self.assertNotEqual(n['expect'], 'OK')
                self.assertEqual(category(bytes.fromhex(n['envelope']), bytes.fromhex(n['key'])), n['expect'])


class Boundaries(unittest.TestCase):
    def setUp(self):
        self.blob, self.manifest = synthetic_zip()
        self.envelope = em.seal(self.blob, self.manifest, SYNTHETIC_ID, '1.0.0', KEY, KEY_ID, NONCE, SALT)

    def test_header_length_bounds(self):
        hb = em.encode_header(header_of(self.blob, self.manifest))
        padded = hb[:-1] + b' ' * (4096 - len(hb)) + b'}'
        self.assertEqual(len(padded), 4096)
        self.assertEqual(category(reseal(padded, SALT + self.blob), KEY), 'OK')
        over = hb[:-1] + b' ' * (4097 - len(hb)) + b'}'
        with self.assertRaisesRegex(em.EnvelopeError, 'Header length'):
            em.parse_envelope(reseal(over, SALT + self.blob))

    def test_envelope_and_zip_size_bounds(self):
        with self.assertRaisesRegex(em.EnvelopeError, 'Envelope size'):
            em.parse_envelope(self.envelope + b'\x00' * (em.MAX_ENVELOPE + 1 - len(self.envelope)))
        em.check_header(header_of(self.blob, self.manifest, zipBytes=em.MAX_ZIP))
        for bad in (em.MAX_ZIP + 1, 0, -1, True, 1.0):
            with self.subTest(bad), self.assertRaises(em.EnvelopeError):
                em.check_header(header_of(self.blob, self.manifest, zipBytes=bad))

    def test_header_identity_fields(self):
        for field, bad in [('id', 'dev.real.name'), ('id', 'sealed.A0123456789ABCDEF0123456789ABCDEF'), ('keyId', 'ABC'),
                           ('version', '1.0'), ('manifestCommitment', 'g' * 64)]:
            with self.subTest(field), self.assertRaises(em.EnvelopeError):
                em.check_header(header_of(self.blob, self.manifest, **{field: bad}))

    def test_inner_zip_rules(self):
        for extra, why in [({'../x.js': b''}, 'path'), ({'a.exe': b''}, 'extension'), ({'big.js': b'a' * (2 * 1024 * 1024 + 1)}, 'file size'),
                           ({f'f{i}.js': b'' for i in range(128)}, 'count')]:
            blob, manifest = synthetic_zip(extra=extra)
            with self.subTest(why), self.assertRaises(ValueError):
                em.open_envelope(reseal(em.encode_header(header_of(blob, manifest)), SALT + blob), KEY)

    def test_decompression_bomb_is_bounded(self):
        # Nine files of 1.5 MiB of zeros compress to almost nothing and expand past 12 MiB in total.
        blob, manifest = synthetic_zip(extra={f'z{i}.js': b'\x00' * (1536 * 1024) for i in range(9)})
        self.assertLess(len(blob), 200_000)
        with self.assertRaisesRegex(ValueError, 'Expanded limits'):
            em.open_envelope(reseal(em.encode_header(header_of(blob, manifest)), SALT + blob), KEY)


class Order(unittest.TestCase):
    """Signature before key lookup or decryption; GCM before any ZIP parse (instrumented)."""
    @classmethod
    def setUpClass(cls):
        cls.publisher = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.other = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    def setUp(self):
        self.blob, self.manifest = synthetic_zip()
        self.envelope = em.seal(self.blob, self.manifest, SYNTHETIC_ID, '1.0.0', KEY, KEY_ID, NONCE, SALT)
        self.entry = self.entry_for(self.envelope, self.publisher)
        self.lookups = 0

    def entry_for(self, envelope, signer):
        return dict(id=SYNTHETIC_ID, version='1.0.0', format=em.FORMAT, sha256=hashlib.sha256(envelope).hexdigest(),
            signature=base64.b64encode(em.sign(envelope, signer)).decode())

    def key_for(self, header):
        self.lookups += 1
        return KEY if header['keyId'] == KEY_ID else None

    def test_valid_package_opens(self):
        header, manifest, blob = em.verify_then_open(self.envelope, self.entry, self.publisher.public_key(), self.key_for)
        self.assertEqual((manifest['id'], blob), (SYNTHETIC_ID, self.blob))
        self.assertEqual(self.lookups, 1)

    def test_content_key_cannot_replace_the_publisher_signature(self):
        # An attacker with the content key re-encrypts other content: GCM is valid, the signature is not.
        evil_blob, evil_manifest = synthetic_zip(extra={'evil.js': b'steal()'})
        evil = em.seal(evil_blob, evil_manifest, SYNTHETIC_ID, '1.0.0', KEY, KEY_ID, bytes(12), SALT)
        unsigned = dict(self.entry, sha256=hashlib.sha256(evil).hexdigest())
        with patch.object(em, 'open_envelope', side_effect=AssertionError('decrypted before signature')):
            with self.assertRaisesRegex(em.EnvelopeError, 'Signature'):
                em.verify_then_open(evil, unsigned, self.publisher.public_key(), self.key_for)
            with self.assertRaisesRegex(em.EnvelopeError, 'Signature'):
                em.verify_then_open(evil, self.entry_for(evil, self.other), self.publisher.public_key(), self.key_for)
            with self.assertRaisesRegex(em.EnvelopeError, 'Checksum'):
                em.verify_then_open(evil, self.entry, self.publisher.public_key(), self.key_for)
        self.assertEqual(self.lookups, 0, 'a key was looked up before the signature held')

    def test_catalog_cannot_rebind_a_signed_payload(self):
        for change in (dict(id='sealed.afedcba9876543210fedcba9876543210'), dict(version='1.0.1'), dict(format='construct-encrypted-v2')):
            with self.subTest(change), self.assertRaisesRegex(em.EnvelopeError, 'Outer binding'):
                em.verify_then_open(self.envelope, dict(self.entry, **change), self.publisher.public_key(), self.key_for)
        self.assertEqual(self.lookups, 0)

    def test_missing_key_is_locked_and_only_the_exact_key_id_is_tried(self):
        other_id = 'ffeeddccbbaa99887766554433221100'
        envelope = em.seal(self.blob, self.manifest, SYNTHETIC_ID, '1.0.0', KEY, other_id, NONCE, SALT)
        with self.assertRaisesRegex(em.EnvelopeError, 'PACKAGE_LOCKED'):
            em.verify_then_open(envelope, self.entry_for(envelope, self.publisher), self.publisher.public_key(), self.key_for)

    def test_no_zip_parse_before_gcm_finalizes(self):
        calls = []
        real = em.inner_files
        with patch.object(em, 'inner_files', side_effect=lambda b: calls.append(1) or real(b)):
            for bad in (flip(self.envelope, len(self.envelope) - 1), flip(self.envelope, len(self.envelope) - 30)):
                with self.assertRaises(em.WrongKey):
                    em.open_envelope(bad, KEY)
            with self.assertRaises(em.WrongKey):
                em.open_envelope(self.envelope, WRONG_KEY)
            self.assertEqual(calls, [])
            em.open_envelope(self.envelope, KEY)
            self.assertEqual(calls, [1])


class Publisher(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.signer = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.keys = em.key_dir(self.root / 'keys')
        self.opaque = em.new_opaque_id()
        self.key_id = em.new_key(self.keys, self.opaque)
        self.source = self.root / 'module'
        self.source.mkdir()
        self.write_manifest('1.0.0')
        (self.source / 'index.html').write_text(f'<h1>{MARKER} __VERSION__</h1>')
        self.output = self.root / 'registry'

    def write_manifest(self, version, opaque=None):
        (self.source / 'manifest.json').write_text(json.dumps(dict(schemaVersion=1, id=opaque or self.opaque, name=MARKER,
            description=MARKER, version=version, constructApi=dict(min='0.1.0', target='0.1.0'), runtime=dict(kind='webview-js'),
            entry='index.html', capabilities=[])))

    def test_seal_publish_open_and_nothing_private_in_public_bytes(self):
        envelope, entry = em.build_sealed(self.source, self.signer, self.keys, self.key_id)
        em.publish_encrypted(self.output, envelope, entry, latest=True)
        index = json.loads((self.output / 'index.json').read_text())
        self.assertEqual(index['modules'], [])
        [module] = index['encryptedModules']
        self.assertEqual((module['id'], module['name'], module['latest']), (self.opaque, 'Locked module', '1.0.0'))
        self.assertEqual(set(module['versions'][0]), {'version', 'format', 'artifact', 'sha256', 'signature'})
        artifact = self.output / entry['artifact']
        self.assertEqual(artifact.read_bytes(), envelope)
        record = em.load_record(self.keys, self.key_id)
        public = [p.read_bytes() for p in self.output.rglob('*') if p.is_file()] + [entry['artifact'].encode()]
        for blob in public:
            self.assertNotIn(MARKER.encode(), blob)
            self.assertNotIn(record['key'].encode(), blob)
            self.assertNotIn(bytes.fromhex(record['key']), blob)
        _, manifest, _ = em.verify_then_open(envelope, entry, self.signer.public_key(), lambda h: bytes.fromhex(record['key']))
        self.assertEqual(manifest['name'], MARKER)

    def test_every_seal_uses_a_new_recorded_nonce_and_a_repeat_is_refused(self):
        em.build_sealed(self.source, self.signer, self.keys, self.key_id)
        self.write_manifest('1.0.1')
        em.build_sealed(self.source, self.signer, self.keys, self.key_id)
        used = em.load_record(self.keys, self.key_id)['nonces']
        self.assertEqual(len(used), 2)
        self.assertEqual(len(set(used)), 2)
        real = os.urandom
        with patch.object(em.os, 'urandom', side_effect=lambda n: bytes.fromhex(used[0]) if n == em.NONCE else real(n)):
            with self.assertRaisesRegex(ValueError, 'Nonce reuse'):
                em.build_sealed(self.source, self.signer, self.keys, self.key_id)

    def test_published_versions_are_immutable(self):
        envelope, entry = em.build_sealed(self.source, self.signer, self.keys, self.key_id)
        em.publish_encrypted(self.output, envelope, entry)
        envelope2, entry2 = em.build_sealed(self.source, self.signer, self.keys, self.key_id)
        self.assertNotEqual(envelope, envelope2)  # fresh nonce and salt
        with self.assertRaisesRegex(ValueError, 'immutable'):
            em.publish_encrypted(self.output, envelope2, entry2)

    def test_inner_id_must_be_the_opaque_id_and_ids_do_not_collide(self):
        self.write_manifest('1.0.0', opaque='dev.readable.name')
        with self.assertRaisesRegex(ValueError, 'opaque ID'):
            em.build_sealed(self.source, self.signer, self.keys, self.key_id)
        self.write_manifest('1.0.0')
        envelope, entry = em.build_sealed(self.source, self.signer, self.keys, self.key_id)
        self.output.mkdir()
        (self.output / 'index.json').write_text(json.dumps(dict(schemaVersion=1, modules=[dict(id=self.opaque, name='x', versions=[])])))
        with self.assertRaisesRegex(ValueError, 'ordinary module'):
            em.publish_encrypted(self.output, envelope, entry)

    def test_keys_stay_private(self):
        with self.assertRaisesRegex(ValueError, 'outside the repository'):
            em.key_dir(em.ROOT / 'keys-here')
        loose = self.root / 'loose'
        loose.mkdir(mode=0o755)
        os.chmod(loose, 0o755)
        with self.assertRaisesRegex(ValueError, '0700'):
            em.key_dir(loose)
        path = self.keys / f'{self.key_id}.json'
        self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        os.chmod(path, 0o644)
        with self.assertRaisesRegex(ValueError, '0600'):
            em.load_record(self.keys, self.key_id)


class PublicVerifier(unittest.TestCase):
    """verify_public_catalog without content keys: encrypted entries checked and counted separately."""
    @classmethod
    def setUpClass(cls):
        cls.signer = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        cls.other = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    def setUp(self):
        import publish_module
        import verify_public_catalog as vpc
        self.vpc = vpc
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        root = Path(temp.name)
        self.catalog = root / 'catalog'
        plain = root / 'plain'
        plain.mkdir()
        (plain / 'manifest.json').write_text(json.dumps(dict(schemaVersion=1, id='dev.test.plain', name='Plain', version='0.1.0',
            constructApi=dict(min='0.1.0', target='0.1.0'), runtime=dict(kind='webview-js'), entry='index.html', capabilities=[])))
        (plain / 'index.html').write_text('<h1>plain</h1>')
        blob, meta = publish_module.build(plain, self.signer)
        publish_module.publish(self.catalog, blob, meta, latest=True)
        keys = em.key_dir(root / 'keys')
        self.opaque = em.new_opaque_id()
        key_id = em.new_key(keys, self.opaque)
        sealed = root / 'sealed'
        sealed.mkdir()
        (sealed / 'manifest.json').write_text(json.dumps(dict(schemaVersion=1, id=self.opaque, name=MARKER, version='1.0.0',
            constructApi=dict(min='0.1.0', target='0.1.0'), runtime=dict(kind='webview-js'), entry='index.html', capabilities=[])))
        (sealed / 'index.html').write_text(MARKER)
        envelope, self.entry = em.build_sealed(sealed, self.signer, keys, key_id)
        em.publish_encrypted(self.catalog, envelope, self.entry, latest=True)
        der = self.signer.public_key().public_bytes(em.serialization.Encoding.DER, em.serialization.PublicFormat.SubjectPublicKeyInfo)
        (self.catalog / 'publisher-public.der').write_bytes(der)
        patcher = patch.object(vpc, 'PUBLISHER_SHA256', hashlib.sha256(der).hexdigest())
        patcher.start()
        self.addCleanup(patcher.stop)

    def edit(self, change):
        index = json.loads((self.catalog / 'index.json').read_text())
        change(index)
        (self.catalog / 'index.json').write_text(json.dumps(index))

    def test_mixed_catalog_verifies_and_counts_separately(self):
        out = io.StringIO()
        with patch('sys.stdout', out):
            self.vpc.verify(self.catalog)
        self.assertIn('Verified 1 modules / 1 signed versions; 1 encrypted modules / 1 signed envelopes (not decrypted)', out.getvalue())

    def test_refusals(self):
        artifact = self.catalog / self.entry['artifact']
        good = artifact.read_bytes()
        cases = [
            ('descriptive name', lambda i: i['encryptedModules'][0].update(name=MARKER), 'neutral label'),
            ('extra field', lambda i: i['encryptedModules'][0].update(description='x'), 'neutral label'),
            ('readable ID', lambda i: i['encryptedModules'][0].update(id='dev.readable.name'), 'opaque ID'),
            ('ID in both arrays', lambda i: i['modules'][0].update(id=self.opaque), 'Duplicate module ID'),
            ('latest not listed', lambda i: i['encryptedModules'][0].update(latest='9.9.9'), 'version list'),
            ('other format', lambda i: i['encryptedModules'][0]['versions'][0].update(format='construct-encrypted-v2'), 'Unsupported'),
            ('other path', lambda i: i['encryptedModules'][0]['versions'][0].update(artifact='sealed/x.cenc'), 'artifact path'),
            ('other signer', lambda i: i['encryptedModules'][0]['versions'][0].update(
                signature=base64.b64encode(em.sign(good, self.other)).decode()), None),
        ]
        original = (self.catalog / 'index.json').read_text()
        for name, change, message in cases:
            with self.subTest(name):
                (self.catalog / 'index.json').write_text(original)
                self.edit(change)
                with self.assertRaises(Exception) as caught, patch('sys.stdout', io.StringIO()):
                    self.vpc.verify(self.catalog)
                if message:
                    self.assertIn(message, str(caught.exception))
        (self.catalog / 'index.json').write_text(original)
        artifact.write_bytes(flip(good, len(good) - 1))
        with self.assertRaisesRegex(ValueError, 'Hash mismatch'), patch('sys.stdout', io.StringIO()):
            self.vpc.verify(self.catalog)

    def test_ordinary_publisher_refuses_an_encrypted_id(self):
        import publish_module
        index = json.loads((self.catalog / 'index.json').read_text())
        with self.assertRaisesRegex(ValueError, 'encrypted module'):
            publish_module.publish(self.catalog, b'x', dict(id=self.opaque, name='x', version='1.0.0', artifact='x.zip', sha256='', signature=''))
        self.assertEqual(json.loads((self.catalog / 'index.json').read_text()), index)


if __name__ == '__main__':
    if '--write-vectors' in sys.argv:
        VECTORS.write_text(json.dumps(vectors(), indent=2) + '\n')
        print(f'wrote {VECTORS}')
    else:
        unittest.main()
