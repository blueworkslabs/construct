package dev.construct.runtime

import android.graphics.Bitmap

internal object MeasureNative {
    init { System.loadLibrary("construct_measure") }
    external fun detect(pixels: IntArray, width: Int, height: Int): DoubleArray
}

object MeasureDetector {
    @Synchronized fun detect(bitmap: Bitmap): List<MeasurePoint> {
        checkRule(bitmap.width in 1..1600 && bitmap.height in 1..1600,
            "PHOTO_INVALID", "Photo dimensions exceed the working limit.")
        val pixels = IntArray(bitmap.width * bitmap.height)
        bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
        val found = MeasureNative.detect(pixels, bitmap.width, bitmap.height)
        checkRule(found.size == 8, "MARKER_NOT_FOUND", if (found.isEmpty()) "No reference marker found. Show all four corners of the supplied card." else "Use only one reference card in the photo.")
        val points = (0..3).map { i -> MeasurePoint(found[i*2], found[i*2+1]) }
        checkRule(points.indices.all { i ->
            val a=points[i]; val b=points[(i+1)%4]
            kotlin.math.hypot((a.x-b.x)*bitmap.width,(a.y-b.y)*bitmap.height) >= 40
        }, "MARKER_INVALID", "Move closer: each marker edge must be at least 40 image pixels.")
        MeasurePlane(points) // Reject invalid geometry before enabling endpoint input.
        return points
    }
}
