import unittest
from space_checks import scroll_signature

class ScrollBoundaryTest(unittest.TestCase):
    def test_dynamic_sky_text_does_not_hide_top_boundary(self):
        a = {'resource-id':'counts','class':'android.widget.TextView',
             'bounds':'[24,222][696,267]','text':'5 visible · 11 above you'}
        b = dict(a, text='3 visible · 10 above you')
        self.assertEqual(scroll_signature([a]), scroll_signature([b]))
        b['bounds'] = '[24,100][696,145]'
        self.assertNotEqual(scroll_signature([a]), scroll_signature([b]))

    def test_unnamed_list_rows_are_not_a_false_boundary(self):
        a = {'class':'android.widget.ToggleButton','bounds':'[24,100][696,200]',
             'text':'ISS · above you'}
        b = dict(a, text='Guowang train · above you')
        self.assertNotEqual(scroll_signature([a]), scroll_signature([b]))

if __name__ == '__main__':
    unittest.main()
