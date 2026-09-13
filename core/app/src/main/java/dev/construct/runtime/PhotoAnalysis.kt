package dev.construct.runtime

import android.content.Context
import android.graphics.Bitmap
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.components.containers.Detection
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.facedetector.FaceDetector
import com.google.mediapipe.tasks.vision.objectdetector.ObjectDetector

internal enum class AnalysisKind(val title: String, val model: String) {
    FACES("Faces", "vision/face.tflite"), OBJECTS("Objects", "vision/objects.tflite")
}
internal data class PhotoBox(val left: Float, val top: Float, val right: Float, val bottom: Float,
    val label: String, val score: Float)
internal data class PhotoAnalysis(val kind: AnalysisKind, val boxes: List<PhotoBox>)

/** Sanitized normalized coordinates for the orientation-correct bitmap actually displayed. */
internal object PhotoBoxes {
    fun normalize(left: Float, top: Float, right: Float, bottom: Float, width: Int, height: Int,
        label: String, score: Float): PhotoBox? {
        if (width <= 0 || height <= 0 || !listOf(left, top, right, bottom, score).all { it.isFinite() } || score !in 0f..1f) return null
        val l = (left / width).coerceIn(0f, 1f); val t = (top / height).coerceIn(0f, 1f)
        val r = (right / width).coerceIn(0f, 1f); val b = (bottom / height).coerceIn(0f, 1f)
        if (r <= l || b <= t) return null
        return PhotoBox(l, t, r, b, label.take(60), score)
    }
}

/** Per-request CPU detector; bundled models, no download manager or module bridge. */
internal object PhotoAnalyzer {
    fun detect(context: Context, image: Bitmap, kind: AnalysisKind): PhotoAnalysis {
        checkRule(image.width in 1..1024 && image.height in 1..1024, "PHOTO_ANALYSIS", "Photo exceeds analysis limits.")
        val base = BaseOptions.builder().setModelAssetPath(kind.model).build()
        // MPImage owns its bitmap container. Never hand it the displayed image.
        val copy = image.copy(Bitmap.Config.ARGB_8888, false)
        val input = BitmapImageBuilder(copy).build()
        try {
            val detections: List<Detection> = when (kind) {
                AnalysisKind.FACES -> FaceDetector.createFromOptions(context,
                    FaceDetector.FaceDetectorOptions.builder().setBaseOptions(base)
                        .setRunningMode(RunningMode.IMAGE).setMinDetectionConfidence(.5f).build()).use { it.detect(input).detections() }
                AnalysisKind.OBJECTS -> ObjectDetector.createFromOptions(context,
                    ObjectDetector.ObjectDetectorOptions.builder().setBaseOptions(base)
                        .setRunningMode(RunningMode.IMAGE).setScoreThreshold(.5f).setMaxResults(5).build()).use { it.detect(input).detections() }
            }
            val boxes = detections.take(if (kind == AnalysisKind.FACES) 20 else 5).mapNotNull { detection ->
                val rect = detection.boundingBox()
                val category = detection.categories().maxByOrNull { it.score() }
                val label = if (kind == AnalysisKind.FACES) "Face" else category?.categoryName()?.ifBlank { "Object" } ?: "Object"
                PhotoBoxes.normalize(rect.left, rect.top, rect.right, rect.bottom, image.width, image.height, label, category?.score() ?: 0f)
            }
            return PhotoAnalysis(kind, boxes)
        } finally { input.close(); if (!copy.isRecycled) copy.recycle() }
    }
}

/** Each selection/close invalidates pending output even if native inference finishes later. */
internal class AnalysisGeneration {
    private var generation = 0L
    @Synchronized fun invalidate(): Long { generation++; return generation }
    @Synchronized fun current(token: Long): Boolean = generation == token
}

internal data class PhotoFit(val left: Float, val top: Float, val width: Float, val height: Float) {
    companion object {
        fun fit(imageWidth: Int, imageHeight: Int, width: Float, height: Float): PhotoFit {
            require(imageWidth > 0 && imageHeight > 0 && width >= 0 && height >= 0)
            val scale = minOf(width / imageWidth, height / imageHeight)
            val w = imageWidth * scale; val h = imageHeight * scale
            return PhotoFit((width - w) / 2, (height - h) / 2, w, h)
        }
    }
}
