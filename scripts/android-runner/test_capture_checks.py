"""Device-free checks for the API 0.13 capture runner helpers (runs under python -O)."""
import json
import math
import unittest
from capture_checks import (G, acceleration, check_result, check_zoom_pair, dark_fraction, level_readout,
                            parse_result, readout_matches, secure_blackout, screenshot_content_bounds, zoomed)


def vector(value):
    return [float(v) for v in value.split(':')]


def result(**capture):
    base = dict(zoomRatio=1.0, fovDeg=dict(h=50.0, v=64.0), fovSigmaDeg=1.0, tilt=dict(pitchDeg=0.0, rollDeg=0.0, sigmaDeg=1.0, ageMs=30))
    base.update(capture)
    return dict(saved=True, id='pAbCdEfGhIjKlMnOpQrStUvWx', capture={k: v for k, v in base.items() if v is not None})


class AccelerationTest(unittest.TestCase):
    def test_level_portrait_reads_one_g_up_the_long_axis(self):
        x, y, z = vector(acceleration(0, 0))
        self.assertAlmostEqual(0, x, places=3); self.assertAlmostEqual(G, y, places=3); self.assertAlmostEqual(0, z, places=3)

    def test_pitch_down_adds_out_of_screen_component_and_roll_right_down_subtracts_x(self):
        self.assertGreater(vector(acceleration(10, 0))[2], 0)
        self.assertLess(vector(acceleration(-10, 0))[2], 0)
        self.assertLess(vector(acceleration(0, 10))[0], 0)
        self.assertGreater(vector(acceleration(0, -10))[0], 0)
        for pitch, roll in [(10, 0), (0, -10), (25, 10)]:
            self.assertAlmostEqual(G, math.hypot(*vector(acceleration(pitch, roll))), places=3)

    def test_round_trip_through_the_host_formula(self):
        # Host (ROTATION_0): pitch = atan2(z, hypot(x, y)); roll = atan2(-x, y).
        for pitch, roll in [(10, 0), (-10, 0), (0, 10), (0, -10), (20, -15)]:
            x, y, z = vector(acceleration(pitch, roll))
            self.assertAlmostEqual(pitch, math.degrees(math.atan2(z, math.hypot(x, y))), places=2)
            self.assertAlmostEqual(roll, math.degrees(math.atan2(-x, y)), places=2)


class ReadoutAndResultTest(unittest.TestCase):
    def test_level_readout_needs_both_values(self):
        self.assertEqual({'Pitch': 10.0, 'Roll': -0.3}, level_readout(['Camera viewfinder', 'Pitch +10.0°', 'Roll -0.3°']))
        self.assertIsNone(level_readout(['Pitch +10.0°']))
        self.assertIsNone(level_readout(['Level unavailable', None]))
        self.assertTrue(readout_matches(level_readout(['Pitch +9.2°', 'Roll +0.4°']), 10, 0))
        self.assertFalse(readout_matches(level_readout(['Pitch -9.2°', 'Roll +0.4°']), 10, 0))
        self.assertFalse(readout_matches(None, 0, 0))

    def test_parse_result_reads_the_raw_json_label(self):
        raw = result()
        self.assertEqual(raw, parse_result(['Captured. #3', 'Capture result: ' + json.dumps(raw)]))
        self.assertIsNone(parse_result(['Capture result: none']))

    def test_accepts_matching_signs_and_rejects_flips(self):
        self.assertEqual([], check_result(result(tilt=dict(pitchDeg=9.6, rollDeg=0.2, sigmaDeg=1.1, ageMs=30)), zoom=1, pitch=10, roll=0))
        self.assertTrue(any('sign flipped' in p or 'expected' in p for p in
                            check_result(result(tilt=dict(pitchDeg=-9.6, rollDeg=0.2, sigmaDeg=1.1, ageMs=30)), zoom=1, pitch=10, roll=0)))
        self.assertTrue(check_result(result(tilt=dict(pitchDeg=0.0, rollDeg=10.1, sigmaDeg=1.0, ageMs=30)), zoom=1, pitch=0, roll=-10))
        self.assertEqual([], check_result(result(tilt=dict(pitchDeg=0.0, rollDeg=-10.1, sigmaDeg=1.0, ageMs=30)), zoom=1, pitch=0, roll=-10))

    def test_rejects_missing_tilt_bad_ranges_extra_keys_and_orientation(self):
        self.assertIn('tilt missing', check_result(result(tilt=None), zoom=1, pitch=10, roll=0)[0])
        self.assertEqual([], check_result(result(tilt=None), zoom=1))
        self.assertTrue(check_result(result(tilt=dict(pitchDeg=10, rollDeg=0, sigmaDeg=0.5, ageMs=30)), zoom=1, pitch=10, roll=0))

    def test_every_measurement_carries_uncertainty_and_age(self):
        self.assertEqual([], check_result(result(tilt=dict(pitchDeg=0.0, rollDeg=0.0, sigmaDeg=1.0, ageMs=250)), zoom=1))
        self.assertTrue(check_result(result(tilt=dict(pitchDeg=0.0, rollDeg=0.0, sigmaDeg=1.0, ageMs=251)), zoom=1))
        self.assertTrue(check_result(result(tilt=dict(pitchDeg=0.0, rollDeg=0.0, sigmaDeg=1.0, ageMs=-1)), zoom=1))
        self.assertTrue(check_result(result(tilt=dict(pitchDeg=0.0, rollDeg=0.0, sigmaDeg=1.0, ageMs=12.5)), zoom=1))
        self.assertTrue(check_result(result(tilt=dict(pitchDeg=0.0, rollDeg=0.0, sigmaDeg=1.0)), zoom=1))
        self.assertTrue(check_result(result(fovSigmaDeg=None), zoom=1))
        self.assertTrue(check_result(result(fovSigmaDeg=0.2), zoom=1))
        self.assertEqual([], check_result(result(fovSigmaDeg=2.0), zoom=1))
        self.assertTrue(check_result(result(fovDeg=None), zoom=1))
        self.assertEqual([], check_result(result(fovDeg=None, fovSigmaDeg=None), zoom=1))
        self.assertTrue(check_result(result(zoomRatio=1.0), zoom=2))
        self.assertTrue(check_result(result(fovDeg=dict(h=64.0, v=50.0)), zoom=1))
        self.assertEqual([], check_result(result(fovDeg=dict(h=64.0, v=50.0)), zoom=1, portrait=False))
        self.assertTrue(check_result(result(fovDeg=dict(h=0.5, v=64.0)), zoom=1))
        self.assertTrue(check_result(result(latitude=52.1), zoom=1))
        self.assertEqual(['not saved'], check_result(dict(saved=False), zoom=1))
        legacy = dict(saved=True)
        self.assertTrue(check_result(legacy, zoom=1))

    def test_heading_is_optional_but_must_be_magnetic_and_bounded(self):
        good = dict(headingDeg=123.4, headingRef='magnetic', headingAccuracyDeg=12.0, headingAgeMs=40)
        self.assertEqual([], check_result(result(**good), zoom=1))
        self.assertTrue(check_result(result(headingDeg=123.4), zoom=1))
        self.assertTrue(check_result(result(**{**good, 'headingDeg': 360.0}), zoom=1))
        self.assertTrue(check_result(result(headingRef='magnetic'), zoom=1))
        self.assertTrue(check_result(result(headingAgeMs=10), zoom=1))
        self.assertTrue(check_result(result(**{**good, 'headingAccuracyDeg': 90.0}), zoom=1))
        self.assertTrue(check_result(result(**{**good, 'headingAccuracyDeg': None}), zoom=1), 'no invented or missing uncertainty')
        self.assertTrue(check_result(result(**{**good, 'headingAgeMs': 1001}), zoom=1))
        self.assertTrue(check_result(result(**{**good, 'headingAgeMs': None}), zoom=1))

    def test_zoom_pair_uses_the_tangent_not_the_angle(self):
        self.assertAlmostEqual(38.59, zoomed(70, 2), places=2)
        one = result(fovDeg=dict(h=70.0, v=55.0))
        good = result(zoomRatio=2.0, fovDeg=dict(h=round(zoomed(70, 2), 2), v=round(zoomed(55, 2), 2)))
        naive = result(zoomRatio=2.0, fovDeg=dict(h=35.0, v=27.5))
        self.assertEqual([], check_zoom_pair(one, good))
        self.assertEqual(2, len(check_zoom_pair(one, naive)))
        self.assertTrue(check_zoom_pair(result(fovDeg=None), good))


class ScreenshotTest(unittest.TestCase):
    def test_system_bars_excluded_without_masking_module_or_fullscreen_containers(self):
        def node(key, bounds, package='com.android.systemui'):
            return {'package':package,'resource-id':'com.android.systemui:id/'+key,'bounds':bounds}
        bars=[node('status_bar','[0,0][720,36]'),node('navigation_bar_frame','[0,1244][720,1280]')]
        self.assertEqual((0,36,720,1244),screenshot_content_bounds(720,1280,bars))
        self.assertEqual((0,0,720,1280),screenshot_content_bounds(720,1280,[
            node('status_bar','[0,0][720,1280]'), node('status_bar','[0,0][720,80]','dev.construct.runtime'),
            node('app','[0,0][720,90]'),node('status_bar','[5,0][715,80]')]))

    def test_secure_blackout_detection(self):
        black = [(0, 0, 0, 255)] * 1000
        ui = [(0, 0, 0, 255)] * 900 + [(230, 240, 234, 255)] * 100
        self.assertTrue(secure_blackout(black))
        self.assertFalse(secure_blackout(ui))
        self.assertAlmostEqual(0.9, dark_fraction(ui))
        self.assertEqual(1.0, dark_fraction([]))


if __name__ == '__main__':
    unittest.main()
