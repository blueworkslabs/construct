import unittest
from xml.etree.ElementTree import Element
from keyboard_prompt import gboard_contacts_denial

def scene(app='Gboard', package='com.google.android.permissioncontroller'):
    return [Element('node', {'package': package,
        'resource-id': 'com.android.permissioncontroller:id/permission_message',
        'text': f'Allow {app} to access contacts and accounts on this device?'}),
        Element('node', {'package': package,
        'resource-id': 'com.android.permissioncontroller:id/permission_deny_button',
        'enabled': 'true', 'clickable': 'true'})]

class KeyboardPromptTest(unittest.TestCase):
    def test_declines_only_gboard_contacts(self):
        nodes = scene()
        self.assertIs(gboard_contacts_denial(nodes), nodes[1])
    def test_leaves_construct_permissions_untouched(self):
        self.assertIsNone(gboard_contacts_denial(scene('Construct')))
    def test_module_cannot_impersonate_system_dialog(self):
        self.assertIsNone(gboard_contacts_denial(scene(package='dev.construct.runtime')))
    def test_ambiguous_or_disabled_choice_is_not_tapped(self):
        nodes = scene()
        self.assertIsNone(gboard_contacts_denial(nodes + [nodes[1]]))
        nodes[1].set('enabled', 'false')
        self.assertIsNone(gboard_contacts_denial(nodes))
