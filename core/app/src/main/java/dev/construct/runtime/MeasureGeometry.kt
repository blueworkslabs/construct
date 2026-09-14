package dev.construct.runtime

import kotlin.math.abs
import kotlin.math.hypot

data class MeasurePoint(val x: Double, val y: Double) {
    fun inside() = x.isFinite() && y.isFinite() && x in 0.0..1.0 && y in 0.0..1.0
}

/** Projective mapping from normalized photograph coordinates to the marker's unit plane. */
class MeasurePlane(corners: List<MeasurePoint>) {
    private val h: DoubleArray
    private val centre = MeasurePoint(corners.sumOf { it.x } / 4, corners.sumOf { it.y } / 4)
    init {
        checkRule(corners.size == 4 && corners.all { it.inside() }, "MARKER_INVALID", "Marker corners are outside the photo.")
        val cross = corners.indices.map { i ->
            val a = corners[i]; val b = corners[(i + 1) % 4]; val c = corners[(i + 2) % 4]
            (b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x)
        }
        checkRule(cross.all { it > 0.00001 } || cross.all { it < -0.00001 }, "MARKER_INVALID", "Use a larger, less angled marker.")
        val target = listOf(MeasurePoint(0.0,0.0),MeasurePoint(1.0,0.0),MeasurePoint(1.0,1.0),MeasurePoint(0.0,1.0))
        val matrix = Array(8) { DoubleArray(9) }
        corners.forEachIndexed { i, p ->
            val q = target[i]
            matrix[2*i] = doubleArrayOf(p.x,p.y,1.0,0.0,0.0,0.0,-q.x*p.x,-q.x*p.y,q.x)
            matrix[2*i+1] = doubleArrayOf(0.0,0.0,0.0,p.x,p.y,1.0,-q.y*p.x,-q.y*p.y,q.y)
        }
        for (col in 0..7) {
            val pivot = (col..7).maxBy { abs(matrix[it][col]) }
            checkRule(abs(matrix[pivot][col]) > 1e-10, "MARKER_INVALID", "Marker perspective is too extreme.")
            val row = matrix[col]; matrix[col] = matrix[pivot]; matrix[pivot] = row
            val divisor = matrix[col][col]
            for (j in col..8) matrix[col][j] /= divisor
            for (r in 0..7) if (r != col) {
                val factor = matrix[r][col]
                for (j in col..8) matrix[r][j] -= factor * matrix[col][j]
            }
        }
        h = DoubleArray(8) { matrix[it][8] }
    }
    private fun denominator(p: MeasurePoint) = h[6]*p.x+h[7]*p.y+1
    fun project(p: MeasurePoint): MeasurePoint {
        checkRule(p.inside(), "POINT_INVALID", "Tap inside the photograph.")
        val d = denominator(p)
        // Reject the projective horizon, and the opposite side of it from the marker origin.
        checkRule(abs(d) > 1e-6 && d * denominator(centre) > 0, "POINT_INVALID", "Point is too far from the reference plane.")
        val q = MeasurePoint((h[0]*p.x+h[1]*p.y+h[2])/d,(h[3]*p.x+h[4]*p.y+h[5])/d)
        checkRule(q.x.isFinite() && q.y.isFinite() && abs(q.x) < 50 && abs(q.y) < 50, "POINT_INVALID", "Keep the item near the marker.")
        return q
    }
    fun lengthMm(a: MeasurePoint, b: MeasurePoint, sideMm: Double): Double {
        checkRule(sideMm.isFinite() && sideMm in 10.0..300.0, "SIZE_INVALID", "Enter a marker side from 10 to 300 mm.")
        checkRule(denominator(a)*denominator(b) > 0, "POINT_INVALID", "Measurement crosses an invalid perspective region.")
        val p = project(a); val q = project(b)
        val length = hypot(q.x-p.x,q.y-p.y)*sideMm
        checkRule(length.isFinite() && length in 0.1..5000.0, "POINT_INVALID", "Choose two distinct nearby endpoints.")
        return length
    }
}

object MeasureInput {
    fun sideMm(text: String): Double {
        val number = if (Regex("[0-9]{1,3}([.,][0-9]{1,2})?").matches(text.trim())) text.trim().replace(',','.').toDoubleOrNull() else null
        checkRule(number != null && number in 10.0..300.0, "SIZE_INVALID", "Enter the measured black-square side: 10–300 mm.")
        return number!!
    }
    fun fromTap(x: Float, y: Float, width: Float, height: Float, imageWidth: Int, imageHeight: Int): MeasurePoint? {
        if (width <= 0 || height <= 0 || imageWidth <= 0 || imageHeight <= 0) return null
        val f = PhotoFit.fit(imageWidth,imageHeight,width,height)
        return MeasurePoint(((x-f.left)/f.width).toDouble(),((y-f.top)/f.height).toDouble()).takeIf { it.inside() }
    }
}
