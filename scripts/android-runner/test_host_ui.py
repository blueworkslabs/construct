"""Regression checks for wrong-card / moving-target UI actions, without a device."""
import importlib.util
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch
import xml.etree.ElementTree as ET


def tree(second=False, disabled=False):
    root = ET.fromstring('<node><node text="Pocket Tones · 0.1.0"/><node text="Open" bounds="[0,10][100,50]" enabled="true"/></node>')
    if second:
        root.insert(1, ET.Element('node', {'text': 'Different module · 0.1.0'}))
    if disabled:
        root.set('enabled', 'false')
    return list(root.iter('node'))


def enabled(node, parents):
    while node is not None:
        if node.get('enabled') == 'false': return False
        node = parents.get(node)
    return True


class CardSelectorTest(unittest.TestCase):
    def setUp(self):
        self.ui = types.ModuleType('ui')
        for name in ('adb', 'nodes', 'labels', 'tap', 'tap_node', 'find'):
            setattr(self.ui, name, Mock())
        self.ui.enabled = enabled
        spec = importlib.util.spec_from_file_location('tested_host_ui', Path(__file__).with_name('host_ui.py'))
        self.host = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'ui': self.ui}): spec.loader.exec_module(self.host)

    def test_never_uses_another_modules_open_button(self):
        self.ui.nodes.return_value = tree(second=True)
        with patch.object(self.host.time, 'sleep'), self.assertRaises(RuntimeError):
            self.host.select_after('Pocket Tones · 0.1.0', ('Open',))
        self.ui.tap_node.assert_not_called()

    def test_disabled_parent_cannot_be_tapped(self):
        self.ui.nodes.return_value = tree(disabled=True)
        with patch.object(self.host.time, 'sleep'), self.assertRaises(RuntimeError):
            self.host.select_after('Pocket Tones · 0.1.0', ('Open',))
        self.ui.tap_node.assert_not_called()

    def test_moving_target_is_reacquired_before_click(self):
        first = tree(); moved = tree()
        moved[-1].set('bounds', '[0,70][100,110]')
        self.ui.nodes.side_effect = [first, moved, moved]
        with patch.object(self.host.time, 'sleep'):
            self.host.select_after('Pocket Tones · 0.1.0', ('Open',))
        self.ui.tap_node.assert_called_once_with(moved[-1])

    def test_long_catalog_checks_card_after_more_than_ten_scrolls(self):
        target = tree()
        self.ui.nodes.side_effect = [[] for _ in range(11)] + [target, target]
        with patch.object(self.host.time, 'sleep'):
            self.host.select_after('Pocket Tones · 0.1.0', ('Open',))
        self.ui.tap_node.assert_called_once_with(target[-1])
        self.assertEqual(self.ui.adb.call_count, 11)

    def test_install_waits_for_dialog_and_exposes_status(self):
        self.ui.labels.side_effect = [['Allow & install'], [], [], ['Use configured registry']]
        with patch.object(self.host.time, 'sleep'):
            self.host.installed_status()
        self.ui.adb.assert_called_once()
        self.ui.find.assert_called_once_with('Installed. Open and test it, then mark it working.')

    def test_open_consent_never_counts_as_installed(self):
        self.ui.labels.return_value = ['Allow & install']
        with patch.object(self.host.time, 'sleep'), self.assertRaises(RuntimeError):
            self.host.installed_status()
        self.ui.adb.assert_not_called()
        self.ui.find.assert_not_called()

    def test_missing_success_status_remains_failure(self):
        self.ui.labels.return_value = ['Use configured registry']
        self.ui.find.side_effect = RuntimeError('missing actual success')
        with self.assertRaises(RuntimeError): self.host.installed_status()

    def test_diagnostics_reaches_beyond_four_scrolls_and_reads_actual_events(self):
        event = '{"time":"synthetic","code":"EXPECTED"}'
        self.ui.labels.side_effect = [[] for _ in range(7)] + [['Diagnostics'], [event], ['Back']]
        with patch.object(self.host.time, 'sleep'):
            self.assertEqual(self.host.diagnostics(), [{'time':'synthetic','code':'EXPECTED'}])
        self.assertEqual(self.ui.adb.call_count, 7)
        self.assertEqual([c.args for c in self.ui.tap.call_args_list], [('Diagnostics',), ('Back',)])

    def test_missing_native_diagnostics_fails_without_tapping(self):
        self.ui.labels.return_value = ['Module stopped.']
        with patch.object(self.host.time, 'sleep'), self.assertRaisesRegex(RuntimeError, 'Cannot expose'):
            self.host.diagnostics()
        self.assertEqual(self.ui.adb.call_count, 20)
        self.ui.tap.assert_not_called()

    def test_session_diagnostics_does_not_scroll_module_or_reuse_evidence(self):
        self.ui.labels.side_effect = [['Construct menu'], [], ['Back to menu']]
        with self.assertRaisesRegex(RuntimeError, 'export missing'):
            self.host.diagnostics()
        self.ui.adb.assert_not_called()
        self.assertEqual([c.args for c in self.ui.tap.call_args_list],
                         [('Diagnostics',), ('Back to menu',), ('Close module',)])


if __name__ == '__main__': unittest.main()
