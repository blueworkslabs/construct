"""Pure, device-free checks for API 0.13 capture metadata (unit-tested in test_capture_checks.py).

Sign convention (docs/aime/resection.js basis()): pitch > 0 when the camera looks below the
horizon; roll > 0 when the image's right side points down (horizon higher on the right).
Runs under `python -O`, so nothing here relies on assert statements.
"""
import json
import math
import re

G = 9.80665
TILT_MAX_AGE_MS = 250
HEADING_MAX_AGE_MS = 1000
READOUT = re.compile(r'(Pitch|Roll) ([+-]\d+\.\d)°')
RESULT_PREFIX = 'Capture result: '


def acceleration(pitch, roll):
    """`adb emu sensor set acceleration` value for a portrait (ROTATION_0) phone.

    A resting accelerometer reports the up vector in the sensor frame (x right, y top,
    z out of the screen); the rear camera looks along -z. Tipping the camera down gives
    up a +z component; lowering the right side gives it a -x component.
    """
    p, r = math.radians(pitch), math.radians(roll)
    x = -G * math.cos(p) * math.sin(r)
    y = G * math.cos(p) * math.cos(r)
    z = G * math.sin(p)
    return '%.4f:%.4f:%.4f' % (x, y, z)


def level_readout(labels):
    """{'Pitch': float, 'Roll': float} from the viewfinder readout labels, or None."""
    found = {}
    for label in labels:
        for name, value in READOUT.findall(label or ''):
            found[name] = float(value)
    return found if set(found) == {'Pitch', 'Roll'} else None


def readout_matches(readout, pitch, roll, tolerance=1.5):
    return readout is not None and abs(readout['Pitch'] - pitch) <= tolerance and abs(readout['Roll'] - roll) <= tolerance


def parse_result(labels):
    """The fixture's raw bridge result, parsed from its 'Capture result: {...}' label."""
    for label in labels:
        if (label or '').startswith(RESULT_PREFIX) and label != RESULT_PREFIX + 'none':
            return json.loads(label[len(RESULT_PREFIX):])
    return None


def zoomed(fov_at_one, zoom):
    """Pure digital crop: the tangent shrinks by the zoom ratio, never the angle."""
    return math.degrees(2 * math.atan(math.tan(math.radians(fov_at_one) / 2) / zoom))


def _number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _age(value, limit):
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= limit


def check_result(result, *, zoom, pitch=None, roll=None, tolerance=2.0, portrait=True):
    """Problems (empty when acceptable) with one API 0.13 capture result.

    `pitch`/`roll` are the injected values; tilt must then be present with matching sign
    and magnitude. FOV may be omitted only if the device cannot state it, but when present
    it must be plausible, oriented like the image (portrait: narrower horizontally) and
    carry fovSigmaDeg. Every measured field carries its own uncertainty and, for sensor
    values, an age within the contract (tilt 250 ms, heading 1 s).
    """
    problems = []
    if not isinstance(result, dict) or result.get('saved') is not True:
        return ['not saved']
    if set(result) != {'saved', 'id', 'capture'}:
        problems.append('unexpected result keys %s' % sorted(result))
    if not isinstance(result.get('id'), str) or not re.fullmatch(r'[\x21-\x7e]{1,80}', result.get('id') or ''):
        problems.append('missing or malformed id')
    capture = result.get('capture')
    if not isinstance(capture, dict):
        return problems + ['missing capture']
    allowed = {'zoomRatio', 'fovDeg', 'fovSigmaDeg', 'tilt', 'headingDeg', 'headingRef', 'headingAccuracyDeg', 'headingAgeMs'}
    if not set(capture) <= allowed:
        problems.append('unexpected capture keys %s' % sorted(set(capture) - allowed))
    ratio = capture.get('zoomRatio')
    if not _number(ratio) or abs(ratio - zoom) > 0.05:
        problems.append('zoomRatio %r, expected %r' % (ratio, zoom))
    fov = capture.get('fovDeg')
    if fov is not None:
        if not isinstance(fov, dict) or set(fov) != {'h', 'v'} or not all(_number(fov[k]) and 1 < fov[k] < 150 for k in ('h', 'v')):
            problems.append('implausible fovDeg %r' % (fov,))
        elif portrait != (fov['h'] < fov['v']):
            problems.append('fovDeg orientation does not match the image %r' % (fov,))
        sigma = capture.get('fovSigmaDeg')
        if not _number(sigma) or not 0.5 <= sigma <= 5:
            problems.append('fovSigmaDeg missing or out of range %r' % (sigma,))
    elif 'fovSigmaDeg' in capture:
        problems.append('fovSigmaDeg without fovDeg')
    tilt = capture.get('tilt')
    if tilt is not None and (not isinstance(tilt, dict) or set(tilt) != {'pitchDeg', 'rollDeg', 'sigmaDeg', 'ageMs'}
                             or not all(_number(v) for v in tilt.values())):
        problems.append('tilt malformed %r' % (tilt,))
    elif tilt is not None:
        if not 1 <= tilt['sigmaDeg'] <= 10:
            problems.append('sigmaDeg out of range %r' % tilt['sigmaDeg'])
        if not _age(tilt['ageMs'], TILT_MAX_AGE_MS):
            problems.append('tilt ageMs out of range %r' % tilt['ageMs'])
    if pitch is not None or roll is not None:
        if not isinstance(tilt, dict) or not all(k in tilt and _number(tilt[k]) for k in ('pitchDeg', 'rollDeg')):
            problems.append('tilt missing or malformed %r' % (tilt,))
        else:
            for name, expected in (('pitchDeg', pitch), ('rollDeg', roll)):
                if expected is None:
                    continue
                actual = tilt[name]
                if abs(actual - expected) > tolerance:
                    problems.append('%s %r, expected %r' % (name, actual, expected))
                elif abs(expected) >= tolerance and (actual > 0) != (expected > 0):
                    problems.append('%s sign flipped: %r for %r' % (name, actual, expected))
    heading = capture.get('headingDeg')
    if heading is not None:
        if not _number(heading) or not 0 <= heading < 360 or capture.get('headingRef') != 'magnetic':
            problems.append('malformed heading %r %r' % (heading, capture.get('headingRef')))
        accuracy = capture.get('headingAccuracyDeg')
        if not _number(accuracy) or not 0 <= accuracy <= 45:
            problems.append('headingAccuracyDeg missing or out of range %r' % (accuracy,))
        if not _age(capture.get('headingAgeMs'), HEADING_MAX_AGE_MS):
            problems.append('headingAgeMs missing or out of range %r' % (capture.get('headingAgeMs'),))
    elif any(k in capture for k in ('headingRef', 'headingAccuracyDeg', 'headingAgeMs')):
        problems.append('heading details without a heading')
    return problems


def check_zoom_pair(one, two, zoom=2.0, tolerance=0.5):
    """At `zoom`, FOV must follow 2·atan(tan(fov1/2)/z) from the 1× capture, not fov1/z."""
    a, b = one.get('capture', {}).get('fovDeg'), two.get('capture', {}).get('fovDeg')
    if a is None or b is None:
        return ['fovDeg omitted; zoom pair not comparable']
    problems = []
    for k in ('h', 'v'):
        if abs(zoomed(a[k], zoom) - b[k]) > tolerance:
            problems.append('%s at %s×: %r, expected %r' % (k, zoom, b[k], zoomed(a[k], zoom)))
    return problems


def dark_fraction(pixels, threshold=8):
    """Fraction of RGB(A) pixels whose brightest channel is at most `threshold`."""
    total = dark = 0
    for pixel in pixels:
        total += 1
        if max(pixel[:3]) <= threshold:
            dark += 1
    return dark / total if total else 1.0


def secure_blackout(pixels):
    """FLAG_SECURE screenshots arrive black; any real UI has lit pixels."""
    return dark_fraction(pixels) >= 0.995


def screenshot_content_bounds(width, height, nodes):
    """Exclude only recognized, edge-aligned Android system bars, never app UI.

    The green privacy indicator stays capturable over a correctly secured camera.
    Ignore full-window SystemUI containers and retain raw evidence separately.
    """
    top, bottom = 0, height
    for n in nodes:
        if n.get('package') != 'com.android.systemui':
            continue
        key = n.get('resource-id', '').split('/')[-1]
        if key not in ('status_bar', 'navigation_bar', 'navigation_bar_frame'):
            continue
        bounds = list(map(int, re.findall(r'-?\d+', n.get('bounds', ''))))
        if len(bounds) != 4:
            continue
        x1, y1, x2, y2 = bounds
        if x1 != 0 or x2 != width or not 0 < y2 - y1 <= height / 10:
            continue
        if y1 == 0: top = max(top, y2)
        if y2 == height: bottom = min(bottom, y1)
    return (0, top, width, bottom)


def zoom_chip_selected(nodes, label):
    """Read selection on the labelled chip or its nearest checkable ancestor.

    Compose exposes FilterChip as a checkable parent with a separate label node;
    another selected chip elsewhere must never satisfy this check.
    """
    parents = {child: parent for parent in nodes for child in parent}
    for node in nodes:
        if node.get('content-desc') != 'Zoom ' + label:
            continue
        while node is not None:
            if node.get('checkable') == 'true':
                return node.get('checked') == 'true'
            if node.get('selected') == 'true':
                return True
            node = parents.get(node)
    return False


def freshness_omission(result, problems):
    """A narrowly justified retake, not an exemption from any metadata/sign check."""
    capture = result.get('capture', {})
    return (problems == ['tilt missing or malformed None'] and 'tilt' not in capture
            and not check_result(result, zoom=capture.get('zoomRatio'))
            and _age(capture.get('headingAgeMs'), HEADING_MAX_AGE_MS)
            and capture['headingAgeMs'] > TILT_MAX_AGE_MS)
