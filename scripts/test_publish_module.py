import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from cryptography.hazmat.primitives.asymmetric import rsa
from publish_module import build, publish

class PublisherTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = rsa.generate_private_key(public_exponent=65537,key_size=2048)
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root/'module'
        self.source.mkdir()
        self.manifest = dict(schemaVersion=1,id='dev.test.module',name='Test',version='0.1.0',constructApi=dict(min='0.1.0',target='0.1.0'),runtime=dict(kind='webview-js'),entry='index.html',capabilities=[])
        (self.source/'manifest.json').write_text(json.dumps(self.manifest))
        (self.source/'index.html').write_text('<h1>__VERSION__</h1>')
        self.output = self.root/'registry'
    def test_sky_watch_requires_api08(self):
        self.manifest['capabilities']=[dict(id='sky.watch',reason='Native foreground aircraft map')]
        self.manifest['constructApi']=dict(min='0.7.0',target='0.7.0')
        (self.source/'manifest.json').write_text(json.dumps(self.manifest))
        with self.assertRaises(ValueError): build(self.source,self.key)
        self.manifest['constructApi']=dict(min='0.8.0',target='0.8.0')
        (self.source/'manifest.json').write_text(json.dumps(self.manifest))
        build(self.source,self.key)

    def test_http_sources_are_signed_exact_origins_and_require_api09(self):
        self.manifest['capabilities']=[dict(id='net.http',reason='Public data',origins=['https://example.org'])]
        def attempt():
            (self.source/'manifest.json').write_text(json.dumps(self.manifest))
            return build(self.source,self.key)
        with self.assertRaises(ValueError): attempt()
        self.manifest['constructApi']=dict(min='0.9.0',target='0.9.0')
        attempt()
        for bad in [[], ['https://example.org']*2, ['http://example.org'], ['https://example.org/'], ['https://*.example.org'], ['https://127.0.0.1'], ['https://a.local'], ['https://EXAMPLE.org'], ['https://example.org:443'], ['https://user@example.org']]:
            self.manifest['capabilities'][0]['origins']=bad
            with self.assertRaises(ValueError): attempt()
        self.manifest['capabilities']=[dict(id='location.read',reason='Foreground fix')]
        attempt()
        self.manifest['capabilities'][0]['origins']=['https://example.org']
        with self.assertRaises(ValueError): attempt()

    def test_theme_colour_requires_versioned_contract_and_strict_hex(self):
        self.manifest['themeColor'] = '#12AbEF'
        (self.source/'manifest.json').write_text(json.dumps(self.manifest))
        with self.assertRaises(ValueError): build(self.source,self.key)
        self.manifest['constructApi'] = dict(min='0.6.0',target='0.6.0')
        (self.source/'manifest.json').write_text(json.dumps(self.manifest))
        build(self.source,self.key)
        for bad in ['red','#123','#11223344','#gggggg',None,42]:
            self.manifest['themeColor']=bad
            (self.source/'manifest.json').write_text(json.dumps(self.manifest))
            with self.assertRaises(ValueError): build(self.source,self.key)

    def test_camera_requires_api04_without_changing_old_api_modules(self):
        build(self.source,self.key)
        self.manifest['capabilities']=[dict(id='camera.capture',reason='Native private camera')]
        (self.source/'manifest.json').write_text(json.dumps(self.manifest))
        with self.assertRaises(ValueError):build(self.source,self.key)
        self.manifest['constructApi']=dict(min='0.4.0',target='0.4.0')
        (self.source/'manifest.json').write_text(json.dumps(self.manifest))
        build(self.source,self.key)
    def test_measure_requires_api07_and_accepts_existing_capabilities(self):
        self.manifest['capabilities']=[dict(id='photo.measure',reason='Native measurement')]
        (self.source/'manifest.json').write_text(json.dumps(self.manifest))
        with self.assertRaises(ValueError): build(self.source,self.key)
        self.manifest['constructApi']=dict(min='0.7.0',target='0.7.0')
        self.manifest['themeColor']='#102026'
        (self.source/'manifest.json').write_text(json.dumps(self.manifest))
        build(self.source,self.key)

    def test_deterministic_signature_and_version(self):
        self.assertEqual(build(self.source,self.key),build(self.source,self.key))
        self.assertNotEqual(build(self.source,self.key)[0],build(self.source,self.key,'0.2.0')[0])
    def test_republish_idempotent_but_mutation_refused(self):
        blob,meta = build(self.source,self.key)
        publish(self.output,blob,meta,latest=True)
        before = (self.output/'index.json').read_bytes()
        publish(self.output,blob,meta,latest=True)
        self.assertEqual(before,(self.output/'index.json').read_bytes())
        (self.source/'index.html').write_text('changed')
        with self.assertRaises(ValueError): publish(self.output,*build(self.source,self.key))
        self.assertEqual(before,(self.output/'index.json').read_bytes())
        self.assertEqual(blob,(self.output/meta['artifact']).read_bytes())
    def test_failed_index_promotion_leaves_previous_catalog_and_retry_works(self):
        publish(self.output,*build(self.source,self.key),latest=True)
        before=(self.output/'index.json').read_bytes()
        import publish_module
        real=publish_module.atomic_write
        def fail_index(path,data):
            if path.name=='index.json': raise OSError('simulated interruption')
            real(path,data)
        with patch('publish_module.atomic_write',side_effect=fail_index):
            with self.assertRaises(OSError): publish(self.output,*build(self.source,self.key,'0.2.0'),latest=True)
        self.assertEqual(before,(self.output/'index.json').read_bytes())
        publish(self.output,*build(self.source,self.key,'0.2.0'),latest=True)
        self.assertEqual('0.2.0',json.loads((self.output/'index.json').read_text())['modules'][0]['latest'])
    def test_symlink_input_rejected(self):
        (self.source/'leak.txt').symlink_to(self.source/'index.html')
        with self.assertRaises(ValueError): build(self.source,self.key)
    def test_unsupported_private_file_rejected(self):
        (self.source/'private.pem').write_text('fixture-not-a-key')
        with self.assertRaises(ValueError): build(self.source,self.key)
    def test_capability_and_entry_validation(self):
        self.manifest['capabilities']=[dict(id='camera',reason='bad')]
        (self.source/'manifest.json').write_text(json.dumps(self.manifest))
        with self.assertRaises(ValueError): build(self.source,self.key)
        self.manifest['capabilities']=[]
        self.manifest['entry']='missing.html'
        (self.source/'manifest.json').write_text(json.dumps(self.manifest))
        with self.assertRaises(ValueError): build(self.source,self.key)
    def test_tone_requires_new_api_and_old_modules_still_build(self):
        build(self.source, self.key)
        self.manifest['capabilities'] = [dict(id='device.tone', reason='Short beep')]
        (self.source/'manifest.json').write_text(json.dumps(self.manifest))
        with self.assertRaisesRegex(ValueError, 'Tone requires API'):
            build(self.source, self.key)
        self.manifest['constructApi'] = dict(min='0.2.0', target='0.2.0')
        (self.source/'manifest.json').write_text(json.dumps(self.manifest))
        self.assertEqual('dev.test.module', build(self.source, self.key)[1]['id'])

    def test_fixture_cannot_be_latest(self):
        with self.assertRaises(ValueError): publish(self.output,*build(self.source,self.key),latest=True,fixture=True)
    def test_oversized_file_rejected(self):
        (self.source/'large.txt').write_bytes(b'x'*(2*1024*1024+1))
        with self.assertRaises(ValueError): build(self.source,self.key)

if __name__=='__main__': unittest.main()
