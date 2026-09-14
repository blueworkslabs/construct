package dev.construct.runtime

import android.graphics.Bitmap
import org.opencv.android.OpenCVLoader
import org.opencv.android.Utils
import org.opencv.core.Mat
import org.opencv.imgproc.Imgproc
import org.opencv.objdetect.ArucoDetector
import org.opencv.objdetect.DetectorParameters
import org.opencv.objdetect.Objdetect

object MeasureDetector {
    @Synchronized fun detect(bitmap: Bitmap): List<MeasurePoint> {
        checkRule(OpenCVLoader.initLocal(), "MEASURE_UNAVAILABLE", "Marker detection could not start.")
        val rgba = Mat(); val gray = Mat(); val ids = Mat(); val corners = mutableListOf<Mat>()
        val parameters = DetectorParameters().apply { set_cornerRefinementMethod(Objdetect.CORNER_REFINE_SUBPIX) }
        val detector = ArucoDetector(Objdetect.getPredefinedDictionary(Objdetect.DICT_4X4_50), parameters)
        try {
            Utils.bitmapToMat(bitmap, rgba)
            Imgproc.cvtColor(rgba, gray, Imgproc.COLOR_RGBA2GRAY)
            detector.detectMarkers(gray, corners, ids)
            val matches = (0 until ids.rows()).filter { ids.get(it,0)[0].toInt() == 0 }
            checkRule(matches.size == 1, "MARKER_NOT_FOUND", if (matches.isEmpty()) "No reference marker found. Show all four corners of the supplied card." else "Use only one reference card in the photo.")
            val marker = corners[matches.single()]
            val points = (0..3).map { i -> marker.get(0,i).let { MeasurePoint(it[0]/bitmap.width,it[1]/bitmap.height) } }
            checkRule(points.indices.all { i ->
                val a=points[i]; val b=points[(i+1)%4]
                kotlin.math.hypot((a.x-b.x)*bitmap.width,(a.y-b.y)*bitmap.height) >= 40
            }, "MARKER_INVALID", "Move closer: each marker edge must be at least 40 image pixels.")
            MeasurePlane(points) // Reject invalid geometry before enabling endpoint input.
            return points
        } finally { rgba.release(); gray.release(); ids.release(); corners.forEach { it.release() }; detector.clear() }
    }
}
