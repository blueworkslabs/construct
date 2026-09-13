package dev.construct.runtime

import org.junit.Assert.*
import org.junit.Test

class PhotoAnalysisTest {
    @Test fun staleResultsCannotReturnAfterSelectionChangeOrClose() {
        val generation = AnalysisGeneration()
        val first = generation.invalidate()
        assertTrue(generation.current(first))
        val second = generation.invalidate()
        assertFalse(generation.current(first)); assertTrue(generation.current(second))
        generation.invalidate()
        assertFalse(generation.current(second))
    }
    @Test fun detectorCoordinatesAreClampedAndMalformedBoxesRejected() {
        val box = PhotoBoxes.normalize(-20f, 10f, 220f, 90f, 200, 100, "Face", .9f)!!
        assertEquals(0f, box.left, 0f); assertEquals(1f, box.right, 0f)
        assertEquals(.1f, box.top, .0001f); assertEquals(.9f, box.bottom, .0001f)
        assertNull(PhotoBoxes.normalize(40f, 10f, 20f, 90f, 200, 100, "Face", .9f))
        assertNull(PhotoBoxes.normalize(Float.NaN, 10f, 20f, 90f, 200, 100, "Face", .9f))
        assertNull(PhotoBoxes.normalize(0f, 10f, 20f, 90f, 200, 100, "Face", Float.POSITIVE_INFINITY))
    }
    @Test fun overlayMatchesFitLetterboxingInBothOrientations() {
        val portrait = PhotoFit.fit(800, 400, 300f, 600f)
        assertEquals(PhotoFit(0f, 225f, 300f, 150f), portrait)
        val landscape = PhotoFit.fit(400, 800, 600f, 300f)
        assertEquals(PhotoFit(225f, 0f, 150f, 300f), landscape)
    }
}
