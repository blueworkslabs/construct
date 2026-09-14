package dev.construct.runtime

import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

/** Which end of a measurement a gesture addresses. */
enum class MeasureEndpoint { A, B }

/** Lifecycle of one drag or nudge. A BEGIN…COMMIT sequence is one owner Undo entry. */
enum class DragPhase { BEGIN, PREVIEW, COMMIT, CANCEL }

/** Owner verdict on a placement or move. Never an exception across the pointer coroutine. */
sealed class EditResult {
    object Accepted : EditResult()
    data class Rejected(val reason: String) : EditResult()
}

/** One endpoint edit. [point] is required for PREVIEW and COMMIT, ignored otherwise. */
data class MoveRequest(
    val photoRevision: Long,
    val id: Int,
    val endpoint: MeasureEndpoint,
    val phase: DragPhase,
    val point: MeasurePoint?,
)

/** Owner-provided measurement in normalised photo coordinates. [label] is already formatted. */
data class Measurement(val id: Int, val a: MeasurePoint, val b: MeasurePoint?, val label: String?) {
    fun point(endpoint: MeasureEndpoint): MeasurePoint? = if (endpoint == MeasureEndpoint.A) a else b
}

/** A handle under the finger. */
data class HandleHit(val id: Int, val endpoint: MeasureEndpoint)

/**
 * Screen ↔ photo mapping: the letterboxed [PhotoFit] plus a zoom/pan transform in view pixels.
 * Pure and immutable so gesture arithmetic is unit-testable without Compose.
 * screen = (fit.left + p.x * fit.width) * scale + offsetX, likewise for y.
 */
internal data class MeasureViewport(
    val fit: PhotoFit,
    val viewWidth: Float,
    val viewHeight: Float,
    val scale: Float = 1f,
    val offsetX: Float = 0f,
    val offsetY: Float = 0f,
) {
    companion object {
        const val MIN_SCALE = 1f
        const val MAX_SCALE = 6f
        fun forView(imageWidth: Int, imageHeight: Int, viewWidth: Float, viewHeight: Float): MeasureViewport =
            MeasureViewport(PhotoFit.fit(imageWidth, imageHeight, viewWidth, viewHeight), viewWidth, viewHeight)
    }

    /** Scaled photo rectangle in view pixels. */
    val left get() = fit.left * scale + offsetX
    val top get() = fit.top * scale + offsetY
    val width get() = fit.width * scale
    val height get() = fit.height * scale

    fun toScreenX(x: Double) = (left + x * width).toFloat()
    fun toScreenY(y: Double) = (top + y * height).toFloat()

    /** Normalised photo point under a view position, or null when outside the photo. */
    fun toPhoto(x: Float, y: Float): MeasurePoint? {
        if (width <= 0f || height <= 0f) return null
        return MeasurePoint(((x - left) / width).toDouble(), ((y - top) / height).toDouble()).takeIf { it.inside() }
    }

    /** Zoom by [factor] keeping the photo point under ([focalX],[focalY]) fixed on screen. */
    fun zoomedBy(factor: Float, focalX: Float, focalY: Float): MeasureViewport {
        val target = (scale * factor).coerceIn(MIN_SCALE, MAX_SCALE)
        if (target == scale) return this
        val ratio = target / scale
        return copy(scale = target, offsetX = focalX - (focalX - offsetX) * ratio, offsetY = focalY - (focalY - offsetY) * ratio).clamped()
    }

    fun pannedBy(dx: Float, dy: Float): MeasureViewport = copy(offsetX = offsetX + dx, offsetY = offsetY + dy).clamped()

    /** Reset to the letterboxed fit. */
    fun reset(): MeasureViewport = copy(scale = 1f, offsetX = 0f, offsetY = 0f)

    /**
     * Keep the scaled photo covering the area the unzoomed fit occupied, so the photo
     * cannot be pushed off screen and at 1× the fit is exactly reproduced.
     */
    fun clamped(): MeasureViewport {
        fun axis(fitStart: Float, fitSize: Float, offset: Float): Float {
            val scaledSize = fitSize * scale
            val minStart = fitStart + fitSize - scaledSize  // right/bottom edge may not pass the fit edge
            val maxStart = fitStart                          // left/top edge may not pass the fit edge
            val start = fitStart * scale + offset
            val bounded = if (scaledSize <= fitSize) fitStart else start.coerceIn(minStart, maxStart)
            return bounded - fitStart * scale
        }
        return copy(offsetX = axis(fit.left, fit.width, offsetX), offsetY = axis(fit.top, fit.height, offsetY))
    }

    /** Nearest handle within [radius] view pixels, preferring the selected measurement. */
    fun hitTest(measurements: List<Measurement>, selectedId: Int?, x: Float, y: Float, radius: Float): HandleHit? {
        var best: HandleHit? = null
        var bestDistance = radius
        for (measurement in measurements) {
            for (endpoint in MeasureEndpoint.values()) {
                val point = measurement.point(endpoint) ?: continue
                var distance = hypot(toScreenX(point.x) - x, toScreenY(point.y) - y)
                if (measurement.id == selectedId) distance -= 0.001f // deterministic tie-break toward the selection
                if (distance <= bestDistance) { bestDistance = distance; best = HandleHit(measurement.id, endpoint) }
            }
        }
        return best
    }

    /** Source-pixel rectangle for a loupe centred on a photo point at [magnification]. */
    fun loupeSource(point: MeasurePoint, imageWidth: Int, imageHeight: Int, loupePx: Float, magnification: Float): IntArray {
        val pixelsPerScreen = imageWidth / width // photo pixels per view pixel at current zoom
        // Round the half-size once so the crop is symmetric about the point's pixel.
        val half = max(1, (loupePx / 2f / magnification * pixelsPerScreen).roundToInt())
        val cx = (point.x * imageWidth).roundToInt(); val cy = (point.y * imageHeight).roundToInt()
        val size = half * 2
        return intArrayOf(cx - half, cy - half, min(size, imageWidth), min(size, imageHeight))
    }
}
