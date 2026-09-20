package dev.construct.runtime

import org.junit.Assert.*
import org.junit.Test

class PhotoAnalysisTest {
    @Test fun detectorCoordinatesAreClampedAndMalformedBoxesRejected() {
        val box = PhotoBoxes.normalize(-20f, 10f, 220f, 90f, 200, 100, "Face", .9f)!!
        assertEquals(0f, box.left, 0f); assertEquals(1f, box.right, 0f)
        assertEquals(.1f, box.top, .0001f); assertEquals(.9f, box.bottom, .0001f)
        assertNull(PhotoBoxes.normalize(40f, 10f, 20f, 90f, 200, 100, "Face", .9f))
        assertNull(PhotoBoxes.normalize(Float.NaN, 10f, 20f, 90f, 200, 100, "Face", .9f))
        assertNull(PhotoBoxes.normalize(0f, 10f, 20f, 90f, 200, 100, "Face", Float.POSITIVE_INFINITY))
    }
}
