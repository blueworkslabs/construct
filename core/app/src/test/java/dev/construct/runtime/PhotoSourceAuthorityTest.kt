package dev.construct.runtime

import android.graphics.Bitmap
import android.os.Looper
import java.io.ByteArrayOutputStream
import org.json.JSONObject
import org.junit.Assert.*
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
class PhotoSourceAuthorityTest {
    private fun denied(code: String, action: () -> Unit) { try { action(); fail("Expected $code") } catch (e: ConstructError) { assertEquals(code,e.code) } }
    @Test fun deliveredLibraryRasterRetainsItsSourceGrantAndStaleUrlCannotSurviveClose() {
        val granted = mutableSetOf("image.read", "photos.library", "image.analyze")
        val session = ModuleImageSession(RuntimeEnvironment.getApplication(), "https://test.construct.invalid",
            { checkRule(it in granted,"CAPABILITY_DENIED","Off") }, {})
        val bitmap=Bitmap.createBitmap(32,24,Bitmap.Config.ARGB_8888);bitmap.eraseColor(android.graphics.Color.GREEN)
        val stream=ByteArrayOutputStream();bitmap.compress(Bitmap.CompressFormat.PNG,100,stream);bitmap.recycle()
        var reply:JSONObject?=null;var error:ConstructError?=null
        session.openPhoto({stream.toByteArray()}) { r,e -> reply=r;error=e }
        val end=System.nanoTime()+5_000_000_000L
        while(reply==null&&error==null&&System.nanoTime()<end){shadowOf(Looper.getMainLooper()).idle();Thread.sleep(10)}
        if(error!=null)throw error!!
        assertNotNull("Image worker did not return",reply)
        val handle=reply!!.getString("handle");val path="construct-images/$handle.png"
        assertTrue(session.resource(path).isNotEmpty())
        granted.remove("photos.library")
        denied("CAPABILITY_DENIED"){session.resource(path)}
        denied("CAPABILITY_DENIED"){session.request("image.analyze",JSONObject().put("op","detect").put("kind","faces").put("handle",handle)){_,_->fail("Revoked source reached inference")}}
        granted.add("photos.library");session.clearPhoto();denied("IMAGE_STALE"){session.resource(path)}
        session.close();denied("RUN_STALE"){session.resource(path)}
    }
}
