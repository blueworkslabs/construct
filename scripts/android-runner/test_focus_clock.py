import unittest
from focus_clock import clock_value

class FocusClockTest(unittest.TestCase):
    def test_both_webview_labels_and_status_bar_exclusion(self):
        for label in ('25:00', 'Time remaining: 25:00'):
            self.assertEqual(clock_value([
                {'package':'com.android.systemui','text':'12:24'},
                {'package':'dev.construct.runtime','text':label}]), '25:00')
    def test_same_node_text_and_description_are_one_clock(self):
        self.assertEqual(clock_value([{'package':'dev.construct.runtime',
            'text':'04:58','content-desc':'Time remaining: 04:58'}]), '04:58')
    def test_missing_invalid_conflicting_or_duplicate_clocks_fail(self):
        for current in ([], [{'package':'com.android.systemui','text':'25:00'}],
            [{'package':'dev.construct.runtime','text':'25:99'}],
            [{'package':'dev.construct.runtime','text':'25:00','content-desc':'Time remaining: 04:00'}],
            [{'package':'dev.construct.runtime','text':'25:00'}]*2):
            with self.assertRaises(RuntimeError): clock_value(current)
