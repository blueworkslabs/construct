import subprocess
import unittest
from adb_identity import restore_shell_identity


class IdentityTest(unittest.TestCase):
    def test_transport_close_is_accepted_only_after_actual_shell_identity(self):
        calls=[]
        def adb(*args,**kwargs):
            calls.append(args)
            if args==('unroot',):raise subprocess.CalledProcessError(1,'adb')
            return '2000' if args[:2]==('shell','id') else ''
        self.assertEqual(restore_shell_identity(adb,lambda _:None),1)
        self.assertIn(('shell','id','-u'),calls)

    def test_successful_command_does_not_prove_privilege_was_dropped(self):
        calls=[]
        def adb(*args,**kwargs):
            calls.append(args);return '0' if args[:2]==('shell','id') else ''
        with self.assertRaisesRegex(RuntimeError,'verified shell'):
            restore_shell_identity(adb,lambda _:None)
        self.assertEqual(calls.count(('unroot',)),2)

    def test_offline_identity_never_counts_as_non_root(self):
        def adb(*args,**kwargs):
            if args[:2]==('shell','id'):raise subprocess.CalledProcessError(1,'adb')
            return ''
        with self.assertRaisesRegex(RuntimeError,'verified shell'):
            restore_shell_identity(adb,lambda _:None)

    def test_unexpected_identity_is_not_accepted(self):
        def adb(*args,**kwargs):return '1000' if args[:2]==('shell','id') else ''
        with self.assertRaisesRegex(RuntimeError,'Unexpected ADB identity'):
            restore_shell_identity(adb,lambda _:None)
