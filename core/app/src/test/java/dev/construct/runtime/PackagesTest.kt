package dev.construct.runtime

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.security.KeyPairGenerator
import java.security.MessageDigest
import java.security.Signature
import java.util.Base64
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class PackagesTest {
    @Test fun windowThemeIsValidatedAndRequiresNewHostContract() {
        val m = manifest().put("themeColor", "#12AbEF")
        rejects("API_INCOMPATIBLE") { Packages.manifest(m.toString().toByteArray()) }
        m.put("constructApi", JSONObject().put("min", "0.6.0").put("target", "0.6.0"))
        assertEquals("#12AbEF", Packages.manifest(m.toString().toByteArray()).themeColor)
        for (bad in listOf("red", "#123", "#12345678", "#000000;", "url(file://x)", "#gggggg")) {
            m.put("themeColor", bad)
            rejects("MANIFEST_SCHEMA") { Packages.manifest(m.toString().toByteArray()) }
        }
    }
    @Test fun shellContractIsExplicitAndOlderModulesKeepLegacyLayout() {
        assertEquals("0.1.0", Packages.manifest(manifest().toString().toByteArray()).api)
        val current = manifest().put("constructApi", JSONObject().put("min", "0.5.0").put("target", "0.5.0"))
        assertEquals("0.5.0", Packages.manifest(current.toString().toByteArray()).api)
        current.getJSONObject("constructApi").put("target", "0.6.0")
        rejects("API_INCOMPATIBLE") { Packages.manifest(current.toString().toByteArray()) }
    }

    private val keys = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
    private fun manifest() = JSONObject("""{"schemaVersion":1,"id":"dev.construct.hello","name":"Hello","version":"0.1.0","constructApi":{"min":"0.1.0","target":"0.1.0"},"runtime":{"kind":"webview-js"},"entry":"ui/index.html","capabilities":[{"id":"device.toast","reason":"Say hello"}]}""")
    private fun zip(m: JSONObject = manifest(), extra: Map<String, ByteArray> = emptyMap()): ByteArray {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { z ->
            for ((name, bytes) in mapOf("manifest.json" to m.toString().toByteArray(), "ui/index.html" to "Hello".toByteArray()) + extra) {
                z.putNextEntry(ZipEntry(name)); z.write(bytes); z.closeEntry()
            }
        }
        return out.toByteArray()
    }
    private fun metadata(blob: ByteArray): CatalogVersion {
        val signer = Signature.getInstance("SHA256withRSA")
        signer.initSign(keys.private); signer.update(blob)
        return CatalogVersion("dev.construct.hello", "Untrusted display name", "0.1.0", "hello.zip",
            MessageDigest.getInstance("SHA-256").digest(blob).joinToString("") { "%02x".format(it) },
            Base64.getEncoder().encodeToString(signer.sign()))
    }
    private fun verify(blob: ByteArray) = Packages.verify(blob, metadata(blob), keys.public.encoded)
    private fun rejects(code: String, task: () -> Unit) {
        try { task(); fail("Expected $code") } catch (e: ConstructError) { assertEquals(code, e.code) }
    }
    @Test fun signedPackageUsesVerifiedManifestNotCatalogName() {
        assertEquals("Hello", verify(zip()).manifest.name)
    }
    @Test fun alteredDownloadRejectedBeforeExtraction() {
        val blob = zip(); val expected = metadata(blob); blob[30] = (blob[30].toInt() xor 1).toByte()
        rejects("CHECKSUM_FAILED") { Packages.verify(blob, expected, keys.public.encoded) }
    }
    @Test fun attackerChangingChecksumCannotForgeSignature() {
        val blob = zip(); val expected = metadata(blob)
        val changed = zip(extra = mapOf("evil.js" to "alert(1)".toByteArray()))
        rejects("SIGNATURE_FAILED") { Packages.verify(changed, metadata(changed).copy(signature = expected.signature), keys.public.encoded) }
    }
    @Test fun differentPublisherRejected() {
        val blob = zip()
        val other = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        rejects("SIGNATURE_FAILED") { Packages.verify(blob, metadata(blob), other.public.encoded) }
    }
    @Test fun signedWrongIdentityRejected() {
        val blob = zip(manifest().put("id", "dev.construct.other"))
        rejects("IDENTITY_MISMATCH") { verify(blob) }
    }
    @Test fun signedWrongVersionRejected() {
        rejects("IDENTITY_MISMATCH") { verify(zip(manifest().put("version", "0.2.0"))) }
    }
    @Test fun traversalRejectedEvenWhenSigned() {
        for (path in listOf("../escape.js", "/absolute.js", "ui/../../escape.js", "ui\\escape.js", "ui//escape.js", "./foo.js")) {
            rejects("ZIP_PATH") { verify(zip(extra = mapOf(path to byteArrayOf(1)))) }
        }
    }
    @Test fun executableNativePayloadRejected() {
        rejects("ZIP_PATH") { verify(zip(extra = mapOf("code.dex" to byteArrayOf(1)))) }
    }
    @Test fun zipBombBoundedByExpandedEntry() {
        rejects("SIZE_LIMIT") { verify(zip(extra = mapOf("bomb.txt" to ByteArray(Packages.MAX_FILE + 1)))) }
    }
    @Test fun expandedTotalBounded() {
        rejects("ZIP_EXPANDED_SIZE") { verify(zip(extra = (1..7).associate { "$it.txt" to ByteArray(Packages.MAX_FILE) })) }
    }
    @Test fun excessiveEntriesRejected() {
        rejects("ZIP_ENTRIES") { verify(zip(extra = (1..127).associate { "$it.txt" to byteArrayOf(0) })) }
    }
    @Test fun missingEntryRejected() {
        rejects("ENTRY_MISSING") { verify(zip(manifest().put("entry", "ui/missing.html"))) }
    }
    @Test fun unknownCapabilityRejected() {
        val m = manifest(); m.getJSONArray("capabilities").getJSONObject(0).put("id", "network.fetch")
        rejects("CAPABILITY_DENIED") { verify(zip(m)) }
    }
    @Test fun futureApiRejected() {
        val m = manifest(); m.getJSONObject("constructApi").put("min", "0.2.0")
        rejects("API_INCOMPATIBLE") { verify(zip(m)) }
    }
    @Test fun nativeRuntimeRejected() {
        val m = manifest(); m.getJSONObject("runtime").put("kind", "trusted-native")
        rejects("RUNTIME_UNSUPPORTED") { verify(zip(m)) }
    }
    @Test fun schemaRejectsWrongTypesAndExtraFields() {
        rejects("MANIFEST_SCHEMA") { verify(zip(manifest().put("unexpected", true))) }
        rejects("MANIFEST_SCHEMA") { verify(zip(manifest().put("name", 17))) }
    }
    @Test fun duplicateCapabilitiesRejected() {
        val m = manifest(); val caps = m.getJSONArray("capabilities"); caps.put(caps.getJSONObject(0))
        rejects("MANIFEST_SCHEMA") { verify(zip(m)) }
    }
    @Test fun catalogCannotEscapeArtifactOriginOrDirectory() {
        val v = metadata(zip())
        for (path in listOf("../evil.zip", "https://evil.example/a.zip", "//evil.example/a.zip", "a.zip?token=x")) {
            val json = JSONObject().put("schemaVersion", 1).put("modules", org.json.JSONArray().put(JSONObject()
                .put("id", v.id).put("versions", org.json.JSONArray().put(JSONObject()
                    .put("version", v.version).put("artifact", path).put("sha256", v.sha256).put("signature", v.signature)))))
            rejects("CATALOG_SCHEMA") { Packages.catalog(json.toString().toByteArray()) }
        }
    }
}
