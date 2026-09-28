"""Parse active native connections, deliberately excluding historical registrations."""
import re

def active_connections(dump, uid):
    section = re.search(r'^\d+ open event connections\s*\n(.*?)^\d+ open direct connections\s*$', dump, re.M | re.S)
    if section is None:
        raise ValueError('Sensor-service active connection section missing')
    return len(re.findall(r'\| uid '+str(int(uid))+r' \|', section.group(1)))

def paused_without_stop(system, client):
    """Require the module's system PAUSED and client Activity flags, not a ViewRoot flag."""
    record = re.search(r'\*\s+Hist\s+#\d+:[^\n]*dev\.construct\.runtime/\.ModuleActivity[^\n]*\n(.*?)(?=\n\s*\*\s+Hist\s+#|\n\s*RootTask|\Z)', system, re.S)
    state = re.search(r'Local Activity [^\n]* State:\s*\n\s*(mResumed=[^\n]+)', client)
    return bool(record and re.search(r'\bstate=PAUSED\b', record.group(1)) and state
                and 'mResumed=false' in state.group(1) and 'mStopped=false' in state.group(1))

def resumed_unfocused(system, client, peer=False):
    record = re.search(r'\*\s+Hist\s+#\d+:[^\n]*dev\.construct\.runtime/\.ModuleActivity[^\n]*\n(.*?)(?=\n\s*\*\s+Hist\s+#|\n\s*RootTask|\Z)', system, re.S)
    state = re.search(r'Local Activity [^\n]* State:\s*\n\s*(mResumed=[^\n]+)', client)
    common = bool(record and re.search(r'\bstate=RESUMED\b', record.group(1)) and state
                  and 'mResumed=true' in state.group(1) and 'mStopped=false' in state.group(1)
                  and 'mHasWindowFocus=false' in client)
    if not peer:return common
    return common and 'mIsInMultiWindowMode=true' in client and bool(re.search(
        r'mCurrentFocus=Window\{[^\n]*dev\.construct\.test\.pause/[^\n]*PeerActivity', system))
