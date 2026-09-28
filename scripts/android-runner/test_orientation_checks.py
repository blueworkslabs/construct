import unittest
from orientation_checks import active_connections

class OrientationChecksTest(unittest.TestCase):
    def test_history_and_other_clients_are_not_active_app_connections(self):
        dump = ('2 open event connections\nConnection Number: 0\n'
                ' v2.l1 | WakeLockRefCount 0 | uid 10237 | cache size 0\n'
                'Connection Number: 1\n system | uid 1000 | cache size 0\n'
                '0 open direct connections\nPrevious Registrations:\n'
                ' v2.l1 | uid 10237 | removed\n')
        self.assertEqual(1, active_connections(dump, 10237))
        self.assertEqual(0, active_connections(dump, 237))
        self.assertEqual(0, active_connections('0 open event connections\n0 open direct connections\n'+dump.split('Previous Registrations:')[1], 10237))
    def test_missing_or_truncated_section_does_not_pass_as_empty(self):
        for text in ('', '0 open event connections\n', 'Previous Registrations:\n uid 10237'):
            with self.assertRaises(ValueError): active_connections(text, 10237)

    def test_pause_only_accepts_android_spacing_but_not_another_activity_or_viewroot(self):
        from orientation_checks import paused_without_stop
        client='ACTIVITY dev.construct.runtime/.ModuleActivity\n Local Activity abc State:\n  mResumed=false mStopped=false mFinished=false\n'
        for spacing in (' ', '  ', '\t'):
            system=' * Hist'+spacing+'#1: ActivityRecord{abc dev.construct.runtime/.ModuleActivity}\n state=PAUSED\n * Hist #0: ActivityRecord{other}\n state=STOPPED\n'
            self.assertTrue(paused_without_stop(system,client))
            self.assertFalse(paused_without_stop(system.replace('state=PAUSED','state=RESUMED'),client))
            self.assertFalse(paused_without_stop(system,client.replace('mStopped=false','mStopped=true')+' ViewRoot:\n mStopped=false'))
            self.assertFalse(paused_without_stop(system.replace('.ModuleActivity','.OtherActivity'),client))
