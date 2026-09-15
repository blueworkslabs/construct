import unittest
from webview_provider import installed_provider_sha

class ProviderTest(unittest.TestCase):
    def test_absent_provider_does_not_call_pm_path(self):
        calls=[]
        def adb(*args,**kwargs):calls.append(args);return ''
        self.assertIsNone(installed_provider_sha(adb));self.assertEqual(len(calls),1)
    def test_exact_package_name_not_substring(self):
        self.assertIsNone(installed_provider_sha(lambda *a,**k:'package:com.android.webview.beta\n'))
    def test_hash_is_read_from_installed_apk(self):
        calls=[]
        def adb(*args,**kwargs):
            calls.append(args)
            return ['package:com.android.webview\n','package:/data/app/pkg/base.apk\n','a'*64+'  /data/app/pkg/base.apk\n'][len(calls)-1]
        self.assertEqual(installed_provider_sha(adb),'a'*64)
        self.assertEqual(calls[-1],('shell','sha256sum','/data/app/pkg/base.apk'))
    def test_transport_failure_is_not_treated_as_absence(self):
        def adb(*args,**kwargs):raise RuntimeError('device offline')
        with self.assertRaises(RuntimeError):installed_provider_sha(adb)
