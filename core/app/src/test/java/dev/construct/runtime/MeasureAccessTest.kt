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

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class MeasureAccessTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private lateinit var store: ModuleStore
    @Before fun setup() { app.filesDir.listFiles()?.forEach { it.deleteRecursively() }; store=ModuleStore(app) }
    private fun fixture(): VerifiedPackage {
        val dir=File(System.getProperty("construct.fixtureRoot"),"measure-legacy-registry")
        val entry=Packages.catalog(File(dir,"index.json").readBytes()).filter { it.id=="dev.construct.measure" }.maxBy { it.version }
        return Packages.verify(File(dir,entry.artifact).readBytes(),entry,store.publicKey)
    }
    private fun denied(code: String, action: () -> Unit) { try { action();fail("Expected $code") } catch (e: ConstructError) { assertEquals(code,e.code) } }
    @Test fun measureRequiresApi07AndExplicitGrant() {
        val f=fixture();assertTrue(f.manifest.capabilities.single().explicitOptIn)
        val m=JSONObject(f.files.getValue("manifest.json").toString(Charsets.UTF_8))
        m.put("constructApi",JSONObject().put("min","0.6.0").put("target","0.6.0"))
        denied("API_INCOMPATIBLE") { Packages.manifest(m.toString().toByteArray()) }
        store.install(f);val installed=store.installed().single()
        denied("CAPABILITY_DENIED") { MeasureActivity.open(app,store,installed,JSONObject().put("op","open")) }
        store.setCapability(installed.manifest.id,"photo.measure",true)
        store.withCapability(installed,"photo.measure") { }
        store.setCapability(installed.manifest.id,"photo.measure",false)
        store=ModuleStore(app)
        denied("CAPABILITY_DENIED") { store.withCapability(store.installed().single(),"photo.measure") { fail("Revoked") } }
    }
    @Test fun moduleCannotSupplyPhotoEndpointsOrTriggerMeasurement() {
        MeasureActivity.validate(JSONObject().put("op","open"))
        for (bad in listOf(JSONObject(),JSONObject().put("op","measure"),JSONObject().put("op","open").put("uri","content://x"),JSONObject().put("op","open").put("size",95))) {
            denied("INVALID_PARAMS") { MeasureActivity.validate(bad) }
        }
    }
}
