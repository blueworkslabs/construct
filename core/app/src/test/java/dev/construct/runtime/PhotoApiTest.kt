package dev.construct.runtime

import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class PhotoApiTest {
    private fun denied(code: String, action: () -> Unit) { try { action(); fail("Expected $code") } catch (e: ConstructError) { assertEquals(code, e.code) } }
    private fun manifest(vararg caps: String, api: String = "0.11.0"): ByteArray = JSONObject().put("schemaVersion", 1)
        .put("id", "dev.construct.test").put("name", "Photo test").put("version", "0.2.0")
        .put("entry", "index.html").put("runtime", JSONObject().put("kind", "webview-js"))
        .put("constructApi", JSONObject().put("min", api).put("target", api))
        .put("capabilities", JSONArray().also { a -> caps.forEach { a.put(JSONObject().put("id", it).put("reason", "Test").put("optional", true)) } })
        .toString().toByteArray()
    @Test fun freshPhotoAuthorityRequiresApi11AndPixelsDependencyEvenWhenOptional() {
        for (cap in listOf("camera.photo", "photos.library", "image.analyze")) {
            denied("API_INCOMPATIBLE") { Packages.manifest(manifest(cap, "image.read", api = "0.10.0")) }
            assertTrue(Packages.manifest(manifest(cap, "image.read")).capabilities.all { it.explicitOptIn })
        }
        for (cap in listOf("photos.library", "image.analyze")) {
            denied("MANIFEST_SCHEMA") { Packages.manifest(manifest(cap)) }
            assertEquals(2, Packages.manifest(manifest("image.read", cap)).capabilities.size)
        }
        assertEquals(1, Packages.manifest(manifest("camera.photo")).capabilities.size)
    }
    @Test fun opaqueRefsAreRunScopedAndInvalidatedOnRefreshWithoutExposingPaths() {
        val a = PhotoReferences(); val b = PhotoReferences()
        val file = File("/private/other-module/original.jpg")
        val ref = a.replace(listOf(file)).single()
        assertFalse(ref.contains("original")); assertFalse(ref.contains("private")); assertEquals(file, a.get(ref))
        for (candidate in listOf(ref, file.path, "../original.jpg")) denied("PHOTO_STALE") { b.get(candidate) }
        a.replace(listOf(file)); denied("PHOTO_STALE") { a.get(ref) }
        val last = a.replace(listOf(file)).single(); a.clear(); denied("PHOTO_STALE") { a.get(last) }
        denied("PHOTO_QUOTA") { a.replace(List(9) { file }) }
    }
    @Test fun newLocalInferenceChecksBothGrantsAndRejectsStaleOrCallerDefinedModels() {
        val app = RuntimeEnvironment.getApplication()
        val checked = mutableListOf<String>()
        val gated = ModuleImageSession(app, "https://test.construct.invalid", {
            checked.add(it); if (it == "image.analyze") throw ConstructError("CAPABILITY_DENIED", "Off")
        }, {})
        denied("CAPABILITY_DENIED") { gated.request("image.analyze", JSONObject("{op:detect,handle:fake,kind:faces}")) { _, _ -> fail() } }
        assertEquals(listOf("image.read", "image.analyze"), checked)
        val allowed = ModuleImageSession(app, "https://test.construct.invalid", {}, {})
        for (args in listOf("{op:detect,handle:x,kind:identity}", "{op:detect,handle:x,kind:faces,model:other}", "{op:detect,handle:x,kind:objects,path:'/etc/file'}")) {
            denied("IMAGE_PARAMS") { allowed.request("image.analyze", JSONObject(args)) { _, _ -> fail() } }
        }
        denied("IMAGE_STALE") { allowed.request("image.analyze", JSONObject("{op:detect,handle:fake,kind:faces}")) { _, _ -> fail() } }
        allowed.close()
        denied("RUN_STALE") { allowed.openPhoto({ fail("Must not read a closed photo"); ByteArray(0) }) { _, _ -> fail() } }
    }
    @Test fun captureRequestCannotImpersonateShutterOrSupplyStoragePath() {
        PhotoCaptureActivity.validate(JSONObject().put("op", "capture"))
        for (args in listOf("{op:shoot}", "{op:capture,shutter:true}", "{op:capture,path:'/private/photo.jpg'}", "{op:capture,background:true}")) {
            denied("CAMERA_PARAMS") { PhotoCaptureActivity.validate(JSONObject(args)) }
        }
    }
    @Test fun libraryCannotListOrConfirmUsingOldCameraGrant() {
        val app = RuntimeEnvironment.getApplication()
        val images = ModuleImageSession(app, "https://test.construct.invalid", {}, {})
        var read = false; var confirmed = false
        val library = ModulePhotoLibrary(app, "dev.construct.test", images,
            { if (it != "camera.capture") throw ConstructError("CAPABILITY_DENIED", "Off") }, { read = true }, { _, _, _ -> confirmed = true })
        for (op in listOf("list", "open", "delete", "export")) denied("CAPABILITY_DENIED") {
            library.request(JSONObject().put("op", op)) { _, _ -> fail() }
        }
        assertFalse(read); assertFalse(confirmed)
    }
}
