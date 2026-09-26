package dev.construct.runtime

import android.graphics.Bitmap
import android.os.Looper
import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class PhotoIdentityTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private val module = "dev.construct.aime"
    private val folder get() = File(app.filesDir, "camera-photos/$module")
    private val key get() = File(folder, ".identity-key")
    private var allowed = true
    private val bytes: ByteArray by lazy {
        val bitmap = Bitmap.createBitmap(32, 24, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(android.graphics.Color.BLUE)
        java.io.ByteArrayOutputStream().also { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it); bitmap.recycle() }.toByteArray()
    }
    @Before fun setup() { app.filesDir.listFiles()?.forEach { it.deleteRecursively() }; allowed = true }

    /** Every capture uses identical pixels, so distinct IDs cannot come from content. */
    private fun capture(id: String = module): File =
        CameraPhotos(app, id).commit(File.createTempFile("capture-", ".jpg", app.cacheDir).apply { writeBytes(bytes) }) { }
    private fun library(stableIds: Boolean, id: String = module) = ModulePhotoLibrary(app, id,
        ModuleImageSession(app, "https://test.construct.invalid", { checkRule(allowed, "CAPABILITY_DENIED", "Revoked") }, {}),
        { checkRule(allowed, "CAPABILITY_DENIED", "Revoked") }, { action -> action() }, { _, _, done -> done(true) }, stableIds)
    private fun call(library: ModulePhotoLibrary, args: JSONObject): Pair<JSONObject?, ConstructError?> {
        var result: Pair<JSONObject?, ConstructError?>? = null
        library.request(args) { value, error -> result = value to error }
        val end = System.nanoTime() + 5_000_000_000L
        while (result == null && System.nanoTime() < end) { shadowOf(Looper.getMainLooper()).idle(); Thread.sleep(10) }
        return result ?: throw AssertionError("Photo worker did not settle")
    }
    private fun list(library: ModulePhotoLibrary): JSONArray {
        val (value, error) = call(library, JSONObject().put("op", "list"))
        assertNull(error); assertEquals(CameraPhotos.MAX_PHOTOS, value!!.getInt("limit"))
        return value.getJSONArray("photos")
    }
    private fun ids(stableIds: Boolean = true, id: String = module): List<String> {
        val lib = library(stableIds, id)
        return try { list(lib).let { a -> (0 until a.length()).map { a.getJSONObject(it).getString("id") } } } finally { lib.close() }
    }
    private fun denied(code: String, action: () -> Unit) { try { action(); fail("Expected $code") } catch (e: ConstructError) { assertEquals(code, e.code) } }

    @Test fun legacyPhotosAreBackfilledOnFirst012ListAnd011ShapeIsUnchanged() {
        val originals = List(3) { capture() }
        val legacy = library(stableIds = false)
        val entries = list(legacy); legacy.close()
        assertEquals(3, entries.length())
        for (n in 0 until entries.length()) assertEquals(setOf("ref"), entries.getJSONObject(n).keys().asSequence().toSet())
        assertFalse("0.11 listing must not allocate identity", key.exists())

        val first = ids()
        assertTrue(key.isFile)
        assertEquals(3, first.toSet().size)
        for (id in first) {
            assertTrue(id, id.length in 1..80 && id.all { it.code in 0x21..0x7e })
            originals.forEach { assertFalse(id.contains(it.nameWithoutExtension)); assertFalse(id.contains(it.name)) }
        }
        originals.forEach { assertArrayEquals(bytes, it.readBytes()) }
    }

    @Test fun idsSurviveRefreshRestartAndModuleUpdateOrRollbackWhileRefsRotate() {
        repeat(2) { capture() }
        val lib = library(stableIds = true)
        val a = list(lib); val b = list(lib); lib.close()
        val ids = (0 until 2).map { a.getJSONObject(it).getString("id") }
        assertEquals(ids, (0 until 2).map { b.getJSONObject(it).getString("id") })
        assertNotEquals(a.getJSONObject(0).getString("ref"), b.getJSONObject(0).getString("ref"))
        // New instances model process restart; 0.11 -> 0.12 -> 0.11 -> 0.12 models update/rollback.
        assertEquals(ids, ids())
        library(stableIds = false).let { assertFalse(list(it).getJSONObject(0).has("id")); it.close() }
        assertEquals(ids, ids())
    }

    @Test fun identicalCapturesGetDistinctIdsAndDeletedIdsAreNeverReissued() {
        repeat(2) { capture() }
        val seen = ids().toMutableSet()
        assertEquals(2, seen.size)
        val photos = CameraPhotos(app, module)
        photos.delete(photos.list().first())
        val survivor = ids(); assertEquals(1, survivor.size); assertTrue(survivor.single() in seen)
        capture()
        val after = ids(); assertEquals(2, after.size)
        assertFalse("Recapture reused a retired ID", (after - survivor.toSet()).single() in seen)
        seen += after
        photos.deleteAll()
        assertTrue(ids().isEmpty())
        capture(); capture()
        assertTrue("Clear-all and recapture reused an ID", ids().none { it in seen })
    }

    @Test fun interruptedPersistenceNeverChangesPublishedIdsOrReportsEmptySuccess() {
        capture(); capture()
        val published = ids()
        // A crash between staging and rename leaves only a pending file; the next open removes it.
        File(folder, ".pending-crash").writeBytes(ByteArray(32) { 7 })
        assertEquals(published, ids())
        assertFalse(File(folder, ".pending-crash").exists())

        val saved = key.readBytes()
        key.writeBytes(saved.copyOf(12))
        val lib = library(stableIds = true)
        val (value, error) = call(lib, JSONObject().put("op", "list")); lib.close()
        assertNull("Damaged identity must fail, not list", value); assertEquals("PHOTO_FAILED", error!!.code)
        assertEquals(12L, key.length()) // never silently re-keyed
        key.writeBytes(saved)
        assertEquals(published, ids())

        key.delete(); key.mkdirs()
        val broken = library(stableIds = true)
        assertEquals("PHOTO_FAILED", call(broken, JSONObject().put("op", "list")).second!!.code); broken.close()
        CameraPhotos(app, module).list().forEach { assertArrayEquals(bytes, it.readBytes()) }
    }

    @Test fun idsAreModuleScopedAndDoNotCorrelateTheSameOriginal() {
        val original = capture()
        val mine = ids().single()
        val other = "dev.construct.other"
        val copy = File(app.filesDir, "camera-photos/$other/${original.name}")
        copy.parentFile!!.mkdirs(); original.copyTo(copy)
        val theirs = ids(id = other).single()
        assertNotEquals("Same filename and bytes must not correlate across modules", mine, theirs)
        assertEquals(listOf(mine), ids())
        assertTrue(ids(id = "dev.construct.empty").isEmpty())
        assertFalse(File(app.filesDir, "camera-photos/dev.construct.empty/.identity-key").exists())
    }

    @Test fun deniedOrRevokedListingAllocatesAndPublishesNothing() {
        capture()
        allowed = false
        denied("CAPABILITY_DENIED") { library(stableIds = true).request(JSONObject().put("op", "list")) { _, _ -> fail() } }
        assertFalse("Denied listing allocated identity", key.exists())
        allowed = true
        val lib = library(stableIds = true)
        var result: Pair<JSONObject?, ConstructError?>? = null
        lib.request(JSONObject().put("op", "list")) { value, error -> result = value to error }
        allowed = false
        val end = System.nanoTime() + 5_000_000_000L
        while (result == null && System.nanoTime() < end) { shadowOf(Looper.getMainLooper()).idle(); Thread.sleep(10) }
        assertNull(result!!.first); assertEquals("CAPABILITY_DENIED", result!!.second!!.code)
        lib.close()
    }

    @Test fun stableIdIsNeverAcceptedAsAuthority() {
        capture()
        val lib = library(stableIds = true)
        val entry = list(lib).getJSONObject(0)
        val id = entry.getString("id"); val ref = entry.getString("ref")
        for (op in listOf("open", "delete", "export")) {
            denied("PHOTO_STALE") { lib.request(JSONObject().put("op", op).put("ref", id)) { _, _ -> fail() } }
            denied("PHOTO_PARAMS") { lib.request(JSONObject().put("op", op).put("ref", ref).put("id", id)) { _, _ -> fail() } }
            denied("PHOTO_PARAMS") { lib.request(JSONObject().put("op", op).put("id", id)) { _, _ -> fail() } }
        }
        denied("PHOTO_PARAMS") { lib.request(JSONObject().put("op", "list").put("id", id)) { _, _ -> fail() } }
        lib.close()
        assertEquals(1, CameraPhotos(app, module).list().size)
    }

    @Test fun api012IsAcceptedForPhotoModulesButNotForRetiredCapabilities() {
        fun manifest(api: String, vararg caps: String) = JSONObject().put("schemaVersion", 1)
            .put("id", module).put("name", "Aimé").put("version", "0.1.0")
            .put("entry", "index.html").put("runtime", JSONObject().put("kind", "webview-js"))
            .put("constructApi", JSONObject().put("min", api).put("target", api))
            .put("capabilities", JSONArray().also { a -> caps.forEach { a.put(JSONObject().put("id", it).put("reason", "Test").put("optional", true)) } })
            .toString().toByteArray()
        val m = Packages.manifest(manifest("0.12.0", "camera.photo", "image.read", "photos.library", "location.read"))
        assertEquals("0.12.0", m.api)
        for (retired in listOf("camera.capture", "photo.measure", "sky.watch"))
            denied("API_INCOMPATIBLE") { Packages.manifest(manifest("0.12.0", retired)) }
        denied("API_INCOMPATIBLE") { Packages.manifest(JSONObject(String(manifest("0.12.0", "image.read"))).apply {
            put("constructApi", JSONObject().put("min", "0.11.0").put("target", "0.12.0")) }.toString().toByteArray()) }
    }
}
