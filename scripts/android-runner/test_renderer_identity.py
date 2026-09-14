import unittest
from renderer_identity import selected_provider, renderer_candidates


class RendererIdentityTest(unittest.TestCase):
    def test_selected_provider_not_other_listed_providers(self):
        report = 'Current WebView package (name, version): (com.android.webview, 155.0.8058.0)\nValid package com.google.android.webview (133)'
        self.assertEqual('com.android.webview', selected_provider(report))
        for bad in ('', report + '\n' + report, 'Current WebView package (name, version): (null, 0)'):
            with self.assertRaises(RuntimeError): selected_provider(bad)

    def test_only_selected_provider_is_considered(self):
        processes = 'PID UID ARGS\n1 u0_a1 dev.construct.runtime\n2 u0_i1 com.android.webview:sandboxed_process0:SandboxedProcessService0\n3 u0_i2 com.google.android.webview:sandboxed_process0:SandboxedProcessService0\n4 u0_i3 other.com.android.webview:sandboxed_process0:SandboxedProcessService0\n'
        self.assertEqual({'2'}, set(renderer_candidates(processes, 'com.android.webview')))
        self.assertEqual({'3'}, set(renderer_candidates(processes, 'com.google.android.webview')))

    def test_nonisolated_or_malformed_identities_refused(self):
        for pid, uid in [('abc', 'u0_i1'), ('0', 'u0_i1'), ('2', 'u0_a1'), ('2', '1000'), ('2', 'u0_invalid')]:
            with self.assertRaises(RuntimeError):
                renderer_candidates(f'PID UID ARGS\n{pid} {uid} com.android.webview:sandboxed_process0:SandboxedProcessService0', 'com.android.webview')

    def test_numeric_isolated_uid_supported(self):
        self.assertEqual({'9'}, set(renderer_candidates('PID UID ARGS\n9 99001 com.android.webview:sandboxed_process0:SandboxedProcessService0', 'com.android.webview')))
