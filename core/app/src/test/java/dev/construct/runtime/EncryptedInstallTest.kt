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
        assertEquals("KEY_EXISTS", code { store.addKey(id, keyId, key(), "") })
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
