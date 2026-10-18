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
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Encrypted modules in the store (docs/encrypted-packages.md, "Plaintext, forgetting keys,
 * updates and rollback"), with the publisher's known-answer envelope signed by a test publisher:
 * install needs the exact stored key, forgetting it locks the module and removes its unlocked
 * code but keeps the envelope, grants and saved data, and a re-import verifies the envelope again.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class CodexRejectedImportBoundaryTest {
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

    private fun sign(bytes: ByteArray) =
        Base64.getEncoder().encodeToString(Signature.getInstance("SHA256withRSA").run { initSign(publisher.private); update(bytes); sign() })

    /** Another version of the vector module, sealed here under [key]/[keyId] the way the publisher tool does. */
    private fun seal(version: String, key: ByteArray, keyId: String): Pair<ByteArray, EncryptedCatalogVersion> {
        val files = EncryptedPackages.open(envelope, key()).files.toMutableMap()
        files["manifest.json"] = String(files.getValue("manifest.json")).replace("\"version\": \"1.0.0\"", "\"version\": \"$version\"").toByteArray()
        val zip = java.io.ByteArrayOutputStream().also { out -> ZipOutputStream(out).use { z ->
            for ((name, bytes) in files) { z.putNextEntry(ZipEntry(name)); z.write(bytes); z.closeEntry() } } }.toByteArray()
        val salt = ByteArray(32) { (it + 1).toByte() }
        val commitment = EncryptedPackages.sha256("ConstructManifestV1".toByteArray() + byteArrayOf(0) + salt + files.getValue("manifest.json"))
        val header = """{"format":"construct-encrypted-v1","id":"$id","version":"$version","keyId":"$keyId","zipBytes":${zip.size},"manifestCommitment":"$commitment"}""".toByteArray()
        val prefix = "CENC0001".toByteArray() + java.nio.ByteBuffer.allocate(4).putInt(header.size).array() + header
        val nonce = ByteArray(12) { (it + 9).toByte() }
        val sealed = Cipher.getInstance("AES/GCM/NoPadding").run {
            init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce)); updateAAD(prefix); doFinal(salt + zip) }
        val bytes = prefix + nonce + sealed
        return bytes to EncryptedCatalogVersion(id, version, "sealed/${id.removePrefix("sealed.")}/$version.cenc", EncryptedPackages.sha256(bytes), sign(bytes))
    }

    private fun installed(): Installed {
        store.addKey(id, keyId, key(), "")
        store.install(store.unlock(envelope, entry))
        return store.inventory().modules.single()
    }

    @Test fun unreadableStateAfterKeyWriteDoesNotKeepRejectedKey() {
        installed()
        store.forgetKey(id, keyId)
        val stateFile = File(app.filesDir, "module-state.json")
        val original = stateFile.readText()
        stateFile.writeText("{")
        val failure = runCatching { store.addKey(id, keyId, key(), "") }.exceptionOrNull()
        val kept = store.keys.list().size
        stateFile.writeText(original)
        val retry = code { store.addKey(id, keyId, key(), "") }
        println("unreadable-state: failure=${failure?.javaClass?.simpleName}, keys=$kept, correctedRetry=$retry")
        assertNotNull(failure)
        assertEquals("Rejected import retained a key", 0, kept)
        assertEquals("OK", retry)
    }

    @Test fun blockedJournalAndDeletionRemainRecoverableAfterRestart() {
        installed()
        // Represent key loss with retained code: the re-import path explicitly supports this.
        store.keys.forget(id, keyId)
        val kept = File(app.filesDir, "sealed/$digest.cenc")
        kept.writeBytes(envelope.copyOf().also { it[it.size - 1] = (it.last() + 1).toByte() })
        val journal = File(app.filesDir, "key-cleanup.json")
        journal.writeText("[]")
        val codeDir = store.directory(digest)
        val dirs = codeDir.walkTopDown().filter { it.isDirectory }.toList()
        try {
            dirs.forEach { assertTrue(it.setWritable(false)) }
            assertTrue(journal.setWritable(false))
            assertTrue(app.filesDir.setWritable(false))
            assertEquals("CHECKSUM_FAILED", code { store.addKey(id, keyId, key(), "") })
            assertTrue(store.keys.list().isEmpty())
            assertTrue("fault must actually block deletion", codeDir.exists())
        } finally {
            app.filesDir.setWritable(true); journal.setWritable(true)
            dirs.forEach { it.setWritable(true) }
        }
        val reopened = newStore()
        val inventory = reopened.inventory()
        println("cleanup-restart: journal=${journal.readText()}, plaintext=${codeDir.exists()}, locked=${inventory.locked.size}")
        assertFalse("No cleanup intent survives; referenced plaintext stays forever", codeDir.exists())
    }
}
