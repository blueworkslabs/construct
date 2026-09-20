package dev.construct.runtime

import java.io.File
import java.security.MessageDigest
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
class CameraRetirementTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private lateinit var store: ModuleStore
    private val id = "dev.construct.camera"
    @Before fun setup() { app.filesDir.listFiles()?.forEach { it.deleteRecursively() }; store = ModuleStore(app) }
    private fun fixture(folder: String): VerifiedPackage {
        val dir = File(System.getProperty("construct.fixtureRoot"), folder)
        val entry = Packages.catalog(File(dir, "index.json").readBytes()).filter { it.id == id }.maxBy { it.version }
        return Packages.verify(File(dir, entry.artifact).readBytes(), entry, store.publicKey)
    }
    private fun denied(code: String, action: () -> Unit) {
        try { action(); fail("Expected $code") } catch (e: ConstructError) { assertEquals(code, e.code) }
    }
    // Reproduce alpha30's installed layout using the actual signed legacy package.
    // Never re-enable a retired implementation just to manufacture upgrade state.
    private fun oldInstall(confirmed: Boolean = true): Installed {
        val f = fixture("camera-registry")
        val dir = store.directory(f.digest).apply { mkdirs() }
        val hashes = JSONObject()
        f.files.forEach { (path, bytes) ->
            File(dir, path).apply { parentFile!!.mkdirs(); writeBytes(bytes) }
            hashes.put(path, MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) })
        }
        File(dir, ".files.json").writeText(hashes.toString())
        File(app.filesDir, "module-state.json").writeText(JSONObject().put(id, JSONObject()
            .put("active", f.digest).put("previous", JSONObject.NULL).put("enabled", true)
            .put("confirmed", confirmed).put("grants", JSONObject().put("camera.capture", true))).toString())
        File(app.filesDir, "camera-photos/$id/00000000-0000-4000-8000-000000000001.jpg").apply {
            parentFile!!.mkdirs(); writeBytes(byteArrayOf(1,2,3))
        }
        store.storage(id, JSONObject().put("op", "set").put("key", "counter").put("value", 7))
        return store.installed().single()
    }
    private fun state() = File(app.filesDir, "module-state.json").readText()
    private fun retainedData() {
        assertEquals(7, store.storage(id, JSONObject().put("op", "get").put("key", "counter")))
        assertArrayEquals(byteArrayOf(1,2,3), File(app.filesDir,"camera-photos/$id/00000000-0000-4000-8000-000000000001.jpg").readBytes())
    }
    @Test fun originalApi04RemainsReadableButEarlierApiCannotDeclareCamera() {
        val legacy = fixture("camera-registry")
        val raw = JSONObject(legacy.files.getValue("manifest.json").toString(Charsets.UTF_8))
        raw.remove("themeColor")
        raw.put("constructApi", JSONObject().put("min", "0.4.0").put("target", "0.4.0"))
        assertEquals("0.4.0", Packages.manifest(raw.toString().toByteArray()).api)
        raw.put("constructApi", JSONObject().put("min", "0.3.0").put("target", "0.3.0"))
        denied("API_INCOMPATIBLE") { Packages.manifest(raw.toString().toByteArray()) }
    }
    @Test fun existingPackageIsManageableButCannotExecuteOrRegrant() {
        val old = oldInstall()
        val before = state()
        assertTrue(store.inventory().damaged.isEmpty())
        assertTrue(CapabilityLifecycle.needsUpdate(old.manifest))
        assertFalse("camera.capture" in old.granted)
        denied("MODULE_UPDATE_REQUIRED") { store.beginRun(old) }
        denied("MODULE_UPDATE_REQUIRED") { store.confirm(id) }
        denied("CAPABILITY_RETIRED") { store.setCapability(id, "camera.capture", true) }
        denied("CAPABILITY_RETIRED") { store.withCapability(old, "camera.capture") { fail() } }
        assertEquals(before, state()); retainedData()
        assertFalse("camera.capture" in Packages.supported)
        // Native host storage management remains usable without executing the old module.
        assertEquals(1, CameraPhotos(app, id).list().size)
        CameraPhotos(app, id).deleteAll(); assertTrue(CameraPhotos(app, id).list().isEmpty())
    }
    @Test fun newLegacyInstallIsRejectedBeforeAnyStateOrCodeWrite() {
        denied("MODULE_UPDATE_REQUIRED") { store.install(fixture("camera-registry")) }
        assertFalse(File(app.filesDir, "module-state.json").exists())
        assertTrue(File(app.filesDir, "modules").listFiles()!!.isEmpty())
    }
    @Test fun supportedUpdateRetainsDataAndDoesNotInheritLegacyAuthority() {
        val old = oldInstall()
        store.install(fixture("home-registry")); store = ModuleStore(app)
        val next = store.installed().single()
        assertFalse(CapabilityLifecycle.needsUpdate(next.manifest))
        for (cap in listOf("image.read", "camera.photo", "photos.library", "image.analyze")) {
            assertFalse(cap in next.granted)
            denied("CAPABILITY_DENIED") { store.withCapability(next, cap) { fail() } }
        }
        store.beginRun(next); store.confirm(id); retainedData()
        denied("RUN_STALE") { store.withCapability(old, "camera.capture") { fail() } }
    }
    @Test fun unconfirmedRetiredTrialCanBeReplacedWithoutPretendingItWorked() {
        oldInstall(false)
        store.install(fixture("home-registry"))
        assertFalse(store.installed().single().confirmed); retainedData()
    }
    @Test fun retiredRollbackFailsAtomicallyAndCurrentVersionRemainsUsable() {
        oldInstall(); store.install(fixture("home-registry"), mapOf("image.read" to true))
        val before = state()
        denied("MODULE_UPDATE_REQUIRED") { store.rollback(id) }
        assertEquals(before, state()); retainedData()
        store.beginRun(store.installed().single())
        assertTrue(store.withCapability(store.installed().single(), "image.read") { true })
    }
    @Test fun removalRetainsDataAndOptionalRetirementDoesNotBlockOtherFeatures() {
        val old = oldInstall(); store.remove(id)
        assertTrue(store.installed().isEmpty()); retainedData()
        val optional = old.manifest.copy(capabilities = old.manifest.capabilities.map { it.copy(optional = true) })
        CapabilityLifecycle.requireRunnable(optional)
        denied("CAPABILITY_RETIRED") { CapabilityLifecycle.requireAvailable(optional.capabilities.single().id) }
    }
    @Test fun catalogAllowsReplacingRetiredTrialButNotAnOrdinaryPendingTrial() {
        val release = CatalogVersion(id, "Pocket Camera", "0.2.0", "new.zip", "a".repeat(64), "signature", false)
        assertTrue(CatalogInstallPresentation.choice(release, CatalogInstalledState("0.1.4", "b".repeat(64), false, true)).enabled)
        assertFalse(CatalogInstallPresentation.choice(release, CatalogInstalledState("0.1.4", "b".repeat(64), false)).enabled)
    }
}
