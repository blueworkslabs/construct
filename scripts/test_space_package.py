import io, json, sys, tempfile, unittest, zipfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from cryptography.hazmat.primitives.asymmetric import rsa
import prepare_space_fixture

class SpacePackageTest(unittest.TestCase):
    def test_module_and_synthetic_fixture_build_and_publish(self):
        key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        (real, real_meta), (fixture, fixture_meta) = prepare_space_fixture.packages(key)
        self.assertEqual((real_meta['id'], fixture_meta['id']), ('dev.construct.space-watch', 'dev.construct.space-watch-fixture'))
        z = zipfile.ZipFile(io.BytesIO(real))
        files = z.namelist()
        self.assertNotIn('ui/synthetic-space.js', files)
        for name in ('ui/vendor/satellite.min.js', 'ui/vendor/astronomy.min.js', 'ui/vendor/satellite-js-LICENSE.txt', 'ui/vendor/astronomy-engine-LICENSE.txt', 'ui/space-stars.js'):
            self.assertIn(name, files)
        manifest = json.loads(z.read('manifest.json'))
        self.assertEqual(manifest['constructApi'], {'min': '0.14.0', 'target': '0.14.0'})
        net = next(c for c in manifest['capabilities'] if c['id'] == 'net.http')
        self.assertEqual(net['origins'], ['https://celestrak.org', 'https://en.wikipedia.org'])
        self.assertIn('Space Watch · 0.3.6', z.read('ui/index.html').decode())
        synthetic = zipfile.ZipFile(io.BytesIO(fixture))
        html = synthetic.read('ui/index.html').decode()
        self.assertLess(html.index('synthetic-space.js'), html.index('app.js'))
        self.assertIn('<h1>Synthetic Space Watch</h1>', html)
        stub = synthetic.read('ui/synthetic-space.js').decode()
        self.assertNotIn('/*ELEMENTS*/', stub)
        self.assertIn('"NORAD_CAT_ID":25544', stub)
        with tempfile.TemporaryDirectory() as out:
            prepare_space_fixture.prepare(Path(out), key)
            index = json.loads((Path(out) / 'index.json').read_text())
            flags = {m['id']: m['versions'][0].get('testFixture', False) for m in index['modules']}
            self.assertEqual(flags, {'dev.construct.space-watch': False, 'dev.construct.space-watch-fixture': True})

if __name__ == '__main__':
    unittest.main()
