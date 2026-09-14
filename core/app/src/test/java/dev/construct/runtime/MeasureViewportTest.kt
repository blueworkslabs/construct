package dev.construct.runtime

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.abs

class MeasureViewportTest {
    // 1600×1200 photo letterboxed into a 800×1000 portrait view: fit is 800×600 at top 200.
    private val vp = MeasureViewport.forView(1600, 1200, 800f, 1000f)
    private fun close(expected: Float, actual: Float, tolerance: Float = 0.01f) = assertTrue("$expected vs $actual", abs(expected - actual) <= tolerance)

    @Test fun `unzoomed mapping reproduces the fit exactly`() {
        close(0f, vp.toScreenX(0.0)); close(800f, vp.toScreenX(1.0))
        close(200f, vp.toScreenY(0.0)); close(800f, vp.toScreenY(1.0))
        val p = vp.toPhoto(400f, 500f)
        assertNotNull(p); close(0.5f, p!!.x.toFloat()); close(0.5f, p.y.toFloat())
    }

    @Test fun `positions outside the photo map to null rather than clamping`() {
        assertNull(vp.toPhoto(400f, 100f))   // letterbox above the photo
        assertNull(vp.toPhoto(400f, 900f))   // letterbox below
        assertNull(vp.toPhoto(-1f, 500f))
        assertNotNull(vp.toPhoto(0f, 200f))  // exact edge is inside
    }

    @Test fun `zoom keeps the photo point under the focal point fixed`() {
        val focal = 600f to 400f
        val before = vp.toPhoto(focal.first, focal.second)!!
        val zoomed = vp.zoomedBy(2.5f, focal.first, focal.second)
        val after = zoomed.toPhoto(focal.first, focal.second)!!
        close(before.x.toFloat(), after.x.toFloat()); close(before.y.toFloat(), after.y.toFloat())
        close(2.5f, zoomed.scale)
    }

    @Test fun `zoom is bounded and one times reproduces the fit`() {
        val max = vp.zoomedBy(100f, 400f, 500f)
        close(MeasureViewport.MAX_SCALE, max.scale)
        val back = max.zoomedBy(0.0001f, 400f, 500f)
        close(1f, back.scale); close(0f, back.offsetX); close(0f, back.offsetY)
    }

    @Test fun `pan is clamped so the photo never leaves the fit area`() {
        val zoomed = vp.zoomedBy(2f, 400f, 500f)
        val far = zoomed.pannedBy(10000f, 10000f)
        close(0f, far.left); close(200f, far.top)              // left/top edges stop at the fit edges
        val other = zoomed.pannedBy(-10000f, -10000f)
        close(800f, other.left + other.width); close(800f, other.top + other.height)
        val unzoomedPan = vp.pannedBy(50f, 50f)                 // nothing to pan at 1×
        close(0f, unzoomedPan.offsetX); close(0f, unzoomedPan.offsetY)
    }

    @Test fun `hit test picks the nearest handle within radius and prefers the selection`() {
        val one = Measurement(1, MeasurePoint(0.25, 0.5), MeasurePoint(0.75, 0.5), "x")
        val two = Measurement(2, MeasurePoint(0.25, 0.5), null, null)   // identical A position
        val hit = vp.hitTest(listOf(one, two), selectedId = 2, x = 205f, y = 505f, radius = 24f)
        assertEquals(HandleHit(2, MeasureEndpoint.A), hit)
        assertEquals(HandleHit(1, MeasureEndpoint.B), vp.hitTest(listOf(one), null, 590f, 500f, 24f))
        assertNull(vp.hitTest(listOf(one), null, 400f, 500f, 24f))     // midpoint of the line is not a handle
    }

    @Test fun `loupe source crop is centred on the point and scales with zoom`() {
        val crop = vp.loupeSource(MeasurePoint(0.5, 0.5), 1600, 1200, loupePx = 96f, magnification = 2.5f)
        val half = crop[2] / 2
        assertEquals(800 - half, crop[0]); assertEquals(600 - half, crop[1])
        val zoomedCrop = vp.zoomedBy(2f, 400f, 500f).loupeSource(MeasurePoint(0.5, 0.5), 1600, 1200, 96f, 2.5f)
        assertTrue(zoomedCrop[2] < crop[2])                                // zoomed in: fewer source pixels per loupe
    }
}
