import unittest
from catalog_input import replace_catalog

class CatalogInputTests(unittest.TestCase):
    def setUp(self):
        self.now=0;self.writes=[]
    def clock(self):return self.now
    def sleep(self,seconds):self.now+=seconds
    def field(self,text):return {'class':'android.widget.EditText','package':'dev.construct.runtime','text':text,'focused':'false'}
    def run_replace(self,read,write):replace_catalog(read,write,'https://example.org/index.json',timeout=.5,clock=self.clock,sleep=self.sleep)
    def test_transient_missing_tree_then_unfocused_field_can_be_replaced(self):
        state={'text':'demo'};reads=[[],[self.field('demo')]]
        def read():return reads.pop(0) if reads else [self.field(state['text'])]
        def write(value):self.writes.append(value);state['text']=value
        self.run_replace(read,write);self.assertEqual(len(self.writes),1)
    def test_missing_or_ambiguous_field_never_receives_a_write(self):
        for fields in ([],[self.field('a'),self.field('b')]):
            with self.subTest(fields=fields),self.assertRaises(RuntimeError):self.run_replace(lambda:fields,self.writes.append)
        self.assertEqual(self.writes,[])
    def test_dropped_character_retries_only_idempotent_replacement(self):
        state={'text':'demo'}
        def write(value):
            self.writes.append(value);state['text']=value[1:] if len(self.writes)==1 else value
        self.run_replace(lambda:[self.field(state['text'])],write);self.assertEqual(len(self.writes),2)
    def test_persistent_mismatch_is_failure_not_success(self):
        with self.assertRaises(RuntimeError):self.run_replace(lambda:[self.field('wrong')],self.writes.append)
        self.assertEqual(len(self.writes),2)
