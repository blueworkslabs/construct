package dev.construct.runtime

import java.io.File
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/** Per-module "Allow screenshots": decision matrix, copy, and persistence in module state. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class ScreenCaptureTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private lateinit var store: ModuleStore
    @Before fun setup() {
        app.filesDir.listFiles()?.forEach { it.deleteRecursively() }
        store = ModuleStore(app)
    }

    @Test fun decisionCoversSwitchCapabilitiesAndAndroidVersion() {
        val sdks = listOf(28, 32, 33, 35)
        for (sdk in sdks) {
            // Modules that cannot show image pixels were never secured; the switch does not change them.
            for (caps in listOf(emptyList(), listOf("storage.kv"), listOf("camera.photo"), listOf("location.read", "net.http")))
                for (allow in listOf(false, true))
                    assertEquals(ScreenCapturePolicy.Decision(secure = false, hideRecents = false), ScreenCapturePolicy.decide(caps, allow, sdk))
            for (caps in listOf(listOf("image.read"), listOf("image.read", "photos.library"), listOf("camera.photo", "image.read", "photos.library"), listOf("photos.library"))) {
                assertEquals("off keeps FLAG_SECURE", ScreenCapturePolicy.Decision(secure = true, hideRecents = false), ScreenCapturePolicy.decide(caps, false, sdk))
                assertEquals("on drops FLAG_SECURE; Recents hidden only on Android 13+",
                    ScreenCapturePolicy.Decision(secure = false, hideRecents = sdk >= 33), ScreenCapturePolicy.decide(caps, true, sdk))
            }
        }
    }

    @Test fun copySaysWhatHappensToTheRecentsThumbnail() {
        assertTrue(ScreenCapturePolicy.copy(33).contains("Recents thumbnail stays hidden"))
        assertTrue(ScreenCapturePolicy.copy(35).contains("Recents thumbnail stays hidden"))
        for (sdk in listOf(28, 32)) {
            assertTrue(ScreenCapturePolicy.copy(sdk).contains("Recents thumbnail also shows"))
            assertFalse(ScreenCapturePolicy.copy(sdk).contains("stays hidden"))
        }
        for (sdk in listOf(28, 33)) {
            assertTrue(ScreenCapturePolicy.copy(sdk).startsWith("Off by default."))
            assertTrue(ScreenCapturePolicy.copy(sdk).contains("camera viewfinder always blocks screenshots"))
        }
    }

    // The stored choice is host state and independent of the demo module's capabilities.
    private fun demo(version: String) = store.prepare("demo", store.catalog("demo").first { it.version == version })

    @Test fun switchIsOffByDefaultPersistsAndSurvivesUpdateAndRollback() {
        val first = demo("0.1.0"); val second = demo("0.2.0")
        val id = first.manifest.id
        store.install(first)
        assertFalse(store.installed().single().allowScreenshots)
        store.setScreenshots(id, true)
        assertTrue(ModuleStore(app).installed().single().allowScreenshots)
        store.confirm(id); store.install(second)
        assertTrue("update keeps the choice", store.installed().single().allowScreenshots)
        store.rollback(id)
        assertTrue("rollback keeps the choice", store.installed().single().allowScreenshots)
        store.setScreenshots(id, false)
        assertFalse(ModuleStore(app).installed().single().allowScreenshots)
        store.setScreenshots(id, true); store.remove(id); store.install(first)
        assertFalse("remove and reinstall starts off again", store.installed().single().allowScreenshots)
    }

    @Test fun onlyAnExplicitStoredTrueAllowsScreenshots() {
        val module = demo("0.1.0")
        store.install(module)
        val file = File(app.filesDir, "module-state.json")
        for (value in listOf<Any>("true", 1, JSONObject())) {
            val state = JSONObject(file.readText())
            state.getJSONObject(module.manifest.id).put("allowScreenshots", value)
            file.writeText(state.toString())
            assertFalse("$value", ModuleStore(app).installed().single().allowScreenshots)
        }
        try { store.setScreenshots("dev.construct.missing", true); fail("Unknown module") } catch (_: Exception) { }
    }
}
