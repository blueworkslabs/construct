import unittest
from space_checks import scroll_signature, visible_point_guidance

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

    def test_fixed_system_bar_does_not_hide_unnamed_list_progress(self):
        clock = {'package':'com.android.systemui','resource-id':'com.android.systemui:id/clock',
                 'class':'android.widget.TextView','bounds':'[6,1][71,34]','text':'1:17'}
        a = {'package':'dev.construct.runtime','class':'android.widget.ToggleButton',
             'bounds':'[24,100][696,200]','text':'ISS · above you'}
        b = dict(a,text='Guowang train · above you')
        self.assertNotEqual(scroll_signature([clock,a]),scroll_signature([clock,b]))

class PointingGuidanceTest(unittest.TestCase):
    def test_distinguishes_visual_guidance_from_hidden_announcement(self):
        for text in ['Move the phone 2 fists up.', 'Move the phone 1½ fists down and to the left.',
                     'On target. Look past the top of the phone.',
                     'Turn around: it is behind you, 3 fists up.']:
            self.assertTrue(visible_point_guidance(text), text)
        for text in ['Move the phone up.', 'On target.', 'Turn around: it is behind you.',
                     'Waiting for the compass…']:
            self.assertFalse(visible_point_guidance(text), text)

if __name__ == '__main__':
    unittest.main()
