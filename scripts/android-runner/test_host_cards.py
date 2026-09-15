import unittest
import xml.etree.ElementTree as ET
from host_cards import card_action, matching_card


def enabled(node, parents):
    while node is not None:
        if node.get('enabled') == 'false': return False
        node = parents.get(node)
    return True


def fixture(extra='', disabled='true'):
    root = ET.fromstring(f'''<node><node content-desc="Module card dev.construct.tone" enabled="{disabled}">
      <node text="Pocket Tones" content-desc="Pocket Tones, version 0.1.0"/>
      <node text="Open" enabled="true"/></node>{extra}</node>''')
    return list(root.iter('node'))


class HostCardTest(unittest.TestCase):
    def test_selects_action_only_within_exact_module_version(self):
        nodes = fixture('<node content-desc="Module card other"><node content-desc="Other, version 0.2.0"/><node text="Retry" enabled="true"/></node>')
        self.assertIsNotNone(card_action(nodes, 'Pocket Tones · 0.1.0', ('Open',), enabled))
        self.assertIsNone(card_action(nodes, 'Pocket Tones · 0.1.0', ('Retry',), enabled))
        self.assertIsNone(card_action(nodes, 'Pocket Tones · 0.2.0', ('Open',), enabled))

    def test_catalog_group_discovery_does_not_relax_final_version_match(self):
        nodes = fixture()
        self.assertIsNotNone(matching_card(nodes, 'Pocket Tones · 0.2.0', any_version=True))
        self.assertIsNone(card_action(nodes, 'Pocket Tones · 0.2.0', ('Open',), enabled))

    def test_ambiguous_identical_names_versions_fail_closed(self):
        nodes = fixture('<node content-desc="Module card different.id"><node content-desc="Pocket Tones, version 0.1.0"/><node text="Open" enabled="true"/></node>')
        with self.assertRaisesRegex(RuntimeError, 'Ambiguous'):
            card_action(nodes, 'Pocket Tones · 0.1.0', ('Open',), enabled)

    def test_disabled_ancestor_remains_disabled(self):
        self.assertIsNone(card_action(fixture(disabled='false'), 'Pocket Tones · 0.1.0', ('Open',), enabled))

    def test_matching_text_without_card_boundary_is_not_enough(self):
        root = ET.fromstring('<node><node content-desc="Pocket Tones, version 0.1.0"/><node text="Open" enabled="true"/></node>')
        self.assertIsNone(card_action(list(root.iter('node')), 'Pocket Tones · 0.1.0', ('Open',), enabled))

    def test_unversioned_selection_is_rejected(self):
        with self.assertRaises(ValueError): matching_card(fixture(), 'Pocket Tones')


if __name__ == '__main__': unittest.main()


class HostViewportTest(__import__('unittest').TestCase):
    def test_status_bar_first_is_not_a_scroll_viewport(self):
        from host_cards import host_viewport
        from xml.etree.ElementTree import Element
        current=[Element('node',{'package':'com.android.systemui','bounds':'[0,0][720,96]'}),
                 Element('node',{'package':'dev.construct.runtime','bounds':'[0,96][720,1552]'}),
                 Element('node',{'package':'dev.construct.runtime','bounds':'[24,200][690,400]'})]
        self.assertEqual(host_viewport(current),[0,96,720,1552])
    def test_landscape_uses_construct_not_the_larger_system_window(self):
        from host_cards import host_viewport
        from xml.etree.ElementTree import Element
        self.assertEqual(host_viewport([Element('node',{'package':'com.android.systemui','bounds':'[0,0][1600,720]'}),
          Element('node',{'package':'dev.construct.runtime','bounds':'[0,48][1512,700]'})]),[0,48,1512,700])
    def test_no_construct_window_fails_instead_of_swiping_system(self):
        from host_cards import host_viewport
        from xml.etree.ElementTree import Element
        with self.assertRaises(RuntimeError):host_viewport([Element('node',{'package':'com.android.systemui','bounds':'[0,0][720,1600]'})])
