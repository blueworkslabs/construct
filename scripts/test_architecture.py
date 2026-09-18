import shutil
import tempfile
import unittest
from pathlib import Path
from check_architecture import check, ROOT

class ArchitectureTest(unittest.TestCase):
    def test_ratchet_catches_domain_reintroduction_even_in_generic_filename(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copytree(ROOT/'core/app/src/main', root/'core/app/src/main', ignore=shutil.ignore_patterns('assets','res','cpp'))
            path = root/'core/app/src/main/java/dev/construct/runtime/ModuleHttp.kt'
            path.write_text(path.read_text()+'\n// provider https://api.adsb.lol\n')
            self.assertTrue(any('aviation' in e for e in check(root)))
    def test_ratchet_catches_new_native_app_launcher(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copytree(ROOT/'core/app/src/main', root/'core/app/src/main', ignore=shutil.ignore_patterns('assets','res','cpp'))
            path = root/'core/app/src/main/java/dev/construct/runtime/ModuleWebView.kt'
            path.write_text(path.read_text()+'\n"weather.open" -> { WeatherActivity.open(context) }\n')
            self.assertTrue(any('dispatch' in e for e in check(root)))

    def test_ratchet_catches_measure_workflow_in_generic_filename(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copytree(ROOT/'core/app/src/main', root/'core/app/src/main', ignore=shutil.ignore_patterns('assets','res','cpp'))
            path = root/'core/app/src/main/java/dev/construct/runtime/ModuleImageSession.kt'
            path.write_text(path.read_text()+'\nclass MeasurePlane {}\n')
            self.assertTrue(any('measurement' in e for e in check(root)))

    def test_ratchet_rejects_native_camera_workflow_even_inside_acquisition_surface(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            shutil.copytree(ROOT/'core/app/src/main',root/'core/app/src/main',ignore=shutil.ignore_patterns('assets','res','cpp'))
            path=root/'core/app/src/main/java/dev/construct/runtime/PhotoCaptureActivity.kt'
            path.write_text(path.read_text()+'\n// PhotoAnalyzer.detect(context, photo, kind)\n')
            self.assertTrue(any('Capture surface' in e for e in check(root)))
