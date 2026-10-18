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
class EncryptedInstallTest {
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

    @Test fun installNeedsTheExactStoredKey() {
        assertEquals("PACKAGE_LOCKED", code { store.unlock(envelope, entry) })
        store.addKey(id, "f".repeat(32), key(), "")
        assertEquals("PACKAGE_LOCKED", code { store.unlock(envelope, entry) })
        val module = installed()
        assertEquals(id, module.manifest.id)
        assertEquals(digest, module.digest)
        assertTrue(File(app.filesDir, "sealed/$digest.cenc").isFile)
        assertEquals(keyId, state().getJSONObject(id).getJSONObject("sealed").getJSONObject(digest).getString("keyId"))
        // The content key is in no file outside the wrapped store, and diagnostics never carry it.
        val keyHex = inputs.getString("key")
        app.filesDir.walkTopDown().filter { it.isFile }.forEach { assertFalse(it.path, it.readText(Charsets.ISO_8859_1).contains(keyHex)) }
        assertFalse(store.diagnostics().contains(keyHex))
    }

    @Test fun aPlainPackageCannotTakeAnEncryptedId() {
        store.addKey(id, keyId, key(), "")
        assertEquals("PACKAGE_INVALID", code { store.install(EncryptedPackages.open(envelope, key())) })
    }

    @Test fun forgettingTheKeyLocksAndRemovesUnlockedCodeButKeepsTheRest() {
        val module = installed()
        store.storage(id, JSONObject().put("op", "set").put("key", "score").put("value", 42))
        val stopped = mutableListOf<String>()
        store.onLocked { stopped += it }
        store.forgetKey(id, keyId)
        assertEquals(listOf(id), stopped)
        val inventory = store.inventory()
        assertTrue(inventory.modules.isEmpty())
        assertTrue(inventory.damaged.isEmpty())
        assertEquals(listOf(LockedModule(id, inputs.getString("version"), "PACKAGE_LOCKED")), inventory.locked)
        assertFalse(store.directory(digest).exists())
        assertTrue(File(app.filesDir, "sealed/$digest.cenc").isFile)
        assertEquals("[]", File(app.filesDir, "key-cleanup.json").readText())
        assertEquals("PACKAGE_LOCKED", code { store.beginRun(module) })
        assertEquals("PACKAGE_LOCKED", code { store.withCapability(module, "storage.kv") { } })
        assertTrue(state().getJSONObject(id).has("grants"))
        // Nothing decrypted is left to show: no name in the locked inventory or the diagnostics.
        assertFalse(inventory.toString().contains("SYNTHETIC-PRIVATE-MARKER"))
        assertFalse(store.diagnostics().contains("SYNTHETIC-PRIVATE-MARKER"))
        assertEquals(42, store.storage(id, JSONObject().put("op", "get").put("key", "score")))
        // Re-import verifies the stored envelope again and restores the same consented version.
        store.addKey(id, keyId, key(), "")
        val restored = store.inventory().modules.single()
        assertEquals(digest, restored.digest)
        assertEquals(module.granted, restored.granted)
        assertTrue(store.inventory().locked.isEmpty())
    }

    @Test fun anUnlockFromBeforeAForgottenKeyCannotInstall() {
        store.addKey(id, keyId, key(), "")
        val prepared = store.unlock(envelope, entry)
        store.forgetKey(id, keyId)
        store.addKey(id, keyId, key(), "")
        assertEquals("INSTALL_STALE", code { store.install(prepared) })
        store.install(store.unlock(envelope, entry))
        assertEquals(1, store.inventory().modules.size)
    }

    @Test fun aWrongKeyForAnInstalledVersionIsNotKept() {
        installed()
        store.forgetKey(id, keyId)
        assertEquals("PACKAGE_WRONG_KEY", code { store.addKey(id, keyId, ByteArray(32) { 7 }, "") })
        assertTrue(store.keys.list().isEmpty())
        assertEquals(1, store.inventory().locked.size)
    }

    @Test fun cleanupInterruptedByACrashIsFinishedBeforeTheNextInventory() {
        installed()
        // As if the process died after the durable mark and the key removal, before any deletion.
        File(app.filesDir, "key-cleanup.json").writeText("[{\"id\":\"$id\",\"keyId\":\"$keyId\"}]")
        store.keys.forget(id, keyId)
        assertTrue(store.directory(digest).exists())
        store = newStore()
        assertEquals(1, store.inventory().locked.size)
        assertFalse(store.directory(digest).exists())
        assertEquals("[]", File(app.filesDir, "key-cleanup.json").readText())
    }

    @Test fun aPendingCleanupKeepsTheModuleLockedEvenWithTheKeyBack() {
        val module = installed()
        File(app.filesDir, "key-cleanup.json").writeText("[{\"id\":\"$id\",\"keyId\":\"$keyId\"}]")
        // The key is still stored and the code still on disk, but the binding is marked forgotten.
        assertEquals("PACKAGE_LOCKED", code { store.withCapability(module, "storage.kv") { } })
        assertEquals("PACKAGE_LOCKED", code { store.unlock(envelope, entry) })
        // Re-import finishes the forget first (key removed, code deleted), then restores from the envelope.
        store.addKey(id, keyId, key(), "")
        assertEquals(digest, store.inventory().modules.single().digest)
        assertEquals("[]", File(app.filesDir, "key-cleanup.json").readText())
    }

    @Test fun aCrashBetweenTheMarkAndTheKeyRemovalStillForgetsTheKey() {
        installed()
        File(app.filesDir, "key-cleanup.json").writeText("[{\"id\":\"$id\",\"keyId\":\"$keyId\"}]")
        store = newStore()
        assertEquals("PACKAGE_LOCKED", store.inventory().locked.single().code)
        assertTrue(store.keys.list().isEmpty())
        assertFalse(store.directory(digest).exists())
    }

    @Test fun aLostKeystoreKeyLocksAndAReimportReplacesTheDeadRecord() {
        val module = installed()
        // A new wrapping key: the stored record no longer unwraps, as after a Keystore reset.
        store = ModuleStore(app, publisher.public.encoded, FakeWrapper(ByteArray(32) { 9 }))
        assertEquals("KEY_UNAVAILABLE", store.inventory().locked.single().code)
        assertEquals("KEY_UNAVAILABLE", code { store.beginRun(module) })
        assertEquals("KEY_UNAVAILABLE", code { store.unlock(envelope, entry) })
        store.addKey(id, keyId, key(), "")
        assertEquals(digest, store.inventory().modules.single().digest)
        assertEquals(1, store.keys.list().size)
    }

    @Test fun aChangedOrMissingKeptEnvelopeStopsTheModule() {
        val module = installed()
        File(app.filesDir, "sealed/$digest.cenc").writeBytes(envelope.copyOf().also { it[it.size - 1] = (it[it.size - 1] + 1).toByte() })
        assertEquals("PACKAGE_CORRUPT", store.inventory().locked.single().code)
        assertEquals("PACKAGE_CORRUPT", code { store.beginRun(module) })
        File(app.filesDir, "sealed/$digest.cenc").delete()
        assertEquals("PACKAGE_CORRUPT", code { store.beginRun(module) })
    }

    @Test fun reimportChecksTheEnvelopeAgainstTheRecordedKeyId() {
        installed()
        store.forgetKey(id, keyId)
        val other = "c".repeat(32)
        val state = state()
        state.getJSONObject(id).getJSONObject("sealed").getJSONObject(digest).put("keyId", other)
        File(app.filesDir, "module-state.json").writeText(state.toString())
        assertEquals("STATE_INVALID", code { store.addKey(id, other, key(), "") })
        assertTrue(store.inventory().modules.isEmpty())
        assertTrue(store.keys.list().isEmpty())
    }

    /** Two versions under one key; the newer one's kept envelope is changed after the forget. */
    private fun twoVersionsForgottenWithTheNewerChanged(): Pair<String, ByteArray> {
        installed()
        store.confirm(id)
        val (envelopeB, entryB) = seal("1.1.0", key(), keyId)
        store.install(store.unlock(envelopeB, entryB))
        assertEquals(digest, store.inventory().modules.single().previous)
        store.forgetKey(id, keyId)
        val keptB = File(app.filesDir, "sealed/${entryB.sha256}.cenc")
        keptB.writeBytes(envelopeB.copyOf().also { it[it.size - 1] = (it[it.size - 1] + 1).toByte() })
        return entryB.sha256 to envelopeB
    }

    private fun retryAfterRepairRestoresBoth(digestB: String, envelopeB: ByteArray) {
        File(app.filesDir, "sealed/$digestB.cenc").writeBytes(envelopeB)
        store.addKey(id, keyId, key(), "")
        assertEquals(digestB, store.inventory().modules.single().digest)
        assertTrue(store.directory(digest).exists())
        assertTrue(store.directory(digestB).exists())
    }

    @Test fun aRejectedImportUndoesTheVersionsItAlreadyRestored() {
        val (digestB, envelopeB) = twoVersionsForgottenWithTheNewerChanged()
        assertEquals("CHECKSUM_FAILED", code { store.addKey(id, keyId, key(), "") })
        assertTrue(store.keys.list().isEmpty())
        // Version 1.0.0 was restored before 1.1.0 failed; its unlocked code is removed again.
        assertFalse(store.directory(digest).exists())
        assertFalse(store.directory(digestB).exists())
        assertEquals("[]", File(app.filesDir, "key-cleanup.json").readText())
        retryAfterRepairRestoresBoth(digestB, envelopeB)
    }

    @Test fun aRejectedImportWhoseCleanupJournalCannotBeWrittenStillDropsTheKeyAndTheCode() {
        val (digestB, envelopeB) = twoVersionsForgottenWithTheNewerChanged()
        // The journal can be read but not written: the file and filesDir are read-only (keys live in
        // noBackupFilesDir, unlocked code in filesDir/modules, both still writable).
        val journal = File(app.filesDir, "key-cleanup.json")
        assertTrue(journal.isFile)
        try {
            assertTrue(journal.setWritable(false) && app.filesDir.setWritable(false))
            assertEquals("CHECKSUM_FAILED", code { store.addKey(id, keyId, key(), "") })
            assertTrue(store.keys.list().isEmpty())
            assertFalse(store.directory(digest).exists())
            assertFalse(store.directory(digestB).exists())
        } finally {
            app.filesDir.setWritable(true); journal.setWritable(true)
        }
        retryAfterRepairRestoresBoth(digestB, envelopeB)
    }

    @Test fun aReimportThatCannotRestoreItsVersionIsNotKeptAndACorrectedRetryWorks() {
        installed()
        store.forgetKey(id, keyId)
        val kept = File(app.filesDir, "sealed/$digest.cenc")
        val good = kept.readBytes()
        kept.writeBytes(good.copyOf().also { it[it.size - 1] = (it[it.size - 1] + 1).toByte() })
        assertEquals("CHECKSUM_FAILED", code { store.addKey(id, keyId, key(), "") })
        assertTrue(store.keys.list().isEmpty())
        assertEquals("[]", File(app.filesDir, "key-cleanup.json").readText())
        kept.delete()
        assertEquals("PACKAGE_CORRUPT", code { store.addKey(id, keyId, key(), "") })
        assertTrue(store.keys.list().isEmpty())
        // The retry after the repair is not refused as KEY_EXISTS, and restores the version.
        kept.writeBytes(good)
        store.addKey(id, keyId, key(), "")
        assertEquals(digest, store.inventory().modules.single().digest)
        assertEquals(1, store.keys.list().size)
    }

    @Test fun anEncryptedRecordWithoutItsBindingNeverRunsAsPlain() {
        installed()
        val state = state()
        state.getJSONObject(id).remove("sealed")
        File(app.filesDir, "module-state.json").writeText(state.toString())
        val inventory = store.inventory()
        assertTrue(inventory.modules.isEmpty())
        assertEquals("STATE_INVALID", inventory.damaged.single().code)
    }

    @Test fun anInstallInterruptedBeforeItsRecordLeavesNoPlaintext() {
        installed()
        // As if the process died after staging and the rename, before module-state.json was written.
        File(app.filesDir, "module-state.json").writeText("{}")
        File(store.directory(digest).parentFile, "staging-0000").apply { mkdirs(); File(this, "index.html").writeText("partial") }
        store = newStore()
        assertTrue(store.inventory().modules.isEmpty())
        assertFalse(store.directory(digest).exists())
        assertEquals(emptyList<String>(), store.directory(digest).parentFile!!.list()!!.toList())
        assertFalse(File(app.filesDir, "sealed/$digest.cenc").exists())
    }

    @Test fun forgettingOnlyTheNewKeyOffersTheStillUnlockedPreviousVersion() {
        installed()
        store.confirm(id)
        val keyB = ByteArray(32) { (it * 7 + 3).toByte() }
        val (envelopeB, entryB) = seal("1.1.0", keyB.copyOf(), "b".repeat(32))
        store.addKey(id, "b".repeat(32), keyB.copyOf(), "")
        store.install(store.unlock(envelopeB, entryB))
        assertEquals("1.1.0", store.inventory().modules.single().manifest.version)
        store.forgetKey(id, "b".repeat(32))
        // Version 1.0.0 still has its key A and its code: the locked card offers restoring it.
        assertTrue(store.directory(digest).exists())
        assertEquals(listOf(LockedModule(id, "1.1.0", "PACKAGE_LOCKED", "1.0.0")), store.inventory().locked)
        store.rollback(id)
        val restored = store.inventory()
        assertEquals("1.0.0", restored.modules.single().manifest.version)
        assertTrue(restored.locked.isEmpty())
    }

    @Test fun aWrongKeyAfterAKeystoreLossDoesNotUnlockTheKeptCode() {
        installed()
        store = ModuleStore(app, publisher.public.encoded, FakeWrapper(ByteArray(32) { 9 }))
        assertTrue(store.directory(digest).exists())
        assertEquals("PACKAGE_WRONG_KEY", code { store.addKey(id, keyId, ByteArray(32) { 7 }, "") })
        assertTrue(store.keys.list().isEmpty())
        assertTrue(store.inventory().modules.isEmpty())
        store.addKey(id, keyId, key(), "")
        assertEquals(digest, store.inventory().modules.single().digest)
    }

    @Test fun updatingALockedTrialKeepsTheWorkingRollback() {
        installed()
        store.confirm(id)
        val keyB = ByteArray(32) { (it * 5 + 1).toByte() }
        val (envelopeB, entryB) = seal("1.1.0", keyB.copyOf(), "b".repeat(32))
        store.addKey(id, "b".repeat(32), keyB.copyOf(), "")
        store.install(store.unlock(envelopeB, entryB))
        store.forgetKey(id, "b".repeat(32))
        assertEquals("1.1.0", store.inventory().locked.single().version)
        val keyC = ByteArray(32) { (it * 3 + 2).toByte() }
        val (envelopeC, entryC) = seal("1.2.0", keyC.copyOf(), "c".repeat(32))
        store.addKey(id, "c".repeat(32), keyC.copyOf(), "")
        store.install(store.unlock(envelopeC, entryC))
        val updated = store.inventory().modules.single()
        assertEquals("1.2.0", updated.manifest.version)
        assertEquals(digest, updated.previous)
        store.rollback(id)
        assertEquals("1.0.0", store.inventory().modules.single().manifest.version)
    }

    @Test fun removingTheModuleDropsItsEnvelopeButNotTheKey() {
        installed()
        store.remove(id)
        assertFalse(File(app.filesDir, "sealed/$digest.cenc").exists())
        assertEquals(1, store.keys.list().size)
    }

    @Test fun encryptedModulesFreeFormLogsAreNotKept() {
        val module = installed()
        store.log("module", "MODULE_INFO", module.manifest, "private table text")
        assertFalse(store.diagnostics().contains("private table text"))
        assertTrue(store.diagnostics().contains("Encrypted module message omitted"))
    }
}
