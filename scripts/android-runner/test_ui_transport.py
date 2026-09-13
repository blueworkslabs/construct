"""Hierarchy reconnection must use fresh evidence and fail on persistent errors."""
import importlib.util
from http.client import RemoteDisconnected
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch

class TransportTest(unittest.TestCase):
    def setUp(self):
        self.u2 = types.ModuleType('uiautomator2')
        self.u2.connect_usb = Mock()
        spec = importlib.util.spec_from_file_location('tested_ui', Path(__file__).with_name('ui.py'))
        self.ui = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {'uiautomator2': self.u2}): spec.loader.exec_module(self.ui)
        self.guard = patch.object(self.ui, 'require_runner')
        self.guard.start(); self.addCleanup(self.guard.stop)

    def test_unconfigured_hierarchy_cannot_connect_to_a_device(self):
        self.ui.require_runner.side_effect = RuntimeError('Not authorized')
        with self.assertRaises(RuntimeError): self.ui.nodes()
        self.u2.connect_usb.assert_not_called()

    def test_disconnect_reconnects_and_returns_only_fresh_tree(self):
        old, new = Mock(), Mock()
        old.dump_hierarchy.side_effect = RemoteDisconnected('lost')
        new.dump_hierarchy.return_value = '<node text="fresh"/>'
        self.u2.connect_usb.side_effect = [old, new]
        with patch.object(self.ui.time, 'sleep'):
            self.assertEqual([n.get('text') for n in self.ui.nodes()], ['fresh'])
        self.assertEqual(self.u2.connect_usb.call_count, 2)

    def test_persistent_transport_failure_is_not_success(self):
        device = Mock(); device.dump_hierarchy.side_effect = RemoteDisconnected('lost')
        self.u2.connect_usb.return_value = device
        with patch.object(self.ui.time, 'sleep'), self.assertRaises(RemoteDisconnected):
            self.ui.nodes()
        self.assertEqual(device.dump_hierarchy.call_count, 2)

    def test_invalid_evidence_is_not_retried_or_hidden(self):
        device = Mock(); device.dump_hierarchy.return_value = 'not XML'
        self.u2.connect_usb.return_value = device
        with self.assertRaises(self.ui.ET.ParseError): self.ui.nodes()
        self.assertEqual(device.dump_hierarchy.call_count, 1)

if __name__ == '__main__': unittest.main()
