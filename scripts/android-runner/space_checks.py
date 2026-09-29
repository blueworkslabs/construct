"""Scroll progress independent of rapidly changing sky/compass text."""
import re

def scroll_signature(nodes):
    visible = []
    for node in nodes:
        if node.get('package') not in (None, '', 'dev.construct.runtime'):
            continue  # Fixed system bars are not part of the scrolling module.
        b = list(map(int, re.findall(r'-?\d+', node.get('bounds', ''))))
        if len(b) == 4 and b[2] > b[0] and b[3] - b[1] >= 8:
            visible.append(node)
    leaves = {'android.widget.TextView', 'android.widget.Button',
              'android.widget.ToggleButton', 'android.widget.SeekBar', 'android.widget.Image'}
    anchors = [(n.get('resource-id'), n.get('bounds')) for n in visible
               if n.get('resource-id') and not n.get('resource-id').startswith('android:')
               and n.get('class') in leaves]
    if anchors:
        return ('anchors', tuple(anchors))
    # Inside a long list with no named controls, distinguish successive rows.
    return ('rows', tuple((n.get('text') or n.get('content-desc'), n.get('bounds'))
                          for n in visible if n.get('text') or n.get('content-desc')))
