package dev.construct.runtime

import java.io.File
import org.json.JSONArray
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
class RemoteModuleTest {
    private lateinit var store: ModuleStore
    private val fixtures get() = File(requireNotNull(System.getProperty("construct.fixtureRoot")))
    private fun packages(folder: String): List<VerifiedPackage> {
        val root = File(fixtures, folder)
        return Packages.catalog(File(root, "index.json").readBytes()).map {
            Packages.verify(File(root, it.artifact).readBytes(), it, store.publicKey)
        }
    }
    @Before fun setup() {
        val app = RuntimeEnvironment.getApplication()
        app.filesDir.listFiles()?.forEach { it.deleteRecursively() }
        store = ModuleStore(app)
    }
    @Test fun publishedChecklistRollsBackAfterStoreRestartWithoutChangingItemsOrHello() {
        val versions = packages("remote-registry").filter { it.manifest.id == "dev.construct.checklist" }.sortedBy { it.manifest.version }
        val hello = store.prepare("demo", store.catalog("demo").first { it.version == "0.1.0" })
        store.install(hello); store.confirm(hello.manifest.id)
        val first = versions.first(); val second = versions.last()
        assertEquals("0.1.0", first.manifest.version)
        assertEquals("0.2.0", second.manifest.version)
        store.install(first); store.confirm(first.manifest.id)
        val saved = JSONArray().put(JSONObject().put("text", "A test item").put("done", true))
        store.storage(first.manifest.id, JSONObject().put("op", "set").put("key", "items").put("value", saved))
        store.install(second)
        val restarted = ModuleStore(RuntimeEnvironment.getApplication())
        restarted.rollback(first.manifest.id)
        assertEquals(saved.toString(), restarted.storage(first.manifest.id, JSONObject().put("op", "get").put("key", "items")).toString())
        assertEquals(JSONObject.NULL, restarted.storage(hello.manifest.id, JSONObject().put("op", "get").put("key", "items")))
        assertEquals(hello.digest, restarted.installed().first { it.manifest.id == hello.manifest.id }.digest)
    }
    @Test fun corruptedDownloadCannotReplaceWorkingChecklist() {
        val first = packages("remote-registry").first()
        store.install(first); store.confirm(first.manifest.id)
        val root = File(fixtures, "remote-registry")
        val meta = Packages.catalog(File(root, "index.json").readBytes()).last()
        val bytes = File(root, meta.artifact).readBytes().also { it[it.lastIndex] = (it.last().toInt() xor 1).toByte() }
        try { store.install(Packages.verify(bytes, meta, store.publicKey)); fail("Damaged package accepted") }
        catch (e: ConstructError) { assertEquals("CHECKSUM_FAILED", e.code) }
        assertEquals(first.digest, store.installed().single().digest)
        assertTrue(store.installed().single().confirmed)
    }
    @Test fun probesAreSignedButHaveNoStorageOrToastGrant() {
        val fixtures = packages("probe-registry")
        assertTrue(fixtures.isNotEmpty())
        fixtures.forEach { fixture ->
            assertEquals("dev.construct.probe", fixture.manifest.id)
            assertEquals(listOf("log.write"), fixture.manifest.capabilities.map { it.id })
        }
    }
    @Test fun remoteModulesAreNotBundledInHost() {
        val ids = store.catalog("demo").map { it.id }.toSet()
        assertEquals(setOf("dev.construct.hello"), ids)
    }
}
