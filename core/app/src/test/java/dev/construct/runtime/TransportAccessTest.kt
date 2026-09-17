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
    private fun httpConsentCleared() {
        val record = JSONObject(File(app.filesDir, "module-state.json").readText()).getJSONObject(id)
        assertFalse(record.getJSONObject("grants").optBoolean("net.http"))
        assertEquals(0, record.getJSONArray("httpOrigins").length())
        assertFalse("net.http" in store.installed().single().granted)
        denied("CAPABILITY_DENIED") { allowed("net.http") }
    }
    @Test fun removedHttpCannotReturnWithoutFreshConsentAfterRestart() {
        store.install(fixture("0.1.0"), mapOf("net.http" to true, "location.read" to true)); store.confirm(id)
        store.storage(id, JSONObject().put("op", "set").put("key", "counter").put("value", 7))
        store.install(fixture("0.3.0")); store.confirm(id); store = ModuleStore(app)
        httpConsentCleared()
        assertTrue(allowed("location.read"))
        store.install(fixture("0.4.0")); store = ModuleStore(app)
        httpConsentCleared()
        assertTrue(allowed("location.read"))
        assertEquals(7, store.storage(id, JSONObject().put("op", "get").put("key", "counter")))
        store.setCapability(id, "net.http", true)
        assertTrue(allowed("net.http"))
    }
    @Test fun rollingBackRemovalDoesNotRestoreHttpConsent() {
        store.install(fixture("0.1.0"), mapOf("net.http" to true)); store.confirm(id)
        store.install(fixture("0.3.0")); store.rollback(id); store = ModuleStore(app)
        httpConsentCleared()
    }
    @Test fun rollbackToVersionWithoutHttpClearsConsentBeforeReinstall() {
        store.install(fixture("0.3.0")); store.confirm(id)
        store.install(fixture("0.4.0"), mapOf("net.http" to true))
        assertTrue(allowed("net.http"))
        store.rollback(id); store = ModuleStore(app)
        httpConsentCleared()
        store.install(fixture("0.4.0"))
        httpConsentCleared()
    }
    @Test fun staleConsentFromOlderHostCannotReactivateHttp() {
        store.install(fixture("0.3.0")); store.confirm(id)
        // Alpha26 could retain this state after installing a version without HTTP.
        val file = File(app.filesDir, "module-state.json")
        val state = JSONObject(file.readText())
        state.getJSONObject(id).getJSONObject("grants").put("net.http", true)
        state.getJSONObject(id).put("httpOrigins", org.json.JSONArray().put("https://example.org"))
        file.writeText(state.toString()); store = ModuleStore(app)
        store.install(fixture("0.4.0"))
        assertFalse("net.http" in store.installed().single().granted)
        denied("CAPABILITY_DENIED") { allowed("net.http") }
    }
    @Test fun staleConsentFromOlderHostCannotReactivateHttpThroughRollback() {
        store.install(fixture("0.1.0"), mapOf("net.http" to true)); store.confirm(id)
        store.install(fixture("0.3.0"))
        val file = File(app.filesDir, "module-state.json")
        val state = JSONObject(file.readText())
        state.getJSONObject(id).getJSONObject("grants").put("net.http", true)
        state.getJSONObject(id).put("httpOrigins", org.json.JSONArray().put("https://example.org"))
        file.writeText(state.toString()); store = ModuleStore(app)
        store.rollback(id)
        httpConsentCleared()
    }
    @Test fun explicitConsentOnReintroductionWorksAndUnchangedScopeStaysGranted() {
        store.install(fixture("0.1.0"), mapOf("net.http" to true)); store.confirm(id)
        store.install(fixture("0.4.0")); assertTrue(allowed("net.http")); store.confirm(id)
        store.install(fixture("0.3.0")); store.confirm(id)
        store.install(fixture("0.4.0"), mapOf("net.http" to true)); store = ModuleStore(app)
        assertTrue(allowed("net.http"))
    }
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
    private fun storedOrigins(): Set<String> {
        val origins = JSONObject(File(app.filesDir, "module-state.json").readText()).getJSONObject(id).getJSONArray("httpOrigins")
        return (0 until origins.length()).map { origins.getString(it) }.toSet()
    }
    private fun restoreStaleWideScope() {
        // Older hosts retained both origins while the active manifest declared only A.
        val file = File(app.filesDir, "module-state.json")
        val state = JSONObject(file.readText())
        state.getJSONObject(id).put("httpOrigins", org.json.JSONArray(listOf("https://example.org", "https://www.example.org")))
        file.writeText(state.toString()); store = ModuleStore(app)
    }
    @Test fun unchangedEnabledSwitchStillNarrowsConsentBeforeRollback() {
        store.install(fixture("0.2.0"), mapOf("net.http" to true, "location.read" to true)); store.confirm(id)
        store.storage(id, JSONObject().put("op", "set").put("key", "counter").put("value", 7))
        // The install dialog's switch stays on: no explicit consentChanges entry.
        store.install(fixture("0.1.0")); store = ModuleStore(app)
        assertTrue(allowed("net.http"))
        assertEquals(setOf("https://example.org"), storedOrigins())
        store.rollback(id); store = ModuleStore(app)
        denied("CAPABILITY_DENIED") { allowed("net.http") }
        assertFalse("net.http" in store.installed().single().granted)
        assertTrue(allowed("location.read"))
        assertEquals(7, store.storage(id, JSONObject().put("op", "get").put("key", "counter")))
        store.setCapability(id, "net.http", true)
        assertTrue(allowed("net.http"))
    }
    @Test fun rollbackToNarrowerVersionAlsoForgetsRemovedOrigins() {
        store.install(fixture("0.1.0"), mapOf("net.http" to true)); store.confirm(id)
        store.install(fixture("0.2.0"), mapOf("net.http" to true))
        store.rollback(id); store = ModuleStore(app)
        assertTrue(allowed("net.http"))
        assertEquals(setOf("https://example.org"), storedOrigins())
        store.install(fixture("0.2.0"))
        denied("CAPABILITY_DENIED") { allowed("net.http") }
    }
    @Test fun staleWiderScopeCannotBeReusedWhenUpdating() {
        store.install(fixture("0.1.0"), mapOf("net.http" to true)); store.confirm(id)
        restoreStaleWideScope()
        store.install(fixture("0.2.0"))
        denied("CAPABILITY_DENIED") { allowed("net.http") }
        assertEquals(setOf("https://example.org"), storedOrigins())
    }
    @Test fun staleWiderScopeCannotBeReusedWhenRollingBack() {
        store.install(fixture("0.2.0"), mapOf("net.http" to true)); store.confirm(id)
        store.install(fixture("0.1.0"))
        restoreStaleWideScope()
        store.rollback(id)
        denied("CAPABILITY_DENIED") { allowed("net.http") }
        assertEquals(setOf("https://example.org"), storedOrigins())
    }
    @Test fun explicitDenialSurvivesRollback() {
        store.install(fixture("0.1.0"),mapOf("net.http" to true));store.confirm(id)
        store.install(fixture("0.2.0"),mapOf("net.http" to false));store.rollback(id)
        denied("CAPABILITY_DENIED") { allowed("net.http") }

    }
    @Test fun httpChecksAuthorizationBeforeAnyNetworkAndAfterClose() {
        val m=fixture("0.1.0").manifest;var checks=0
        val http=ModuleHttp(app,m) { checks++; throw ConstructError("CAPABILITY_DENIED","Denied") }
        val p=JSONObject().put("op","get").put("url","https://example.org/data").put("format","json")
        denied("CAPABILITY_DENIED") { http.get(p) { _,_->fail() } }; assertEquals(1,checks)
        http.close();denied("RUN_STALE") { http.get(p) { _,_->fail() } };assertEquals(1,checks)
    }
}
