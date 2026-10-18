package dev.construct.runtime

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File
import java.security.KeyPairGenerator
import java.security.Signature
import java.util.Base64

/**
 * Encrypted modules in the store (docs/encrypted-packages.md, "Plaintext, forgetting keys,
 * updates and rollback"), with the publisher's known-answer envelope signed by a test publisher:
 * install needs the exact stored key, forgetting it locks the module and removes its unlocked
 * code but keeps the envelope, grants and saved data, and a re-import verifies the envelope again.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class CodexEncryptedRepairBoundaryTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private val vectors = JSONObject(File(File(System.getProperty("construct.fixtureRoot")).parentFile.parentFile,
        "scripts/encrypted-package-vectors.json").readText())
    private val inputs = vectors.getJSONObject("inputs")
    private fun hex(s: String) = ByteArray(s.length / 2) { s.substring(2 * it, 2 * it + 2).toInt(16).toByte() }
    private val envelope = hex(vectors.getJSONObject("outputs").getString("envelope"))
    private val id = inputs.getString("id")
    private val keyId = inputs.getString("keyId")
    private fun key() = hex(inputs.getString("key"))
    private val publisher = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
    private val entry = EncryptedCatalogVersion(id, inputs.getString("version"), "sealed/${id.removePrefix("sealed.")}/${inputs.getString("version")}.cenc",
        EncryptedPackages.sha256(envelope),
        Base64.getEncoder().encodeToString(Signature.getInstance("SHA256withRSA").run { initSign(publisher.private); update(envelope); sign() }))
    private val digest = EncryptedPackages.sha256(envelope)
    private lateinit var store: ModuleStore
    private fun newStore() = ModuleStore(app, publisher.public.encoded, FakeWrapper())
    private fun code(task: () -> Unit): String = try { task(); "OK" } catch (e: ConstructError) { e.code }
    private fun state() = JSONObject(File(app.filesDir, "module-state.json").readText())

    @Before fun setup() {
        app.filesDir.listFiles()?.forEach { it.deleteRecursively() }
        app.noBackupFilesDir.listFiles()?.forEach { it.deleteRecursively() }
        store = newStore()
    }

    private fun installed(): Installed {
        store.addKey(id, keyId, key(), "")
        store.install(store.unlock(envelope, entry))
        return store.inventory().modules.single()
    }

    private fun nextEnvelope(version: String = "2.0.0", nextKeyId: String = "e".repeat(32)): Pair<ByteArray, EncryptedCatalogVersion> {
        val original = EncryptedPackages.open(envelope, key())
        val files = original.files.toMutableMap()
        files["manifest.json"] = JSONObject(files.getValue("manifest.json").toString(Charsets.UTF_8)).put("version", version).toString().toByteArray()
        val zipBytes = java.io.ByteArrayOutputStream().also { out -> java.util.zip.ZipOutputStream(out).use { zip ->
            files.forEach { (name, bytes) -> zip.putNextEntry(java.util.zip.ZipEntry(name)); zip.write(bytes); zip.closeEntry() }
        } }.toByteArray()
        val salt = ByteArray(32) { 3 }
        val manifestHash = EncryptedPackages.sha256("ConstructManifestV1".toByteArray() + byteArrayOf(0) + salt + files.getValue("manifest.json"))
        val header = JSONObject().put("format", EncryptedPackages.FORMAT).put("id", id).put("version", version)
            .put("keyId", nextKeyId).put("zipBytes", zipBytes.size).put("manifestCommitment", manifestHash).toString().toByteArray()
        val aad = "CENC0001".toByteArray() + java.nio.ByteBuffer.allocate(4).putInt(header.size).array() + header
        val cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(javax.crypto.Cipher.ENCRYPT_MODE, javax.crypto.spec.SecretKeySpec(key(), "AES"))
        cipher.updateAAD(aad)
        val bytes = aad + cipher.iv + cipher.doFinal(salt + zipBytes)
        val sig = Base64.getEncoder().encodeToString(Signature.getInstance("SHA256withRSA").run { initSign(publisher.private); update(bytes); sign() })
        return bytes to EncryptedCatalogVersion(id, version, "sealed/${id.removePrefix("sealed.")}/$version.cenc", EncryptedPackages.sha256(bytes), sig)
    }


    @Test fun wrongKeyAfterKeystoreLossMustNotRestoreRunnableCode() {
        val module = installed()
        val reset = ModuleStore(app, publisher.public.encoded, FakeWrapper(ByteArray(32) { 99 }))
        assertEquals("KEY_UNAVAILABLE", code { reset.beginRun(module) })
        val imported = code { reset.addKey(id, keyId, ByteArray(32) { 77 }, "") }
        val opened = code { reset.beginRun(module) }
        val actualDecrypt = code { reset.unlock(envelope, entry) }
        println("CODEX wrong replacement: import=$imported, beginRun=$opened, actualDecrypt=$actualDecrypt")
        assertNotEquals("Invalid replacement key must not decrypt", "OK", actualDecrypt)
        assertEquals("Wrong content key accepted as re-import over retained plaintext", "PACKAGE_WRONG_KEY", imported)
        assertTrue("Wrong key left code runnable", reset.inventory().modules.isEmpty())
    }

    @Test fun existingPlaintextMustNotSkipReimportEnvelopeValidation() {
        installed()
        val reset = ModuleStore(app, publisher.public.encoded, FakeWrapper(ByteArray(32) { 99 }))
        assertEquals("KEY_UNAVAILABLE", reset.inventory().locked.single().code)
        File(app.filesDir, "sealed/$digest.cenc").delete()
        val imported = code { reset.addKey(id, keyId, key(), "") }
        println("CODEX missing envelope reimport: import=$imported, keys=${reset.keys.list().size}")
        assertNotEquals("Re-import claimed success without retained envelope", "OK", imported)
    }

    @Test fun lockedUnconfirmedTrialMustNotDiscardLastWorkingRollback() {
        installed(); store.confirm(id)
        val (secondBytes, secondVersion) = nextEnvelope()
        store.addKey(id, "e".repeat(32), key(), "")
        store.install(store.unlock(secondBytes, secondVersion))
        store.forgetKey(id, "e".repeat(32))
        assertEquals("1.0.0", store.inventory().locked.single().previousVersion)
        val (thirdBytes, thirdVersion) = nextEnvelope("3.0.0", "f".repeat(32))
        store.addKey(id, "f".repeat(32), key(), "")
        val installedThird = code { store.install(store.unlock(thirdBytes, thirdVersion)) }
        val workingCode = store.directory(digest).exists()
        val rollback = code { store.rollback(id) }
        println("CODEX locked trial update: install=$installedThird, workingCode=$workingCode, rollback=$rollback")
        // Either refusing another pending trial or safely retaining the working rollback is valid.
        assertTrue("Updating a locked trial deleted the last confirmed code", workingCode)
        assertEquals("Last confirmed version is not reachable by rollback", "OK", rollback)
        assertEquals("1.0.0", store.inventory().modules.single().manifest.version)
    }
}
