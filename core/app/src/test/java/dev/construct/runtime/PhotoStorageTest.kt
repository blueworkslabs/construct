package dev.construct.runtime

import android.graphics.Bitmap
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

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
@org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE)
class PhotoStorageTest {
    private val app get() = RuntimeEnvironment.getApplication()
    private lateinit var photos: CameraPhotos
    private lateinit var store: ModuleStore
    @Before fun setup() {
        app.filesDir.listFiles()?.forEach { it.deleteRecursively() }
        photos = CameraPhotos(app, "dev.construct.camera")
        store = ModuleStore(app)
        shadowOf(app).denyPermissions(android.Manifest.permission.CAMERA)
    }
    private fun jpeg(): File {
        val f = File.createTempFile("synthetic-", ".jpg", app.cacheDir)
        val b = Bitmap.createBitmap(32, 24, Bitmap.Config.ARGB_8888)
        b.eraseColor(android.graphics.Color.GREEN)
        f.outputStream().use { b.compress(Bitmap.CompressFormat.JPEG, 85, it) }; b.recycle()
        return f
    }
    private fun denied(code: String, action: () -> Unit) {
        try { action(); fail("Expected $code") } catch (e: ConstructError) { assertEquals(code, e.code) }
    }
    @Test fun privatePhotosSurviveReopenAndStayModuleScoped() {
        val temp = jpeg(); val original = temp.readBytes(); var checked = false
        val file = photos.commit(temp) { checked = true }
        assertTrue(checked); assertFalse(temp.exists()); assertArrayEquals(original, file.readBytes())
        assertEquals(listOf(file), CameraPhotos(app, "dev.construct.camera").list())
        assertTrue(CameraPhotos(app, "dev.construct.other").list().isEmpty())
        denied("CAMERA_STORAGE") { CameraPhotos(app, "dev.construct.other").delete(file) }
        photos.delete(file); assertTrue(photos.list().isEmpty())
    }
    @Test fun nativeExportReadRejectsOtherModuleAndDeletedPhotos() {
        val original = photos.commit(jpeg()) { }
        val bytes = original.readBytes()
        photos.readSelected(original) { input, size ->
            assertEquals(bytes.size.toLong(), size); assertArrayEquals(bytes, input.readBytes())
        }
        assertArrayEquals(bytes, original.readBytes())
        denied("CAMERA_STORAGE") { CameraPhotos(app, "dev.construct.other").readSelected(original) { _, _ -> fail("Cross-module read") } }
        photos.delete(original)
        denied("CAMERA_STORAGE") { photos.readSelected(original) { _, _ -> fail("Deleted photo read") } }
    }
    @Test fun revokedOrClosedAtFinalCommitPublishesNothing() {
        for (code in listOf("CAPABILITY_DENIED", "ANDROID_PERMISSION_DENIED", "CAMERA_CLOSED")) {
            val temp = jpeg()
            denied(code) { photos.commit(temp) { throw ConstructError(code, "test") } }
            assertFalse(temp.exists()); assertTrue(photos.list().isEmpty())
            assertTrue(File(app.filesDir, "camera-photos/dev.construct.camera").listFiles().orEmpty().isEmpty())
        }
    }
    @Test fun finalPublicationGuardCanRejectWithoutCreatingAPhoto() {
        val temp=jpeg()
        denied("CAPABILITY_DENIED") { photos.commit(temp, publish = { throw ConstructError("CAPABILITY_DENIED","revoked") }) { fail("Rejected guard must not commit") } }
        assertFalse(temp.exists()); assertTrue(photos.list().isEmpty())
    }
    @Test fun countQuotaAndDeletionRecoveryAreBounded() {
        repeat(CameraPhotos.MAX_PHOTOS) { photos.commit(jpeg()) { } }
        denied("CAMERA_QUOTA") { photos.reserve() }
        photos.delete(photos.list().first()); photos.reserve(); photos.commit(jpeg()) { }
        photos.deleteAll(); assertTrue(photos.list().isEmpty()); photos.reserve()
    }
    @Test fun rejectInvalidImagesAndOversizeWithoutPublishing() {
        val bad = File.createTempFile("bad-", ".jpg", app.cacheDir).apply { writeText("not a photo") }
        denied("CAMERA_IMAGE") { photos.commit(bad) { fail("Invalid image reached authorization") } }
        val huge = File.createTempFile("large-", ".jpg", app.cacheDir)
        java.io.RandomAccessFile(huge, "rw").use { it.setLength(CameraPhotos.MAX_FILE + 1) }
        denied("CAMERA_IMAGE") { photos.commit(huge) { fail("Oversize reached authorization") } }
        assertTrue(photos.list().isEmpty()); bad.delete(); huge.delete()
    }
    @Test fun byteQuotasIncludeOtherModulesAndInterruptedStagesAreCleaned() {
        val folder = File(app.filesDir, "camera-photos/dev.construct.camera").apply { mkdirs() }
        repeat(5) { val f=File(folder, java.util.UUID.randomUUID().toString()+".jpg"); java.io.RandomAccessFile(f,"rw").use { it.setLength(CameraPhotos.MAX_FILE) } }
        denied("CAMERA_QUOTA") { photos.reserve() }
        photos.deleteAll()
        val other=File(app.filesDir,"camera-photos/dev.construct.other").apply { mkdirs() }
        repeat(16) { val f=File(other,java.util.UUID.randomUUID().toString()+".jpg"); java.io.RandomAccessFile(f,"rw").use { it.setLength(CameraPhotos.MAX_FILE) } }
        denied("CAMERA_QUOTA") { photos.reserve() }
        File(folder,".pending-interrupted").writeText("partial")
        CameraPhotos(app,"dev.construct.camera")
        assertFalse(File(folder,".pending-interrupted").exists())
    }
    @Test fun trustedPlatformFilesAliasIsResolvedBeforeModulePathValidation() {
        val alias=File(app.cacheDir,"files-alias-"+java.util.UUID.randomUUID())
        java.nio.file.Files.createSymbolicLink(alias.toPath(),app.filesDir.toPath())
        val wrapped=object:android.content.ContextWrapper(app) { override fun getFilesDir()=alias }
        val aliased=CameraPhotos(wrapped,"dev.construct.camera")
        val saved=aliased.commit(jpeg()) { }
        assertEquals(saved, photos.list().single())
    }
    @Test fun traversalAndSymlinkStorageAreRejected() {
        denied("CAMERA_STORAGE") { CameraPhotos(app, "../escape") }
        val root = File(app.filesDir, "camera-photos").apply { mkdirs() }
        val elsewhere = File(app.filesDir, "elsewhere").apply { mkdirs() }
        java.nio.file.Files.createSymbolicLink(File(root, "dev.construct.link").toPath(), elsewhere.toPath())
        denied("CAMERA_STORAGE") { CameraPhotos(app, "dev.construct.link") }
    }
}
