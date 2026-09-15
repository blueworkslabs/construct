"""Read the real Focus clock across WebView accessibility label variants."""
import re


def clock_value(current):
    values = []
    for node in current:
        if node.get('package') != 'dev.construct.runtime':
            continue
        labels = {node.get('text', ''), node.get('content-desc', '')}
        matches = {m.group(1) for label in labels
                   if (m := re.fullmatch(r'(?:Time remaining: )?(\d{2}:[0-5]\d)', label))}
        if len(matches) > 1:
            raise RuntimeError('Conflicting Focus clock labels')
        values.extend(matches)
    if len(values) != 1:
        raise RuntimeError('Missing unique Focus clock')
    return values[0]
