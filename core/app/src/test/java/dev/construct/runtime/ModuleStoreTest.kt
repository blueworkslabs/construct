package dev.construct.runtime

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class ModuleStoreTest {
    private lateinit var store: ModuleStore
    private lateinit var first: VerifiedPackage
    private lateinit var second: VerifiedPackage
    @Before fun setup() {
        val app = RuntimeEnvironment.getApplication()
        app.filesDir.listFiles()?.forEach { it.deleteRecursively() }
        store = ModuleStore(app)
        val versions = store.catalog("demo")
        first = store.prepare("demo", versions.first { it.version == "0.1.0" })
        second = store.prepare("demo", versions.first { it.version == "0.2.0" })
    }
    @Test fun firstInstallRequiresExplicitConfirmation() {
        store.install(first)
        val installed = store.installed().single()
        assertFalse(installed.confirmed)
        assertNull(installed.previous)
        try { store.install(second); fail("Unconfirmed version must not be overwritten") }
        catch (e: ConstructError) { assertEquals("TRIAL_PENDING", e.code) }
        assertEquals(first.digest, store.installed().single().digest)
    }
    @Test fun pendingUpdateSurvivesRestartAndRollsBackWithDataIntact() {
        store.install(first); store.confirm(first.manifest.id)
        store.storage(first.manifest.id, JSONObject().put("op", "set").put("key", "count").put("value", 7))
        store.install(second)
        val restarted = ModuleStore(RuntimeEnvironment.getApplication())
        assertEquals(first.digest, restarted.installed().single().previous)
        assertFalse(restarted.installed().single().confirmed)
        restarted.rollback(first.manifest.id)
        assertEquals("0.1.0", restarted.installed().single().manifest.version)
        assertTrue(restarted.installed().single().confirmed)
        assertEquals(7, restarted.storage(first.manifest.id, JSONObject().put("op", "get").put("key", "count")))
    }
    @Test fun confirmedUpdateRetainsPreviousAndCanRollback() {
        store.install(first); store.confirm(first.manifest.id)
        store.install(second); store.confirm(second.manifest.id)
        assertEquals(first.digest, store.installed().single().previous)
        store.rollback(first.manifest.id)
        assertEquals(first.digest, store.installed().single().digest)
        assertFalse(store.directory(second.digest).exists())
    }
    @Test fun disabledStateSurvivesRestart() {
        store.install(first); store.enable(first.manifest.id, false)
        assertFalse(ModuleStore(RuntimeEnvironment.getApplication()).installed().single().enabled)
    }
    @Test fun activitiesShareOneStoreAndTransactionLock() {
        val app = RuntimeEnvironment.getApplication()
        assertSame(ModuleStore.shared(app), ModuleStore.shared(app))
    }
    @Test fun failedFirstTrialCanBeDiscardedAndReplaced() {
        store.install(first)
        store.discardFirstTrial(first.manifest.id)
        assertTrue(store.installed().isEmpty())
        store.install(second)
        assertEquals("0.2.0", store.installed().single().manifest.version)
    }
    @Test fun stagingFailureDoesNotChangeActivePointer() {
        store.install(first); store.confirm(first.manifest.id)
        // Simulate an interrupted writer before pointer promotion.
        val orphan = java.io.File(RuntimeEnvironment.getApplication().filesDir, "modules/staging-interrupted")
        orphan.mkdirs(); java.io.File(orphan, "partial.txt").writeText("partial")
        val restarted = ModuleStore(RuntimeEnvironment.getApplication())
        assertEquals(first.digest, restarted.installed().single().digest)
        restarted.install(second)
        assertFalse(orphan.exists())
        assertEquals(first.digest, restarted.installed().single().previous)
    }
    @Test fun interruptedAtomicPointerWriteRecoversPreviousCompleteState() {
        store.install(first); store.confirm(first.manifest.id)
        val file = java.io.File(RuntimeEnvironment.getApplication().filesDir, "module-state.json")
        file.copyTo(java.io.File(file.path + ".bak"), overwrite = true)
        file.writeText("{partial")
        val restarted = ModuleStore(RuntimeEnvironment.getApplication())
        assertEquals(first.digest, restarted.installed().single().digest)
        assertTrue(restarted.installed().single().confirmed)
    }
    @Test fun storageIsNamespacedAndQuotaFailurePreservesOldData() {
        store.storage("dev.construct.one", JSONObject().put("op", "set").put("key", "a").put("value", 1))
        assertEquals(JSONObject.NULL, store.storage("dev.construct.two", JSONObject().put("op", "get").put("key", "a")))
        try {
            store.storage("dev.construct.one", JSONObject().put("op", "set").put("key", "a").put("value", "x".repeat(70000)))
            fail("Quota should reject write")
        } catch (e: ConstructError) { assertEquals("STORAGE_QUOTA", e.code) }
        assertEquals(1, store.storage("dev.construct.one", JSONObject().put("op", "get").put("key", "a")))
    }
    @Test fun credentialsAndCleartextRegistryRejected() {
        for (url in listOf("http://example.org/index.json", "https://user:password@example.org/index.json", "https://example.org/index.json?secret=value")) {
            try { store.registry = url; fail("Unsafe registry accepted") }
            catch (e: ConstructError) { assertEquals("REGISTRY_URL", e.code) }
        }
    }

    private fun stateFile() = java.io.File(RuntimeEnvironment.getApplication().filesDir, "module-state.json")
    private fun rewriteState(change: (JSONObject) -> Unit) {
        val state = JSONObject(stateFile().readText()); change(state); stateFile().writeText(state.toString())
    }
    @Test fun oneMalformedRecordDoesNotHideHealthyModuleAndCanBeRemoved() {
        store.install(first); store.confirm(first.manifest.id)
        rewriteState { it.put("dev.construct.damaged", "not a record") }
        assertEquals(first.digest, store.inventory().modules.single().digest)
        assertEquals("dev.construct.damaged", store.inventory().damaged.single().id)
        store.remove("dev.construct.damaged")
        assertTrue(store.inventory().damaged.isEmpty())
        assertTrue(store.directory(first.digest).exists())
    }
    @Test fun missingActiveVersionStillOffersVerifiedPreviousVersion() {
        store.install(first); store.confirm(first.manifest.id); store.install(second)
        store.directory(second.digest).deleteRecursively()
        val inventory = ModuleStore(RuntimeEnvironment.getApplication()).inventory()
        assertTrue(inventory.modules.isEmpty())
        assertEquals("0.1.0", inventory.damaged.single().previousVersion)
        assertEquals("PACKAGE_MISSING", inventory.damaged.single().code)
        store.rollback(first.manifest.id)
        assertEquals(first.digest, store.installed().single().digest)
    }
    @Test fun damagedScriptIsDetectedAndPreviousCodeCanBeRestored() {
        store.install(first); store.confirm(first.manifest.id); store.install(second)
        java.io.File(store.directory(second.digest), "ui/app.js").writeText("changed after verification")
        assertEquals("PACKAGE_CORRUPT", store.inventory().damaged.single().code)
        assertEquals("0.1.0", store.inventory().damaged.single().previousVersion)
        store.rollback(first.manifest.id)
        assertEquals(first.digest, store.installed().single().digest)
    }
    @Test fun damagedPreviousVersionIsNotOfferedAsRepair() {
        store.install(first); store.confirm(first.manifest.id); store.install(second)
        java.io.File(store.directory(first.digest), "manifest.json").writeText("bad")
        java.io.File(store.directory(second.digest), "manifest.json").writeText("bad")
        assertNull(store.inventory().damaged.single().previousVersion)
        try { store.rollback(first.manifest.id); fail("Damaged rollback must not become active") }
        catch (e: ConstructError) { assertEquals("PACKAGE_CORRUPT", e.code) }
        assertEquals(second.digest, JSONObject(stateFile().readText()).getJSONObject(first.manifest.id).getString("active"))
    }
    @Test fun confirmedModuleRemovalKeepsDataForReinstall() {
        store.install(first); store.confirm(first.manifest.id)
        store.storage(first.manifest.id, JSONObject().put("op", "set").put("key", "count").put("value", 12))
        store.remove(first.manifest.id)
        assertTrue(store.installed().isEmpty()); assertFalse(store.directory(first.digest).exists())
        store.install(first)
        assertEquals(12, store.storage(first.manifest.id, JSONObject().put("op", "get").put("key", "count")))
    }
    @Test fun unreadableIndexIsReportedAndOnlyExplicitResetArchivesIt() {
        store.install(first)
        store.storage(first.manifest.id, JSONObject().put("op", "set").put("key", "count").put("value", 19))
        java.io.File(store.directory(first.digest), "ui/app.js").writeText("damaged code too")
        stateFile().writeText("{broken")
        assertEquals("STATE_UNREADABLE", store.inventory().indexError)
        assertEquals("{broken", stateFile().readText())
        store.resetUnreadableIndex()
        assertNull(store.inventory().indexError)
        assertTrue(store.installed().isEmpty())
        assertEquals("{broken", RuntimeEnvironment.getApplication().filesDir.listFiles()!!.single { it.name.startsWith("state-recovery-") }.readText())
        assertFalse(store.directory(first.digest).exists())
        store.install(first)
        assertEquals(19, store.storage(first.manifest.id, JSONObject().put("op", "get").put("key", "count")))
    }
    @Test fun alphaOnePackagesAreValidatedAgainstSignedBundledBytes() {
        store.install(first)
        java.io.File(store.directory(first.digest), ".files.json").delete()
        assertEquals(first.digest, store.installed().single().digest)
        java.io.File(store.directory(first.digest), "ui/app.js").appendText("tampered")
        assertEquals("PACKAGE_CORRUPT", store.inventory().damaged.single().code)
    }
    @Test fun consoleFailureBlocksConfirmationEvenBeforeUiClosesAndAfterRestart() {
        store.install(first)
        val module = store.installed().single()
        store.beginRun(module)
        var stopped = false
        val client = moduleChromeClient({ store.runtimeFailed(module, "JAVASCRIPT_ERROR"); stopped = true }, {})
        client.onConsoleMessage(android.webkit.ConsoleMessage("Uncaught Error", "local fixture", 1, android.webkit.ConsoleMessage.MessageLevel.ERROR))
        assertTrue(stopped)
        for (candidate in listOf(store, ModuleStore(RuntimeEnvironment.getApplication()))) {
            try { candidate.confirm(first.manifest.id); fail("Failed run must not be markable") }
            catch (e: ConstructError) { assertEquals("RUNTIME_FAILED", e.code) }
        }
        assertEquals("JAVASCRIPT_ERROR", store.installed().single().failureCode)
        store.beginRun(store.installed().single())
        store.confirm(first.manifest.id)
        assertTrue(store.installed().single().confirmed)
    }
    @Test fun staleRuntimeFailureCannotFailReplacementVersion() {
        store.install(first); store.confirm(first.manifest.id)
        val old = store.installed().single()
        store.install(second)
        store.runtimeFailed(old, "JAVASCRIPT_ERROR")
        store.confirm(second.manifest.id)
        assertNull(store.installed().single().failureCode)
    }
    @Test fun moduleLoggingCannotEvictHostHistoryAndIsRateLimited() {
        store.install(first)
        repeat(500) { store.log("module", "MODULE_INFO", first.manifest, "spam") }
        var lines = store.diagnostics().lineSequence().filter { it.isNotBlank() }.map { JSONObject(it) }.toList()
        assertEquals(10, lines.count { it.optString("source") == "module" })
        repeat(13) {
            org.robolectric.shadows.ShadowSystemClock.advanceBy(java.time.Duration.ofSeconds(5))
            repeat(10) { store.log("module", "MODULE_INFO", first.manifest, "more spam") }
        }
        lines = store.diagnostics().lineSequence().filter { it.isNotBlank() }.map { JSONObject(it) }.toList()
        assertEquals(120, lines.count { it.optString("source") == "module" })
        assertTrue(lines.any { it.getString("code") == "INSTALLED_TRIAL" && it.optString("packageDigest") == first.digest })
    }
    @Test fun deliberateFailureFixtureIsSignedAndExplicitlyLabelled() {
        val fixture = store.catalog("demo").single { it.version == "0.2.1" }
        assertTrue(fixture.testFixture)
        val verified = store.prepare("demo", fixture)
        assertTrue(verified.files.getValue("ui/app.js").toString(Charsets.UTF_8).contains("throw new Error"))
        store.install(first); store.confirm(first.manifest.id); store.install(verified)
        assertEquals(first.digest, store.installed().single().previous)
    }
}
