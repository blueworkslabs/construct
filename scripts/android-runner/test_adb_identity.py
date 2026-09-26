import subprocess
import unittest
from adb_identity import acquire_root_identity,restore_shell_identity


class IdentityTest(unittest.TestCase):
    def root_adb(self, uid, calls, close=False, emulator=True):
        def adb(*args,**kwargs):
            calls.append(args)
            if args==('shell','getprop','ro.kernel.qemu'):return '1' if emulator else '0'
            if args==('shell','getprop','ro.build.type'):return 'userdebug'
            if args==('root',) and close:raise subprocess.CalledProcessError(1,'adb')
            return uid if args[:2]==('shell','id') else ''
        return adb

    def test_root_transport_close_requires_actual_root_identity(self):
        calls=[]
        self.assertEqual(acquire_root_identity(self.root_adb('0',calls,close=True),lambda _:None),1)
        self.assertIn(('shell','id','-u'),calls)

    def test_root_command_success_without_root_is_not_a_pass(self):
        calls=[]
        with self.assertRaisesRegex(RuntimeError,'verified root'):
            acquire_root_identity(self.root_adb('2000',calls),lambda _:None)
        self.assertEqual(calls.count(('root',)),2)

    def test_root_rejects_unexpected_identity(self):
        with self.assertRaisesRegex(RuntimeError,'Unexpected ADB identity'):
            acquire_root_identity(self.root_adb('1000',[]),lambda _:None)

    def test_root_rejects_non_emulator_before_privilege_transition(self):
        calls=[]
        with self.assertRaisesRegex(RuntimeError,'Disposable userdebug emulator'):
            acquire_root_identity(self.root_adb('0',calls,emulator=False),lambda _:None)
        self.assertNotIn(('root',),calls)

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
