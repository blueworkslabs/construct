"""Exact-card selection for the Library UI; never cross module/version boundaries."""
import re


def card_heading(heading):
    match = re.fullmatch(r'(.+) · (\d+\.\d+\.\d+)', heading)
    if not match:
        raise ValueError('Expected an exact module name and numeric version')
    return match.groups()


def matching_card(current, heading, any_version=False):
    name, version = card_heading(heading)
    parents = {child: node for node in current for child in node}
    matches = []
    for node in current:
        description = node.get('content-desc', '')
        if (description == f'{name}, version {version}' or
                (any_version and re.fullmatch(re.escape(name) + r', version \d+\.\d+\.\d+', description))):
            parent = node
            while parent is not None:
                if parent.get('content-desc', '').startswith('Module card '):
                    if parent not in matches: matches.append(parent)
                    break
                parent = parents.get(parent)
    if len(matches) > 1:
        raise RuntimeError('Ambiguous module/version card; refusing action')
    return matches[0] if matches else None


def card_action(current, heading, choices, is_enabled, any_version=False):
    card = matching_card(current, heading, any_version)
    if card is None: return None
    parents = {child: node for node in current for child in node}
    matches = [node for node in card.iter('node')
               if any(value in choices for value in (node.get('text'), node.get('content-desc')))
               and is_enabled(node, parents)]
    if len(matches) > 1:
        raise RuntimeError('Ambiguous action inside exact card')
    return matches[0] if matches else None


def host_viewport(current):
    """Accessibility window ordering can put Android's status bar first."""
    rectangles=[]
    for node in current:
        if node.get('package')!='dev.construct.runtime': continue
        values=list(map(int,re.findall(r'-?\d+',node.get('bounds',''))))
        if len(values)!=4: continue
        x1,y1,x2,y2=values
        if x1>=0 and y1>=0 and x2>x1 and y2>y1:
            rectangles.append(values)
    if not rectangles: raise RuntimeError('Construct window is absent; refusing a system-window gesture')
    return max(rectangles,key=lambda r:(r[2]-r[0])*(r[3]-r[1]))
