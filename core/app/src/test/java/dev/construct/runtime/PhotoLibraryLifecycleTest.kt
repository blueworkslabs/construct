package dev.construct.runtime

import android.graphics.Bitmap
import android.os.Looper
import java.io.File
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
class PhotoLibraryLifecycleTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private lateinit var file: File
    private lateinit var library: ModulePhotoLibrary
    private var allowed = true
    private var confirmation: ((Boolean) -> Unit)? = null
    private var reply: JSONObject? = null
    private var error: ConstructError? = null
    @Before fun setup() {
        app.filesDir.listFiles()?.forEach { it.deleteRecursively() }
        val temp = File.createTempFile("photo-", ".jpg", app.cacheDir)
        val bitmap = Bitmap.createBitmap(32, 24, Bitmap.Config.ARGB_8888)
        temp.outputStream().use { bitmap.compress(Bitmap.CompressFormat.JPEG, 85, it) }; bitmap.recycle()
        file = CameraPhotos(app, "dev.construct.test").commit(temp) { }
        val authorize: (String) -> Unit = { checkRule(allowed, "CAPABILITY_DENIED", "Revoked") }
        val images = ModuleImageSession(app, "https://test.construct.invalid", authorize, {})
        library = ModulePhotoLibrary(app, "dev.construct.test", images, authorize,
            { action -> authorize("photos.library"); action() }, { _, preview, done ->
                assertTrue(preview.width in 1..320); confirmation = done
            })
    }
    private fun until(condition: () -> Boolean) {
        val end = System.nanoTime() + 5_000_000_000L
        while (!condition() && System.nanoTime() < end) { shadowOf(Looper.getMainLooper()).idle(); Thread.sleep(10) }
        assertTrue("Photo worker did not settle", condition())
    }
    private fun request(value: JSONObject) {
        reply = null; error = null
        library.request(value) { r, e -> reply = r; error = e }
    }
    private fun prompt() {
        request(JSONObject().put("op", "list")); until { reply != null || error != null }; assertNull(error)
        val ref = reply!!.getJSONArray("photos").getJSONObject(0).getString("ref")
        request(JSONObject().put("op", "delete").put("ref", ref)); until { confirmation != null || error != null }
        assertNull(error); assertNotNull(confirmation); assertTrue(file.exists())
    }
    @Test fun revocationWhileConfirmationIsOpenCannotDeleteTheOriginal() {
        prompt(); val bytes = file.readBytes(); allowed = false; confirmation!!(true)
        until { error != null }; assertEquals("CAPABILITY_DENIED", error!!.code)
        assertArrayEquals(bytes, file.readBytes()); library.close()
    }
    @Test fun closeInvalidatesLateConfirmationAndDoesNotReviveTheRequest() {
        prompt(); val bytes = file.readBytes(); library.close()
        assertEquals("PHOTO_CANCELLED", error!!.code); confirmation!!(true)
        shadowOf(Looper.getMainLooper()).idle(); assertNull(reply); assertArrayEquals(bytes, file.readBytes())
    }
    @Test fun declinePreservesBytesAndCallerCannotSupplyApprovalFlag() {
        prompt(); val bytes = file.readBytes(); confirmation!!(false)
        assertFalse(reply!!.getBoolean("completed")); assertArrayEquals(bytes, file.readBytes())
        try {
            request(JSONObject().put("op", "delete").put("ref", "anything").put("confirmed", true))
            fail("Caller-controlled approval accepted")
        } catch (e: ConstructError) { assertEquals("PHOTO_PARAMS", e.code) }
        library.close()
    }
}
