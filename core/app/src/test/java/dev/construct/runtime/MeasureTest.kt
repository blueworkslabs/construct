package dev.construct.runtime

import org.junit.Assert.*
import org.junit.Test

class MeasureTest {
    private fun rejected(action: () -> Unit) { try { action(); fail("Expected rejection") } catch (e: ConstructError) { } }
    private val square = listOf(MeasurePoint(.2,.2),MeasurePoint(.4,.2),MeasurePoint(.4,.4),MeasurePoint(.2,.4))
    @Test fun actualMarkerSizeControlsScaleNotNominalPrintSize() {
        val plane = MeasurePlane(square)
        assertEquals(237.5,plane.lengthMm(MeasurePoint(.3,.6),MeasurePoint(.8,.6),95.0),1e-8)
        assertEquals(250.0,plane.lengthMm(MeasurePoint(.3,.6),MeasurePoint(.8,.6),100.0),1e-8)
    }
    @Test fun projectivePerspectiveAndCornerRotationsPreserveKnownLength() {
        // Independent forward camera projection, not the implementation's inverse algorithm.
        fun photo(x: Double,y: Double): MeasurePoint { val d=1+.2*x+.1*y;return MeasurePoint((.25+.18*x+.04*y)/d,(.2+.03*x+.16*y)/d) }
        val corners = listOf(photo(0.0,0.0),photo(1.0,0.0),photo(1.0,1.0),photo(0.0,1.0))
        for (rotation in 0..3) {
            val plane=MeasurePlane(List(4){ corners[(it+rotation)%4] })
            assertEquals(240.0,plane.lengthMm(photo(0.0,2.0),photo(2.4,2.0),100.0),1e-7)
        }
    }
    @Test fun malformedMarkersAndPointsCannotProduceLengths() {
        for (c in listOf(emptyList(),square.reversed().toMutableList().apply { this[1]=this[0] },listOf(square[0],square[2],square[1],square[3]))) rejected { MeasurePlane(c) }
        val p=MeasurePlane(square)
        for (bad in listOf(MeasurePoint(Double.NaN,.4),MeasurePoint(-.1,.4),MeasurePoint(.4,Double.POSITIVE_INFINITY))) rejected { p.project(bad) }
        rejected { p.lengthMm(square[0],square[0],95.0) }
        rejected { p.lengthMm(square[0],square[1],Double.NaN) }
    }
    @Test fun markerSizeSupportsDecimalCommaButRejectsAmbiguousInput() {
        assertEquals(95.0,MeasureInput.sideMm("95"),0.0)
        assertEquals(95.5,MeasureInput.sideMm("95,5"),0.0)
        for (s in listOf("","NaN","1e2","9","301","95mm","95,5.0","-95")) rejected { MeasureInput.sideMm(s) }
    }
    @Test fun tapsIgnoreLetterboxingAndRemainStableAcrossResize() {
        assertNull(MeasureInput.fromTap(20f,20f,300f,600f,800,400))
        assertEquals(MeasurePoint(.5,.5),MeasureInput.fromTap(150f,300f,300f,600f,800,400))
        assertEquals(MeasurePoint(.5,.5),MeasureInput.fromTap(300f,150f,600f,300f,800,400))
        assertNull(MeasureInput.fromTap(Float.NaN,20f,300f,600f,800,400))
    }
}
