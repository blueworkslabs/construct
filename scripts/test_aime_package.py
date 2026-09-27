import io, json, sys, tempfile, unittest, zipfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from cryptography.hazmat.primitives.asymmetric import rsa
import prepare_aime_fixture

class AimePackageTest(unittest.TestCase):
    def test_module_and_synthetic_fixture_build_and_publish(self):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        (real, real_meta), (fixture, fixture_meta) = prepare_aime_fixture.packages(key)
        self.assertEqual((real_meta['id'], fixture_meta['id']), ('dev.construct.aime', 'dev.construct.aime-fixture'))
        files = zipfile.ZipFile(io.BytesIO(real)).namelist()
        self.assertNotIn('ui/synthetic-aime.js', files)
        manifest = json.loads(zipfile.ZipFile(io.BytesIO(real)).read('manifest.json'))
        self.assertEqual(manifest['constructApi'], {'min': '0.12.0', 'target': '0.12.0'})
        synthetic = zipfile.ZipFile(io.BytesIO(fixture))
        html = synthetic.read('ui/index.html').decode()
        self.assertLess(html.index('synthetic-aime.js'), html.index('app.js'))
        self.assertIn('Synthetic Aimé', html)
        with tempfile.TemporaryDirectory() as out:
            prepare_aime_fixture.prepare(Path(out), key)
            index = json.loads((Path(out) / 'index.json').read_text())
            flags = {m['id']: m['versions'][0].get('testFixture', False) for m in index['modules']}
            self.assertEqual(flags, {'dev.construct.aime': False, 'dev.construct.aime-fixture': True})

if __name__ == '__main__':
    unittest.main()
