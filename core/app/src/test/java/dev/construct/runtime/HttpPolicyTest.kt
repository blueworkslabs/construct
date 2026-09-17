package dev.construct.runtime

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.net.InetAddress

class HttpPolicyTest {
    private fun rejected(code: String, action: () -> Unit) {
        try { action(); fail("Expected $code") } catch (e: ConstructError) { assertEquals(code, e.code) }
    }
    private fun manifest(origins: List<String>) = JSONObject("""{"schemaVersion":1,"id":"dev.construct.transport-probe","name":"Transport probe","version":"0.1.0","constructApi":{"min":"0.9.0","target":"0.9.0"},"runtime":{"kind":"webview-js"},"entry":"ui/index.html","capabilities":[]}""")
        .put("capabilities", JSONArray().put(JSONObject().put("id", "net.http").put("reason", "Test public data").put("origins", JSONArray(origins))))
    @Test fun signedSourcesRequireExactPublicHttpsOriginsAndNewApi() {
        for (bad in listOf("http://example.org", "https://EXAMPLE.org", "https://*.example.org", "https://example.org/", "https://example.org:443", "https://user@example.org", "https://127.0.0.1", "https://[::1]", "https://a.local", "https://a.internal", "https://a.test", "https://example.org?x"))
            rejected("MANIFEST_SCHEMA") { HttpPolicy.origin(bad) }
        val good = manifest(listOf("https://example.org")); val m = Packages.manifest(good.toString().toByteArray())
        assertTrue(m.capabilities.single().explicitOptIn)
        assertFalse(HttpPolicy.approved(m, emptySet())); assertTrue(HttpPolicy.approved(m, setOf("https://example.org")))
        good.put("constructApi", JSONObject().put("min", "0.8.0").put("target", "0.8.0"))
        rejected("API_INCOMPATIBLE") { Packages.manifest(good.toString().toByteArray()) }
        for (bad in listOf(emptyList(), List(9) { "https://s$it.example.org" }, listOf("https://example.org", "https://example.org")))
            rejected("MANIFEST_SCHEMA") { Packages.manifest(manifest(bad).toString().toByteArray()) }
    }
    @Test fun requestsCannotEscapeApprovedOrigin() {
        val origins = listOf("https://example.org")
        assertEquals("https://example.org/data?q=a%20b", HttpPolicy.url("https://example.org/data?q=a%20b", origins))
        for (bad in listOf("http://example.org/x", "https://sub.example.org/x", "https://example.org.evil.org/x", "https://user@example.org/x", "https://example.org:443/x", "https://example.org/x#fragment", "https://127.0.0.1/x", "https://example.org\\@evil.org/x")) {
            try { HttpPolicy.url(bad, origins); fail(bad) } catch (_: ConstructError) { }
        }
    }
    @Test fun dnsConnectPolicyRejectsNonPublicAddressesIncludingMappedIpv4() {
        for (bad in listOf("0.0.0.0", "10.1.2.3", "127.0.0.1", "169.254.169.254", "172.31.1.1", "192.168.1.1", "100.64.0.1", "198.18.0.1", "192.0.2.1", "203.0.113.1", "224.0.0.1", "255.255.255.255", "::", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "2001:db8::1", "2002:c0a8:101::1"))
            assertFalse(bad, HttpPolicy.publicAddress(InetAddress.getByName(bad)))
        for (good in listOf("1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"))
            assertTrue(good, HttpPolicy.publicAddress(InetAddress.getByName(good)))
    }
    @Test fun imageMimeCannotSmuggleSvgOrHtmlIntoDataUrl() {
        for (mime in listOf("image/png", "image/jpeg", "image/webp", "image/svg+xml"))
            assertFalse(HttpPolicy.raster("<svg onload='x'>".toByteArray(), mime))
        assertTrue(HttpPolicy.raster(byteArrayOf(137.toByte(),80,78,71,13,10,26,10), "image/png"))
        assertTrue(HttpPolicy.raster(byteArrayOf(255.toByte(),216.toByte(),255.toByte()), "image/jpeg"))
        assertTrue(HttpPolicy.raster("RIFF1234WEBP".toByteArray(), "image/webp"))
    }
}
