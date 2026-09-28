"""Parse active native connections, deliberately excluding historical registrations."""
import re

def active_connections(dump, uid):
    section = re.search(r'^\d+ open event connections\s*\n(.*?)^\d+ open direct connections\s*$', dump, re.M | re.S)
    if section is None:
        raise ValueError('Sensor-service active connection section missing')
    return len(re.findall(r'\| uid '+str(int(uid))+r' \|', section.group(1)))
