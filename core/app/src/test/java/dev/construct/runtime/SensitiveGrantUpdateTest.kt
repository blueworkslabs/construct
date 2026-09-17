package dev.construct.runtime

import java.io.File
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RuntimeEnvironment
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[28])
class SensitiveGrantUpdateTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private lateinit var store: ModuleStore
    private val id = "dev.construct.sensitive-probe"
    private val sensitive = setOf("device.tone", "contacts.read", "camera.capture", "image.read", "image.markers", "location.read", "net.http")
    @Before fun setup() { app.filesDir.listFiles()?.forEach { it.deleteRecursively() }; store = ModuleStore(app) }
    private fun fixture(version: String): VerifiedPackage {
        val dir = File(System.getProperty("construct.fixtureRoot"), "sensitive-registry")
        val entry = Packages.catalog(File(dir, "index.json").readBytes()).single { it.version == version }
        return Packages.verify(File(dir, entry.artifact).readBytes(), entry, store.publicKey)
    }
    private fun assertDenied() {
        val module = store.installed().single()
        assertEquals(emptySet<String>(), module.granted.intersect(sensitive))
        for (cap in sensitive) {
            try { store.withCapability(module, cap) { fail("Unexpected authority: $cap") } }
            catch (error: ConstructError) { assertEquals("CAPABILITY_DENIED", error.code) }
        }
        assertTrue("storage.kv" in module.granted)
    }
    @Test fun removedSensitiveCapabilitiesDefaultOffWhenReintroduced() {
        store.install(fixture("2.1.0"), sensitive.associateWith { true }); store.confirm(id)
        store.storage(id, JSONObject().put("op", "set").put("key", "counter").put("value", 7))
        store.install(fixture("2.2.0")); store.confirm(id); store = ModuleStore(app)
        store.install(fixture("2.3.0")); store = ModuleStore(app)
        assertDenied()
        assertEquals(7, store.storage(id, JSONObject().put("op", "get").put("key", "counter")))
    }
    @Test fun unchangedDeclarationsAndExplicitReapprovalRetainAuthority() {
        store.install(fixture("2.1.0"), sensitive.associateWith { true }); store.confirm(id)
        store.install(fixture("2.3.0")); store.confirm(id)
        assertTrue(store.installed().single().granted.containsAll(sensitive))
        store.install(fixture("2.2.0")); store.confirm(id)
        store.install(fixture("2.1.0"), sensitive.associateWith { true }); store = ModuleStore(app)
        assertTrue(store.installed().single().granted.containsAll(sensitive))
    }
    @Test fun staleSensitiveGrantEntriesCannotOverrideDefaultOffInstallChoices() {
        store.install(fixture("2.2.0")); store.confirm(id)
        val file = File(app.filesDir, "module-state.json")
        val state = JSONObject(file.readText())
        sensitive.forEach { state.getJSONObject(id).getJSONObject("grants").put(it, true) }
        file.writeText(state.toString()); store = ModuleStore(app)
        store.install(fixture("2.3.0"))
        assertDenied()
    }
    @Test fun reintroducedLegacyStorageDoesNotUndoExplicitRevocation() {
        store.install(fixture("2.1.0")); store.setCapability(id, "storage.kv", false); store.confirm(id)
        store.install(fixture("2.4.0")); store.confirm(id)
        store.install(fixture("2.3.0")); store = ModuleStore(app)
        val module = store.installed().single()
        assertFalse("storage.kv" in module.granted)
        try { store.withCapability(module, "storage.kv") { fail("Revoked storage was restored") } }
        catch (error: ConstructError) { assertEquals("CAPABILITY_DENIED", error.code) }
    }
}
