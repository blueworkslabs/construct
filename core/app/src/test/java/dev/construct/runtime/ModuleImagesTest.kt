package dev.construct.runtime

import android.graphics.Bitmap
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.ByteArrayOutputStream
import java.util.Base64

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[28])
class ModuleImagesTest {
    private fun image(width: Int=1,height: Int=1): ByteArray {
        val b=Bitmap.createBitmap(width,height,Bitmap.Config.ARGB_8888)
        return ByteArrayOutputStream().also { b.compress(Bitmap.CompressFormat.PNG,100,it);b.recycle() }.toByteArray()
    }
    private fun uri(bytes: ByteArray)="data:image/png;base64,"+Base64.getEncoder().encodeToString(bytes)
    private fun rejected(code: String, action: ()->Unit) {
        try { action(); fail("Expected $code") } catch(e: ConstructError) { assertEquals(code,e.code) }
    }
    @Test fun rasterTransportBytesCanBeRenderedThroughLocalResourceFilter() {
        val bytes=image();val result=ModuleImages.dataUrl(uri(bytes))
        assertEquals("image/png",result.first);assertArrayEquals(bytes,result.second)
    }
    @Test fun activeDocumentsRemoteUrlsAndMalformedImagesStayBlocked() {
        for (bad in listOf("data:text/html;base64,PGh0bWw+", "data:image/svg+xml;base64,PHN2Zz4=", "https://example.org/a.png", "file:///a.png", "data:image/png;base64,%%%", uri("<svg>".toByteArray())))
            rejected("HTTP_DATA") { ModuleImages.dataUrl(bad) }
    }
    @Test fun encodedSizeDecodedSizeAndDimensionsAreBounded() {
        rejected("HTTP_SIZE") { ModuleImages.dataUrl("x".repeat(350001)) }
        rejected("HTTP_SIZE") { ModuleImages.validate(ByteArray(256*1024+1),"image/png") }
        rejected("HTTP_SIZE") { ModuleImages.dataUrl(uri(image(4097,1))) }
    }
}
