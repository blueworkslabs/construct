import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import config

class RunnerConfigurationTests(unittest.TestCase):
    def values(self):
        return dict(root=str(config.SCRIPT_ROOT),sdk='/opt/android-sdk',avd='/srv/construct-avd',host='test-runner',home_catalog='https://registry.example.org/modules/index.json',test_catalog='https://registry.example.org/tests/index.json',disposable=True)
    def load(self,raw):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'runner.local.json';p.write_text(json.dumps(raw));return config.load(p)
    def test_platform_profiles_preserve_legacy_defaults(self):
        c=self.load(self.values())
        self.assertFalse(c.direct_memory)
        self.assertEqual(c.memory_mb,2048)
        self.assertEqual(c.profile(),('construct-api36','clean',False))
        self.assertEqual(c.profile(True),('construct-camera36','camera-clean',True))
    def test_single_android17_snapshot_keeps_identical_hardware(self):
        r=self.values();r.update(api_level=37,single_avd=True,direct_memory=True,service='construct-emulator-api37.service')
        c=self.load(r)
        self.assertTrue(c.direct_memory)
        self.assertEqual(c.profile(),('construct-api37','clean',True))
        self.assertEqual(c.profile(),c.profile(True))
    def test_platform_options_fail_closed(self):
        for key,value in [('api_level',True),('api_level','37'),('api_level',0),('single_avd','false'),('direct_memory','false'),('memory_mb',True),('memory_mb',512),('memory_mb','3072')]:
            r=self.values();r[key]=value
            with self.subTest(key=key,value=value),self.assertRaises(ValueError):self.load(r)
    def test_missing_config_never_authorizes_device_actions(self):
        with tempfile.TemporaryDirectory() as d:
            c=config.load(Path(d)/'missing.json')
            with self.assertRaises(RuntimeError):config.require_runner(c)
    def test_matching_explicit_config_is_required(self):
        c=self.load(self.values())
        with patch.object(config.socket,'gethostname',return_value='other-host'),self.assertRaises(RuntimeError):config.require_runner(c)
        with patch.object(config.socket,'gethostname',return_value='test-runner'):self.assertEqual(config.require_runner(c),c)
    def test_truthy_strings_do_not_authorize_reset(self):
        r=self.values();r['disposable']='true'
        with self.assertRaises(ValueError):self.load(r)
    def test_phone_serial_override_is_not_supported(self):
        r=self.values();r['serial']='physical-phone'
        with self.assertRaises(ValueError):self.load(r)
        self.assertEqual(config.SERIAL,'emulator-5554')
    def test_catalog_shell_metacharacters_and_credentials_rejected(self):
        for url in ('http://example.org/index.json','https://example.org/a;id/index.json','https://example.org/index.json?x=1','https://user@example.org/index.json'):
            r=self.values();r['test_catalog']=url
            with self.subTest(url=url),self.assertRaises(ValueError):self.load(r)
    def test_other_installation_root_cannot_run(self):
        r=self.values();r['root']='/srv/different-runner';c=self.load(r)
        with patch.object(config.socket,'gethostname',return_value='test-runner'),self.assertRaises(RuntimeError):config.require_runner(c)

if __name__=='__main__':unittest.main()
