package dev.construct.runtime

import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class ImageAccessTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private lateinit var store: ModuleStore
    @Before fun setup() { app.filesDir.listFiles()?.forEach { it.deleteRecursively() }; store = ModuleStore(app) }
    private fun fixture(registry: String): VerifiedPackage {
        val dir = File(System.getProperty("construct.fixtureRoot"), registry)
        val entry = Packages.catalog(File(dir,"index.json").readBytes()).filter { it.id == "dev.construct.measure" }.maxBy { it.version }
        return Packages.verify(File(dir,entry.artifact).readBytes(),entry,store.publicKey)
    }
    private fun denied(code: String, action: () -> Unit) { try { action(); fail("Expected $code") } catch (e: ConstructError) { assertEquals(code,e.code) } }
    @Test fun newPixelsRequireApi10AndTwoFreshGrants() {
        val modern = fixture("home-registry")
        assertEquals(setOf("image.read", "image.markers"), modern.manifest.capabilities.map { it.id }.toSet())
        assertTrue(modern.manifest.capabilities.all { it.explicitOptIn })
        val m = JSONObject(modern.files.getValue("manifest.json").toString(Charsets.UTF_8))
        m.put("constructApi", JSONObject().put("min","0.9.0").put("target","0.9.0"))
        denied("API_INCOMPATIBLE") { Packages.manifest(m.toString().toByteArray()) }
        store.install(modern)
        val installed = store.installed().single()
        for (cap in listOf("image.read", "image.markers")) denied("CAPABILITY_DENIED") { store.withCapability(installed,cap) {} }
        store.setCapability(installed.manifest.id,"image.read",true)
        store.withCapability(installed,"image.read") {}
        denied("CAPABILITY_DENIED") { store.withCapability(installed,"image.markers") {} }
        store.setCapability(installed.manifest.id,"image.read",false)
        store = ModuleStore(app)
        denied("CAPABILITY_DENIED") { store.withCapability(store.installed().single(),"image.read") {} }
    }
    @Test fun markerDeclarationRequiresImageReadRegardlessOfOrderOrOptionalFlag() {
        val modern = fixture("home-registry")
        val m = JSONObject(modern.files.getValue("manifest.json").toString(Charsets.UTF_8))
        val read = JSONObject().put("id", "image.read").put("reason", "Selected pixels")
        for (optional in listOf(false, true)) {
            val marker = JSONObject().put("id", "image.markers").put("reason", "Marker corners").put("optional", optional)
            m.put("capabilities", JSONArray().put(marker))
            denied("MANIFEST_SCHEMA") { Packages.manifest(m.toString().toByteArray()) }
            for (caps in listOf(JSONArray().put(marker).put(read), JSONArray().put(read).put(marker), JSONArray().put(read))) {
                m.put("capabilities", caps)
                assertEquals(caps.length(), Packages.manifest(m.toString().toByteArray()).capabilities.size)
            }
        }
    }

}
