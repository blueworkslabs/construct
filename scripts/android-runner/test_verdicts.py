import unittest
from verdicts import verdict, VERSION, counts

def event(code, message='', source='host', version=VERSION):
    return dict(moduleId='dev.construct.probe', moduleVersion=version, code=code, message=message, source=source)

def run(name, events, observed=None, foreground=True):
    return verdict(name, observed or [], [event('MODULE_INFO', 'PENDING: PROBE: '+name, 'module')]+events, foreground, True)[0]

class VerdictTests(unittest.TestCase):
    def test_timeout_cannot_be_capability_pass(self):
        self.assertEqual('FAIL', run('Undeclared toast', [], ['FAIL: Host did not respond']))
        self.assertEqual('BLOCKED', run('Undeclared toast', [event('MODULE_INFO','BLOCKED: CAPABILITY_DENIED','module')]))
    def test_popup_object_needs_native_block(self):
        self.assertEqual('FAIL', run('Popup', [], ['PENDING: popup object returned']))
        self.assertEqual('BLOCKED', run('Popup', [event('POPUP_BLOCKED')]))
        self.assertEqual('FAIL', run('Popup', [event('POPUP_BLOCKED')], foreground=False))
    def test_old_version_and_module_spoofed_host_code_cannot_pass(self):
        self.assertEqual('FAIL', run('Popup', [event('POPUP_BLOCKED', version='0.1.1')]))
        self.assertEqual('FAIL', run('Popup', [event('POPUP_BLOCKED', source='module')]))
    def test_wrong_or_missing_invocation_fails(self):
        self.assertEqual('FAIL', verdict('Fetch', [], [event('JAVASCRIPT_ERROR')], True, True)[0])
    def test_contained_is_not_blocked_and_does_not_override_failure(self):
        self.assertEqual('CONTAINED', run('Fetch', [event('JAVASCRIPT_ERROR')]))
        self.assertEqual('BLOCKED', run('Fetch', [event('REQUEST_BLOCKED', 'Blocked category=external-origin; URL/payload omitted')]))
        self.assertEqual('FAIL', run('Fetch', [event('JAVASCRIPT_ERROR')], ['FAIL: fetch succeeded']))
    def test_flood_requires_eight_or_nine_records(self):
        for n in (0,1,7,10,40):
            self.assertEqual('FAIL', run('Bounded bridge flood (40)', [event('MODULE_INFO','Bounded probe flood','module')]*n))
        for n in (8,9):
            self.assertEqual('BLOCKED', run('Bounded bridge flood (40)', [event('MODULE_INFO','Bounded probe flood','module')]*n))
    def test_absent_evidence_is_not_described_as_containment(self):
        result, reason=verdict('Fetch', [], [event('MODULE_INFO','PENDING: PROBE: Fetch','module')], True, True)
        self.assertEqual('FAIL', result)
        self.assertIn('No host stop or block', reason)
    def test_resource_requires_native_code_not_only_stop(self):
        self.assertEqual('FAIL', run('Native resource denial', [event('JAVASCRIPT_ERROR')]))
        self.assertEqual('BLOCKED', run('Native resource denial', [event('REQUEST_BLOCKED', 'Blocked category=path; URL/payload omitted')]))
    def test_pre_invocation_resource_block_is_not_button_evidence(self):
        events=[event('REQUEST_BLOCKED'),event('MODULE_INFO','PENDING: PROBE: Native resource denial','module')]
        self.assertEqual('FAIL',verdict('Native resource denial',[],events,True,True)[0])
    def test_unrelated_missing_resource_cannot_upgrade_network_containment(self):
        events=[event('REQUEST_BLOCKED','Blocked category=missing-resource; URL/payload omitted'),event('JAVASCRIPT_ERROR')]
        self.assertEqual('CONTAINED',run('Fetch',events))
        self.assertEqual('FAIL',run('Native resource denial',events))
    def test_summary_preserves_classes(self):
        self.assertEqual({'BLOCKED':4,'CONTAINED':6,'FAIL':0},counts([{'verdict':'BLOCKED'}]*4+[{'verdict':'CONTAINED'}]*6))

if __name__=='__main__': unittest.main()
