package dev.construct.runtime

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RuntimeEnvironment
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[28])
class TransportAccessTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private lateinit var store: ModuleStore
    private val id = "dev.construct.transport-probe"
    @Before fun setup() { app.filesDir.listFiles()?.forEach { it.deleteRecursively() }; store = ModuleStore(app) }
    private fun fixture(version: String): VerifiedPackage {
        val dir=File(System.getProperty("construct.fixtureRoot"), "transport-registry")
        val entry=Packages.catalog(File(dir,"index.json").readBytes()).single { it.version == version }
        return Packages.verify(File(dir,entry.artifact).readBytes(),entry,store.publicKey)
    }
    private fun denied(code: String, action: () -> Unit) {
        try { action(); fail("Expected $code") } catch(e: ConstructError) { assertEquals(code,e.code) }
    }
    private fun allowed(cap: String) = store.withCapability(store.installed().single(), cap) { true }
    @Test fun newAuthorityDefaultsOffAndLocationIsIndependent() {
        store.install(fixture("0.1.0"))
        denied("CAPABILITY_DENIED") { allowed("net.http") }; denied("CAPABILITY_DENIED") { allowed("location.read") }
        store.setCapability(id,"net.http",true)
        assertTrue(allowed("net.http")); denied("CAPABILITY_DENIED") { allowed("location.read") }
        store=ModuleStore(app); assertTrue(allowed("net.http"))
        store.setCapability(id,"net.http",false); store=ModuleStore(app)
        denied("CAPABILITY_DENIED") { allowed("net.http") }
    }
    @Test fun scopeExpansionCannotReuseOldConsentAndOldInstalledHandleBecomesStale() {
        store.install(fixture("0.1.0"), mapOf("net.http" to true)); store.confirm(id)
        val old=store.installed().single()
        store.install(fixture("0.2.0")); store=ModuleStore(app)
        denied("CAPABILITY_DENIED") { allowed("net.http") }
        denied("RUN_STALE") { store.withCapability(old,"net.http") { fail() } }
        store.setCapability(id,"net.http",true); assertTrue(allowed("net.http"))
        store.rollback(id); assertTrue(allowed("net.http"))
    }
    @Test fun narrowedConsentDoesNotExpandAgainOnRollbackAndDataSurvives() {
        store.install(fixture("0.2.0"), mapOf("net.http" to true)); store.confirm(id)
        store.storage(id,JSONObject().put("op","set").put("key","counter").put("value",7))
        store.install(fixture("0.1.0"), mapOf("net.http" to true))
        assertTrue(allowed("net.http")); store.rollback(id)
        denied("CAPABILITY_DENIED") { allowed("net.http") }
        assertEquals(7,store.storage(id,JSONObject().put("op","get").put("key","counter")))
    }
    @Test fun explicitDenialSurvivesRollbackAndLegacyLauncherCannotGrantNewApis() {
        store.install(fixture("0.1.0"),mapOf("net.http" to true));store.confirm(id)
        store.install(fixture("0.2.0"),mapOf("net.http" to false));store.rollback(id)
        denied("CAPABILITY_DENIED") { allowed("net.http") }
        val dir=File(System.getProperty("construct.fixtureRoot"),"sky-legacy-registry")
        val entry=Packages.catalog(File(dir,"index.json").readBytes()).single()
        store.install(Packages.verify(File(dir,entry.artifact).readBytes(),entry,store.publicKey),mapOf("sky.watch" to true))
        val sky=store.installed().single { it.manifest.id==entry.id };store.confirm(entry.id)
        val nextDir=File(System.getProperty("construct.fixtureRoot"),"home-registry")
        val next=Packages.catalog(File(nextDir,"index.json").readBytes()).single { it.id==entry.id }
        store.install(Packages.verify(File(nextDir,next.artifact).readBytes(),next,store.publicKey))
        val updated=store.installed().single { it.manifest.id==entry.id }
        assertFalse("net.http" in updated.granted);assertFalse("location.read" in updated.granted)
        denied("RUN_STALE") { store.withCapability(sky,"sky.watch") { fail() } }
    }
    @Test fun httpChecksAuthorizationBeforeAnyNetworkAndAfterClose() {
        val m=fixture("0.1.0").manifest;var checks=0
        val http=ModuleHttp(app,m) { checks++; throw ConstructError("CAPABILITY_DENIED","Denied") }
        val p=JSONObject().put("op","get").put("url","https://example.org/data").put("format","json")
        denied("CAPABILITY_DENIED") { http.get(p) { _,_->fail() } }; assertEquals(1,checks)
        http.close();denied("RUN_STALE") { http.get(p) { _,_->fail() } };assertEquals(1,checks)
    }
}
