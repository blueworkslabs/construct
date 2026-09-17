package dev.construct.runtime

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Robolectric
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[28])
class SkyAccessTest {
    private val app get()=RuntimeEnvironment.getApplication()
    private lateinit var store: ModuleStore
    @Before fun setup() { app.filesDir.listFiles()?.forEach { it.deleteRecursively() }; store=ModuleStore(app) }
    private fun fixture(): VerifiedPackage {
        val dir=File(System.getProperty("construct.fixtureRoot"),"sky-legacy-registry")
        val entry=Packages.catalog(File(dir,"index.json").readBytes()).single { it.id=="dev.construct.sky-watch" }
        return Packages.verify(File(dir,entry.artifact).readBytes(),entry,store.publicKey)
    }
    private fun denied(code: String,action:()->Unit) { try { action();fail("Expected $code") } catch(e: ConstructError) { assertEquals(code,e.code) } }
    @Test fun api08AndExplicitGrantRequiredAndRevocationSurvivesReload() {
        val f=fixture(); assertTrue(f.manifest.capabilities.single().explicitOptIn)
        val m=JSONObject(f.files.getValue("manifest.json").toString(Charsets.UTF_8))
        m.put("constructApi",JSONObject().put("min","0.7.0").put("target","0.7.0"))
        denied("API_INCOMPATIBLE") { Packages.manifest(m.toString().toByteArray()) }
        store.install(f);val installed=store.installed().single()
        denied("CAPABILITY_DENIED") { SkyActivity.open(app,store,installed,JSONObject().put("op","open")) }
        store.setCapability(installed.manifest.id,"sky.watch",true)
        store.withCapability(installed,"sky.watch") { }
        store.setCapability(installed.manifest.id,"sky.watch",false);store=ModuleStore(app)
        denied("CAPABILITY_DENIED") { store.withCapability(store.installed().single(),"sky.watch") { fail() } }
    }
    @Test fun keyboardAreaSubmissionCannotInvalidateAnInFlightRefresh() {
        store.install(fixture())
        val installed=store.installed().single()
        store.setCapability(installed.manifest.id,"sky.watch",true)
        val activity=Robolectric.buildActivity(SkyActivity::class.java).get()
        fun field(name: String,value: Any) { SkyActivity::class.java.getDeclaredField(name).apply { isAccessible=true }.set(activity,value) }
        fun call(name: String,type: Class<*>,value: Any) { SkyActivity::class.java.getDeclaredMethod(name,type).apply { isAccessible=true }.invoke(activity,value) }
        field("store",store); field("installed",installed); field("generation",7)
        val original=SkyPoint(50.0,8.0)
        call("setCenter",SkyPoint::class.java,original)
        call("setBusy",Boolean::class.javaPrimitiveType!!,true)
        call("setLatText",String::class.java,"51.0"); call("setLonText",String::class.java,"9.0")
        SkyActivity::class.java.getDeclaredMethod("enterArea").apply { isAccessible=true }.invoke(activity)
        assertEquals(7,SkyActivity::class.java.getDeclaredField("generation").apply { isAccessible=true }.getInt(activity))
        assertEquals(original,SkyActivity::class.java.getDeclaredMethod("getCenter").apply { isAccessible=true }.invoke(activity))
        assertFalse(activity.isFinishing)
    }
    @Test fun callerCannotSupplyCoordinatesUrlsOrTriggerLocation() {
        SkyActivity.validate(JSONObject().put("op","open"))
        for(bad in listOf(JSONObject(),JSONObject().put("op","locate"),JSONObject().put("op","open").put("url","https://example.org"),JSONObject().put("op","open").put("latitude",50))) {
            denied("INVALID_PARAMS") { SkyActivity.validate(bad) }
        }
    }
    @Test fun networkChecksGrantBeforeAnyConnectionAndAfterClose() {
        var calls=0
        val network=SkyNetwork(app) { calls++; throw ConstructError("CAPABILITY_DENIED","Denied") }
        val result=network.fetch(SkySource.ADSB,SkyPoint(50.0,8.0),25)
        assertFalse(result.ok);assertEquals(1,calls);assertTrue(result.aircraft.isEmpty())
        denied("CAPABILITY_DENIED") { network.tile(8,134,86) }
        denied("CAPABILITY_DENIED") { network.lookup(SkyLookupRequest("abc123",null)) }
        network.close();val before=calls
        assertFalse(network.fetch(SkySource.OPENSKY,SkyPoint(50.0,8.0),25).ok)
        denied("SKY_CLOSED") { network.lookup(SkyLookupRequest("abc123",null)) }
        denied("SKY_CLOSED") { network.tile(8,134,86) }; assertEquals(before,calls)
    }
}
