package dev.construct.runtime

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.File
import java.security.KeyPairGenerator
import java.security.Signature
import java.util.Base64
import java.util.zip.ZipInputStream

/**
 * `construct-encrypted-v1` on the host (docs/encrypted-packages.md): the publisher's
 * known-answer vectors (scripts/encrypted-package-vectors.json, shared with
 * scripts/test_encrypt_module.py) decrypt to the same bytes here, every negative vector fails
 * with the category the publisher recorded, and the install path authenticates the
 * publisher before it asks for a key.
 */
class EncryptedPackagesTest {
    private val vectors = JSONObject(File(File(System.getProperty("construct.fixtureRoot")).parentFile.parentFile,
        "scripts/encrypted-package-vectors.json").readText())
    private val inputs = vectors.getJSONObject("inputs")
    private val outputs = vectors.getJSONObject("outputs")
    private fun hex(s: String) = ByteArray(s.length / 2) { s.substring(2 * it, 2 * it + 2).toInt(16).toByte() }
    private val envelope = hex(outputs.getString("envelope"))
    private val key = hex(inputs.getString("key"))
    private val publisher = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()

    private fun code(task: () -> Unit): String = try { task(); "OK" } catch (e: ConstructError) { e.code }
    private fun sign(bytes: ByteArray, keys: java.security.KeyPair = publisher) =
        Base64.getEncoder().encodeToString(Signature.getInstance("SHA256withRSA").run { initSign(keys.private); update(bytes); sign() })
    private fun entry(bytes: ByteArray, version: String = inputs.getString("version"), signature: String = sign(bytes)) =
        EncryptedCatalogVersion(inputs.getString("id"), version, "sealed/${inputs.getString("id").removePrefix("sealed.")}/$version.cenc",
            EncryptedPackages.sha256(bytes), signature)

    @Test fun knownAnswerVectorDecryptsToThePublishersZip() {
        assertEquals(outputs.getString("envelopeSha256"), EncryptedPackages.sha256(envelope))
        val (header, _) = EncryptedPackages.parse(envelope)
        val stored = JSONObject(outputs.getString("header"))
        assertEquals(stored.getString("id"), header.id)
        assertEquals(stored.getString("keyId"), header.keyId)
        assertEquals(stored.getInt("zipBytes"), header.zipBytes)
        assertEquals(outputs.getString("commitment"), header.manifestCommitment)
        val opened = EncryptedPackages.open(envelope, key)
        assertEquals(inputs.getString("id"), opened.manifest.id)
        assertEquals(inputs.getString("version"), opened.manifest.version)
        assertEquals(outputs.getString("envelopeSha256"), opened.digest)
        val zip = linkedMapOf<String, ByteArray>()
        ZipInputStream(ByteArrayInputStream(hex(inputs.getString("zip")))).use { z ->
            while (true) { val e = z.nextEntry ?: break; zip[e.name] = z.readBytes() }
        }
        assertEquals(zip.keys, opened.files.keys)
        for ((name, bytes) in zip) assertArrayEquals(name, bytes, opened.files[name])
        assertArrayEquals(hex(inputs.getString("manifest")), opened.files["manifest.json"])
    }

    @Test fun everyNegativeVectorFailsWithItsRecordedCategory() {
        val negative = vectors.getJSONArray("negative")
        assertEquals(22, negative.length())
        for (i in 0 until negative.length()) {
            val v = negative.getJSONObject(i)
            assertEquals(v.getString("name"), v.getString("expect"), code { EncryptedPackages.open(hex(v.getString("envelope")), hex(v.getString("key"))) })
        }
    }

    @Test fun signedPackageInstallsOnlyWithTheExactKey() {
        val asked = mutableListOf<EnvelopeHeader>()
        val ok = EncryptedPackages.verify(envelope, entry(envelope), publisher.public.encoded) { asked += it; key.copyOf() }
        assertEquals(inputs.getString("id"), ok.manifest.id)
        assertEquals(listOf(inputs.getString("keyId")), asked.map { it.keyId })
        assertEquals("PACKAGE_LOCKED", code { EncryptedPackages.verify(envelope, entry(envelope), publisher.public.encoded) { null } })
        assertEquals("PACKAGE_WRONG_KEY", code { EncryptedPackages.verify(envelope, entry(envelope), publisher.public.encoded) { ByteArray(32) { 7 } } })
    }

    @Test fun publisherIsAuthenticatedBeforeAnyKeyIsRequested() {
        var asked = 0
        val keyFor: (EnvelopeHeader) -> ByteArray? = { asked++; key.copyOf() }
        // Wrong publisher, a correct content key held by the attacker: no key prompt, signature failure.
        val other = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        assertEquals("SIGNATURE_FAILED", code { EncryptedPackages.verify(envelope, entry(envelope, signature = sign(envelope, other)), publisher.public.encoded, keyFor) })
        // An attacker re-encrypting changed bytes with the right content key cannot reuse the signature.
        val changed = envelope.copyOf().also { it[it.size - 1] = (it[it.size - 1].toInt() xor 1).toByte() }
        assertEquals("SIGNATURE_FAILED", code { EncryptedPackages.verify(changed, entry(changed, signature = sign(envelope)), publisher.public.encoded, keyFor) })
        // Download changed after the catalog was written.
        assertEquals("CHECKSUM_FAILED", code { EncryptedPackages.verify(changed, entry(envelope), publisher.public.encoded, keyFor) })
        // Signed, but the catalog points it at another version: the binding fails before a key is asked for.
        assertEquals("PACKAGE_INVALID", code { EncryptedPackages.verify(envelope, entry(envelope, version = "9.9.9"), publisher.public.encoded, keyFor) })
        assertEquals(0, asked)
    }

    @Test fun signedButMalformedEnvelopeIsInvalidNotAKeyPrompt() {
        var asked = 0
        val negative = vectors.getJSONArray("negative")
        for (i in 0 until negative.length()) {
            val v = negative.getJSONObject(i)
            if (v.getString("expect") != "PACKAGE_INVALID" || v.getString("name") in setOf("commitment mismatch", "inner ID differs from outer",
                    "ZIP with a trailing byte", "ZIP with a prepended byte", "nested envelope")) continue
            val bytes = hex(v.getString("envelope"))
            assertEquals(v.getString("name"), "PACKAGE_INVALID", code { EncryptedPackages.verify(bytes, entry(bytes), publisher.public.encoded) { asked++; key.copyOf() } })
        }
        assertEquals(0, asked)
    }

    private fun catalog(encrypted: JSONArray, modules: JSONArray = JSONArray()) =
        JSONObject().put("schemaVersion", 1).put("modules", modules).put("encryptedModules", encrypted).toString().toByteArray()
    private val id = "sealed.a0123456789abcdef0123456789abcdef"
    private fun sealedEntry(name: String = "Locked module", format: String = "construct-encrypted-v1", artifact: String = "sealed/a0123456789abcdef0123456789abcdef/1.0.0.cenc") =
        JSONObject().put("id", id).put("name", name).put("latest", "1.0.0").put("versions", JSONArray().put(JSONObject()
            .put("version", "1.0.0").put("format", format).put("artifact", artifact).put("sha256", "a".repeat(64)).put("signature", "c2ln")))
    private val ordinary = JSONArray().put(JSONObject().put("id", "dev.construct.hello").put("name", "Hello").put("versions", JSONArray().put(JSONObject()
        .put("version", "0.1.0").put("artifact", "hello.zip").put("sha256", "b".repeat(64)).put("signature", "c2ln"))))

    @Test fun catalogKeepsOrdinaryEntriesAndDropsMalformedEncryptedOnes() {
        val good = Packages.encryptedCatalog(catalog(JSONArray().put(sealedEntry()), ordinary))
        assertEquals(listOf("1.0.0"), good.versions.map { it.version })
        assertEquals(0, good.rejected)
        // The legacy reader sees only `modules`, so an older host is unaffected by the new array.
        assertEquals(listOf("dev.construct.hello"), Packages.catalog(catalog(JSONArray().put(sealedEntry()), ordinary)).map { it.id })
        for (bad in listOf(sealedEntry(name = "Example Tool"), sealedEntry(format = "construct-encrypted-v2"),
                sealedEntry(artifact = "sealed/a0123456789abcdef0123456789abcdef/1.0.0.zip"), sealedEntry(artifact = "elsewhere/1.0.0.cenc"),
                sealedEntry().put("description", "An example description"))) {
            val parsed = Packages.encryptedCatalog(catalog(JSONArray().put(bad), ordinary))
            assertEquals(bad.toString(), 0, parsed.versions.size)
            assertEquals(1, parsed.rejected)
            assertEquals(listOf("dev.construct.hello"), Packages.catalog(catalog(JSONArray().put(bad), ordinary)).map { it.id })
        }
        val clash = JSONArray().put(sealedEntry())
        val sameId = JSONArray().put(JSONObject(ordinary.getJSONObject(0).toString()).put("id", id))
        assertEquals("CATALOG_SCHEMA", code { Packages.encryptedCatalog(catalog(clash, sameId)) })
        assertEquals("CATALOG_SCHEMA", code { Packages.encryptedCatalog(catalog(JSONArray().put(sealedEntry()).put(sealedEntry()))) })
    }
    @Test fun theModuleLimitCountsEveryObjectNotDistinctOrdinaryIds() {
        // One ordinary ID repeated across objects with distinct versions, which Packages.catalog accepts.
        fun repeated(n: Int) = JSONArray().apply { repeat(n) { i -> put(JSONObject(ordinary.getJSONObject(0).toString())
            .put("versions", JSONArray().put(JSONObject(ordinary.getJSONObject(0).getJSONArray("versions").getJSONObject(0).toString()).put("version", "0.1.$i")))) } }
        assertEquals(100, Packages.catalog(catalog(JSONArray(), repeated(100))).size)
        assertEquals("CATALOG_SIZE", code { Packages.encryptedCatalog(catalog(JSONArray().put(sealedEntry()), repeated(100))) })
        // Control: one object fewer fits the combined bound and parses.
        assertEquals(1, Packages.encryptedCatalog(catalog(JSONArray().put(sealedEntry()), repeated(99))).versions.size)
    }
}
