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

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class CapabilityGrantTest {
    private lateinit var store: ModuleStore
    private val app get() = RuntimeEnvironment.getApplication()
    private fun tones(): List<VerifiedPackage> {
        val root = File(System.getProperty("construct.fixtureRoot"), "remote-registry")
        return Packages.catalog(File(root, "index.json").readBytes()).filter { it.id == "dev.construct.tone" }.map {
            Packages.verify(File(root, it.artifact).readBytes(), it, store.publicKey)
        }.sortedBy { it.manifest.version }
    }
    private fun denied(code: String, action: () -> Unit) {
        try { action(); fail("Expected $code") } catch (error: ConstructError) { assertEquals(code, error.code) }
    }
    @Before fun setup() {
        app.filesDir.listFiles()?.forEach { it.deleteRecursively() }
        store = ModuleStore(app)
    }
    @Test fun explicitInstallConsentIsAtomicAndAbsentChangesPreserveRevocation() {
        val versions = tones(); val id = versions.first().manifest.id
        store.install(versions.first(), mapOf("device.tone" to true))
        store.withCapability(store.installed().single(), "device.tone") { }
        store.setCapability(id, "device.tone", false); store.confirm(id)
        store.install(versions.last())
        assertFalse("device.tone" in store.installed().single().granted)
        store.rollback(id)
        store.install(versions.last(), mapOf("device.tone" to true))
        assertTrue("device.tone" in store.installed().single().granted)
    }
    @Test fun installCannotGrantUndeclaredAccess() {
        denied("CAPABILITY_DENIED") { store.install(tones().first(), mapOf("storage.kv" to true)) }
        assertTrue(store.installed().isEmpty())
    }
    @Test fun optionalManifestFlagIsPreservedAndDefaultsRequired() {
        val m = JSONObject(tones().first().files.getValue("manifest.json").toString(Charsets.UTF_8))
        assertFalse(Packages.manifest(m.toString().toByteArray()).capabilities.single().optional)
        m.getJSONArray("capabilities").getJSONObject(0).put("optional", true)
        val cap = Packages.manifest(m.toString().toByteArray()).capabilities.single()
        assertTrue(cap.optional); assertEquals("Allow short tones", cap.label)
    }
    @Test fun reportMetadataDoesNotClaimPhysicalAudioOrPolluteStoredEvents() {
        val before = store.diagnostics()
        val environment = JSONObject(store.diagnosticReport().lineSequence().last { it.isNotBlank() })
        assertEquals("ENVIRONMENT", environment.getString("code"))
        assertEquals(BuildConfig.VERSION_NAME, environment.getString("hostVersion"))
        assertEquals(android.os.Build.MODEL, environment.getString("deviceModel"))
        assertTrue(environment.has("apkSha256")); assertTrue(environment.has("webviewVersion"))
        assertFalse(environment.has("audibilityPassed"))
        assertEquals(before, store.diagnostics())
    }
    @Test fun toneStartsOffAndRevocationIsCheckedOnEveryCall() {
        store.install(tones().first())
        val module = store.installed().single()
        var effects = 0
        denied("CAPABILITY_DENIED") { store.withCapability(module, "device.tone") { effects++ } }
        store.setCapability(module.manifest.id, "device.tone", true)
        store.withCapability(module, "device.tone") { effects++ }
        store.setCapability(module.manifest.id, "device.tone", false)
        denied("CAPABILITY_DENIED") { store.withCapability(module, "device.tone") { effects++ } }
        assertEquals(1, effects)
    }
    @Test fun revokedGrantSurvivesUpdateRollbackAndHostRestart() {
        val versions = tones(); val id = versions.first().manifest.id
        store.install(versions.first()); store.setCapability(id, "device.tone", true); store.confirm(id)
        store.setCapability(id, "device.tone", false)
        store.install(versions.last())
        store = ModuleStore(app)
        assertFalse("device.tone" in store.installed().single().granted)
        store.rollback(id)
        store = ModuleStore(app)
        denied("CAPABILITY_DENIED") { store.withCapability(store.installed().single(), "device.tone") { fail("Revocation lost") } }
    }
    @Test fun staleDisabledAndFailedRunsCannotUseGrantedCapabilities() {
        val versions = tones(); val id = versions.first().manifest.id
        store.install(versions.first()); store.setCapability(id, "device.tone", true)
        val first = store.installed().single()
        store.enable(id, false)
        denied("RUN_STALE") { store.withCapability(first, "device.tone") {} }
        store.enable(id, true); store.confirm(id); store.install(versions.last())
        denied("RUN_STALE") { store.withCapability(first, "device.tone") {} }
        val second = store.installed().single()
        store.runtimeFailed(second, "RENDERER_STOPPED")
        denied("RUN_STALE") { store.withCapability(second, "device.tone") {} }
    }
    @Test fun legacyApprovalMigratesAndRevocationDoesNotResurrectOnUpdate() {
        val versions = store.catalog("demo")
        val first = store.prepare("demo", versions.first { it.version == "0.1.0" })
        store.install(first); store.confirm(first.manifest.id)
        val file = File(app.filesDir, "module-state.json")
        val state = JSONObject(file.readText()); state.getJSONObject(first.manifest.id).remove("grants"); file.writeText(state.toString())
        assertTrue("storage.kv" in store.installed().single().granted)
        store.setCapability(first.manifest.id, "storage.kv", false)
        store.install(store.prepare("demo", versions.first { it.version == "0.2.0" }))
        store.rollback(first.manifest.id)
        assertFalse("storage.kv" in store.installed().single().granted)
        assertTrue("device.toast" in store.installed().single().granted)
    }
    @Test fun grantsCannotAuthorizeUndeclaredCapabilitiesOrOtherModules() {
        store.install(tones().first())
        val tone = store.installed().single()
        store.setCapability(tone.manifest.id, "device.tone", true)
        denied("CAPABILITY_DENIED") { store.setCapability(tone.manifest.id, "storage.kv", true) }
        val hello = store.prepare("demo", store.catalog("demo").first { it.version == "0.1.0" }); store.install(hello)
        denied("CAPABILITY_DENIED") { store.withCapability(store.installed().first { it.manifest.id == hello.manifest.id }, "device.tone") {} }
    }
    @Test fun malformedGrantIsDamagedAndLegacyToneNeverDefaultsOn() {
        store.install(tones().first())
        val id = store.installed().single().manifest.id
        val file = File(app.filesDir, "module-state.json")
        val state = JSONObject(file.readText()); state.getJSONObject(id).remove("grants"); file.writeText(state.toString())
        assertFalse("device.tone" in store.installed().single().granted)
        state.getJSONObject(id).put("grants", JSONObject().put("device.tone", "true")); file.writeText(state.toString())
        assertEquals(id, store.inventory().damaged.single().id)
        assertTrue(store.installed().isEmpty())
    }
    @Test fun contactsDefaultOffAndConsentRevocationPersistWithoutAndroidPermission() {
        val root = File(System.getProperty("construct.fixtureRoot"), "contacts-registry")
        val catalog = Packages.catalog(File(root,"index.json").readBytes())
        val version = catalog.single { it.version == "0.1.0" }
        val candidate = Packages.verify(File(root,version.artifact).readBytes(),version,store.publicKey)
        store.install(candidate)
        val id=candidate.manifest.id
        denied("CAPABILITY_DENIED") { store.withCapability(store.installed().single(),"contacts.read") {} }
        store.setCapability(id,"contacts.read",true)
        store.withCapability(store.installed().single(),"contacts.read") {}
        store.setCapability(id,"contacts.read",false)
        store=ModuleStore(app)
        assertFalse("contacts.read" in store.installed().single().granted)
        store.confirm(id)
        val next = catalog.single { it.version == "0.2.0" }
        store.install(Packages.verify(File(root,next.artifact).readBytes(),next,store.publicKey))
        assertFalse("contacts.read" in store.installed().single().granted)
        store.rollback(id)
        denied("CAPABILITY_DENIED") { store.withCapability(store.installed().single(),"contacts.read") {} }
        val manifest=JSONObject(candidate.files.getValue("manifest.json").toString(Charsets.UTF_8))
        manifest.put("constructApi",JSONObject().put("min","0.2.0").put("target","0.2.0"))
        denied("API_INCOMPATIBLE") { Packages.manifest(manifest.toString().toByteArray()) }
    }
    @Test fun toneCannotClaimTheLegacyApi() {
        val manifest = JSONObject(tones().first().files.getValue("manifest.json").toString(Charsets.UTF_8))
        manifest.put("constructApi", JSONObject().put("min", "0.1.0").put("target", "0.1.0"))
        denied("API_INCOMPATIBLE") { Packages.manifest(manifest.toString().toByteArray()) }
    }
}
