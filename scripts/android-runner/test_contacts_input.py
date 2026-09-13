"""Query transport must verify app input before invoking a personal-data read."""
import ast
from pathlib import Path
import types
import unittest
import xml.etree.ElementTree as ET

SOURCE = Path(__file__).with_name('contacts.py')
QUERY = ast.Module(body=[n for n in ast.parse(SOURCE.read_text()).body
                         if isinstance(n, ast.FunctionDef) and n.name == 'query'],
                   type_ignores=[])

class ContactsInputTests(unittest.TestCase):
    def driver(self, failures=0, focused=True):
        state = {'text': '', 'writes': 0, 'searches': 0, 'clock': 0.0}
        def node():
            return ET.Element('node', {'class': 'android.widget.EditText',
                'package': 'dev.construct.runtime', 'enabled': 'true',
                'focused': str(focused).lower(), 'bounds': '[0,0][100,50]',
                'text': state['text']})
        def adb(*args):
            if args[2] == 'text':
                state['writes'] += 1
                state['text'] = args[3][1:] if state['writes'] <= failures else args[3]
            elif args[2:] == ('keyevent', '67'):
                state['text'] = ''
        def sleep(seconds): state['clock'] += seconds
        def tap(label):
            self.assertEqual(label, 'Search')
            state['searches'] += 1
        scope = {'nodes': lambda: [node()], 'web_find': lambda *a, **k: None,
                 'tap_node': lambda n: None, 'adb': adb, 'tap': tap,
                 'time': types.SimpleNamespace(monotonic=lambda: state['clock'], sleep=sleep)}
        exec(compile(QUERY, str(SOURCE), 'exec'), scope)
        return scope['query'], state

    def test_dropped_first_character_is_replaced_before_search(self):
        query, state = self.driver(failures=1)
        query('ConstructTest00')
        self.assertEqual(state['text'], 'ConstructTest00')
        self.assertEqual(state['writes'], 2)
        self.assertEqual(state['searches'], 1)

    def test_persistent_input_mismatch_never_searches(self):
        query, state = self.driver(failures=10)
        with self.assertRaisesRegex(RuntimeError, 'exactly match'):
            query('ConstructTest00')
        self.assertEqual(state['writes'], 2)
        self.assertEqual(state['searches'], 0)

    def test_missing_focus_never_types_or_searches(self):
        query, state = self.driver(focused=False)
        with self.assertRaisesRegex(RuntimeError, 'focus'):
            query('ConstructTest00')
        self.assertEqual(state['writes'], 0)
        self.assertEqual(state['searches'], 0)

if __name__ == '__main__': unittest.main()
