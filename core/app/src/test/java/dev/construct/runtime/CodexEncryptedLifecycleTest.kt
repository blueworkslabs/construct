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
class CodexEncryptedLifecycleTest {
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

    @Test fun lostWrappingKeyMustLockInstalledCode() {
        val module = installed()
        val lost = ModuleStore(app, publisher.public.encoded, FakeWrapper(ByteArray(32) { 99 }))
        assertEquals("KEY_UNAVAILABLE", code { lost.keys.key(id, keyId) })
        println("CODEX lost wrapper: runnable=${lost.inventory().modules.size}, beginRun=${code { lost.beginRun(module) }}")
        assertTrue("Key cannot be unwrapped but installed code remains runnable", lost.inventory().modules.isEmpty())
    }

    @Test fun changedPublisherMustNotUsePreviousPublisherKeys() {
        val module = installed()
        val other = KeyPairGenerator.getInstance("RSA").apply { initialize(2048) }.generateKeyPair()
        val changed = ModuleStore(app, other.public.encoded, FakeWrapper())
        assertNull(changed.keys.key(id, keyId))
        println("CODEX changed publisher: runnable=${changed.inventory().modules.size}, beginRun=${code { changed.beginRun(module) }}")
        assertTrue("Wrong publisher's record accepted by run gate", changed.inventory().modules.isEmpty())
    }

    @Test fun missingEnvelopeMustFailTheRunGate() {
        val module = installed()
        assertTrue(File(app.filesDir, "sealed/$digest.cenc").delete())
        println("CODEX missing ciphertext: runnable=${store.inventory().modules.size}, beginRun=${code { store.beginRun(module) }}")
        assertTrue("Missing signed-envelope provenance accepted", store.inventory().modules.isEmpty())
    }

    @Test fun corruptedBindingMustFailTheRunGate() {
        val module = installed()
        val st = state()
        st.getJSONObject(id).getJSONObject("sealed").getJSONObject(digest).put("signature", "invalid").put("version", "9.9.9")
        File(app.filesDir, "module-state.json").writeText(st.toString())
        println("CODEX inconsistent binding: runnable=${store.inventory().modules.size}, beginRun=${code { store.beginRun(module) }}")
        assertTrue("Inconsistent persisted envelope binding accepted", store.inventory().modules.isEmpty())
    }

    @Test fun restartAfterForgetMarkMustRemoveTheWrappedKey() {
        installed()
        // Crash after the durable forget mark, before keys.forget.
        File(app.filesDir, "key-cleanup.json").writeText("[{\"id\":\"$id\",\"keyId\":\"$keyId\"}]")
        store = newStore()
        store.inventory()
        println("CODEX interrupted forget: records=${store.keys.list().size}, journal=${File(app.filesDir, "key-cleanup.json").readText()}, unlock=${code { store.unlock(envelope, entry) }}")
        assertTrue("Forget recovery cleared journal while retaining usable key", store.keys.list().isEmpty())
    }

    private fun nextEnvelope(): Pair<ByteArray, EncryptedCatalogVersion> {
        val original = EncryptedPackages.open(envelope, key())
        val files = original.files.toMutableMap()
        files["manifest.json"] = JSONObject(files.getValue("manifest.json").toString(Charsets.UTF_8)).put("version", "2.0.0").toString().toByteArray()
        val zipBytes = java.io.ByteArrayOutputStream().also { out -> java.util.zip.ZipOutputStream(out).use { zip ->
            files.forEach { (name, bytes) -> zip.putNextEntry(java.util.zip.ZipEntry(name)); zip.write(bytes); zip.closeEntry() }
        } }.toByteArray()
        val salt = ByteArray(32) { 3 }
        val manifestHash = EncryptedPackages.sha256("ConstructManifestV1".toByteArray() + byteArrayOf(0) + salt + files.getValue("manifest.json"))
        val header = JSONObject().put("format", EncryptedPackages.FORMAT).put("id", id).put("version", "2.0.0")
            .put("keyId", "e".repeat(32)).put("zipBytes", zipBytes.size).put("manifestCommitment", manifestHash).toString().toByteArray()
        val aad = "CENC0001".toByteArray() + java.nio.ByteBuffer.allocate(4).putInt(header.size).array() + header
        val cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(javax.crypto.Cipher.ENCRYPT_MODE, javax.crypto.spec.SecretKeySpec(key(), "AES"))
        cipher.updateAAD(aad)
        val bytes = aad + cipher.iv + cipher.doFinal(salt + zipBytes)
        val sig = Base64.getEncoder().encodeToString(Signature.getInstance("SHA256withRSA").run { initSign(publisher.private); update(bytes); sign() })
        return bytes to EncryptedCatalogVersion(id, "2.0.0", "sealed/${id.removePrefix("sealed.")}/2.0.0.cenc", EncryptedPackages.sha256(bytes), sig)
    }

    @Test fun forgettingPreviousGenerationMustNotStopActiveOtherGeneration() {
        installed(); store.confirm(id)
        val (next, version) = nextEnvelope()
        store.addKey(id, "e".repeat(32), key(), "")
        store.install(store.unlock(next, version)); store.confirm(id)
        val stopped = mutableListOf<String>()
        store.onLocked { stopped += it }
        store.forgetKey(id, keyId)
        println("CODEX forget previous generation: stopped=$stopped, active=${store.inventory().modules.single().manifest.version}")
        assertTrue("Active version uses retained key but receives stop event", stopped.isEmpty())
    }

    @Test fun newGenerationMustInstallWhenOldGenerationKeyWasForgotten() {
        installed(); store.confirm(id); store.forgetKey(id, keyId)
        val (next, version) = nextEnvelope()
        store.addKey(id, "e".repeat(32), key(), "")
        val result = code { store.install(store.unlock(next, version)) }
        println("CODEX new generation after forgetting old: install=$result")
        assertEquals("New valid generation blocked by missing old key", "OK", result)
    }
    @Test fun forgetMustRemovePlaintextFromInstallInterruptedBeforeStateCommit() {
        store.addKey(id, keyId, key(), "")
        val candidate = store.unlock(envelope, entry)
        // Exact install boundary: stage(candidate) finished but module-state write did not.
        ModuleStore::class.java.getDeclaredMethod("stage", VerifiedPackage::class.java).apply { isAccessible = true }.invoke(store, candidate)
        assertTrue(store.directory(digest).isDirectory)
        store = newStore()
        store.forgetKey(id, keyId)
        println("CODEX interrupted install then forget: plaintext=${store.directory(digest).exists()}, journal=${File(app.filesDir, "key-cleanup.json").readText()}")
        assertFalse("Forget reports completion but pre-commit plaintext remains", store.directory(digest).exists())
    }

}
