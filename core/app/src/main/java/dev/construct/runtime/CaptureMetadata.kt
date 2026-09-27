package dev.construct.runtime

import org.json.JSONArray
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.atan
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.min
import kotlin.math.sqrt
import kotlin.math.tan

private fun rad(deg: Double) = Math.toRadians(deg)
private fun deg(rad: Double) = Math.toDegrees(rad)
private fun round(value: Double, places: Int): Double {
    val scale = Math.pow(10.0, places.toDouble())
    return Math.round(value * scale) / scale
}

/**
 * `camera.photo {op:"capture"}` options. API 0.13 adds optional `level` and `zoom`
 * and the capture metadata result; earlier APIs keep the exact `{op}` request and
 * `{saved}` result.
 */
internal data class CaptureOptions(val level: Boolean = false, val zoom: List<Double> = emptyList(), val metadata: Boolean = false) {
    companion object {
        const val MAX_ZOOM_CHOICES = 4
        const val MIN_ZOOM_RATIO = 0.1
        const val MAX_ZOOM_RATIO = 10.0
        private val metadataApis = setOf("0.13.0")
        fun metadataApi(api: String) = api in metadataApis
        fun parse(args: JSONObject, api: String): CaptureOptions {
            val modern = metadataApi(api)
            val keys = args.keys().asSequence().toSet()
            val allowed = if (modern) setOf("op", "level", "zoom") else setOf("op")
            checkRule("op" in keys && allowed.containsAll(keys) && args.opt("op") == "capture", "CAMERA_PARAMS",
                if (modern) "Expected op:capture with optional level and zoom" else "Expected op:capture")
            val level = if (args.has("level")) args.get("level") as? Boolean
                ?: throw ConstructError("CAMERA_PARAMS", "level must be true or false") else false
            val zoom = if (args.has("zoom")) ratios(args.get("zoom")) else emptyList()
            return CaptureOptions(level, zoom, modern)
        }
        private fun ratios(value: Any): List<Double> {
            val list = value as? JSONArray ?: throw ConstructError("CAMERA_PARAMS", "zoom must be an array of ratios")
            checkRule(list.length() in 1..MAX_ZOOM_CHOICES, "CAMERA_PARAMS", "zoom lists 1–$MAX_ZOOM_CHOICES ratios")
            val result = (0 until list.length()).map { index ->
                val item = list.get(index)
                checkRule(item is Number, "CAMERA_PARAMS", "Each zoom ratio must be a number")
                val ratio = (item as Number).toDouble()
                checkRule(ratio.isFinite() && ratio >= MIN_ZOOM_RATIO && ratio <= MAX_ZOOM_RATIO, "CAMERA_PARAMS",
                    "Zoom ratios must be between $MIN_ZOOM_RATIO and $MAX_ZOOM_RATIO")
                ratio
            }
            checkRule(result.distinct().size == result.size, "CAMERA_PARAMS", "Zoom ratios must be distinct")
            return result
        }
    }
}

/** One lens as published in camera characteristics; lengths in millimetres, arrays in pixels. */
internal data class LensSpec(val focalMm: Double, val physicalWidthMm: Double, val physicalHeightMm: Double,
    val pixelArrayWidth: Int, val pixelArrayHeight: Int, val activeWidth: Int, val activeHeight: Int) {
    val valid: Boolean get() = listOf(focalMm, physicalWidthMm, physicalHeightMm).all { it.isFinite() && it > 0 } &&
        pixelArrayWidth > 0 && pixelArrayHeight > 0 && activeWidth in 1..pixelArrayWidth && activeHeight in 1..pixelArrayHeight
    val activeWidthMm: Double get() = physicalWidthMm * activeWidth / pixelArrayWidth
    val activeHeightMm: Double get() = physicalHeightMm * activeHeight / pixelArrayHeight
    /** tan(half angle) across the longer side of the full active array at zoom 1. */
    val tanHalfLong: Double get() = max(activeWidthMm, activeHeightMm) / (2 * focalMm)
}

internal data class FieldOfView(val h: Double, val v: Double)

internal object CaptureGeometry {
    /** Pure digital crop: the tangent shrinks by the zoom ratio, never the angle. */
    fun zoomedDeg(fovAtOneDeg: Double, zoom: Double): Double = deg(2 * atan(tan(rad(fovAtOneDeg) / 2) / zoom))

    /**
     * Horizontal/vertical FOV of the saved image as opened (after EXIF orientation).
     * Output streams are sensor-aligned, so the image's long side lies along the active
     * array's long side; zoom 1 shows the largest centred crop of the active array with
     * the output aspect. [imageWidth]/[imageHeight] are the oriented image dimensions.
     */
    fun fieldOfView(lens: LensSpec, imageWidth: Int, imageHeight: Int, zoom: Double): FieldOfView? {
        if (!lens.valid || imageWidth <= 0 || imageHeight <= 0 || !zoom.isFinite() || zoom <= 0) return null
        val sensorLong = max(lens.activeWidthMm, lens.activeHeightMm)
        val sensorShort = min(lens.activeWidthMm, lens.activeHeightMm)
        val aspect = max(imageWidth, imageHeight).toDouble() / min(imageWidth, imageHeight)
        val (cropLong, cropShort) = if (sensorLong / sensorShort >= aspect) sensorShort * aspect to sensorShort
            else sensorLong to sensorLong / aspect
        val longDeg = zoomedDeg(deg(2 * atan(cropLong / (2 * lens.focalMm))), zoom)
        val shortDeg = zoomedDeg(deg(2 * atan(cropShort / (2 * lens.focalMm))), zoom)
        return if (imageWidth >= imageHeight) FieldOfView(longDeg, shortDeg) else FieldOfView(shortDeg, longDeg)
    }

    /**
     * Whether a logical multi-camera may have served [zoom] from a different physical lens
     * than the one its published characteristics describe. Below 1× a wider lens must be in
     * use; above 1× any narrower lens that still covers the requested view may be switched in.
     * Unknown physical lenses count as possible switches.
     */
    fun lensSwitchPossible(logical: Boolean, main: LensSpec, physical: List<LensSpec?>, zoom: Double): Boolean {
        if (!logical) return false
        if (zoom < 1 - 1e-3) return true
        if (zoom <= 1 + 1e-3) return false
        if (!main.valid || physical.any { it == null || !it.valid }) return true
        val requested = main.tanHalfLong / zoom
        return physical.any { lens -> lens!!.tanHalfLong < main.tanHalfLong * 0.98 && lens.tanHalfLong >= requested * 0.98 }
    }

    /**
     * The oriented image must be portrait exactly when CameraX rotated the sensor-aligned
     * output by 90° or 270°. A mismatch means orientation cannot be trusted for tilt.
     */
    fun orientationConsistent(sensorRotationDegrees: Int, sensorLandscape: Boolean, imageWidth: Int, imageHeight: Int): Boolean {
        if (imageWidth <= 0 || imageHeight <= 0 || sensorRotationDegrees !in setOf(0, 90, 180, 270)) return false
        if (imageWidth == imageHeight) return true
        val swapped = sensorRotationDegrees % 180 != 0
        return (imageWidth > imageHeight) == (sensorLandscape != swapped)
    }

    /** Offered zoom chips: each requested ratio clamped to the device range, duplicates dropped. */
    fun zoomChoices(requested: List<Double>, minRatio: Float, maxRatio: Float): List<Float> {
        if (!(minRatio > 0f) || !(maxRatio >= minRatio)) return emptyList()
        return requested.map { (Math.round(it.coerceIn(minRatio.toDouble(), maxRatio.toDouble()) * 100) / 100.0).toFloat() }
            .map { it.coerceIn(minRatio, maxRatio) }.distinct()
    }

    fun initialZoom(choices: List<Float>, minRatio: Float, maxRatio: Float): Float =
        choices.firstOrNull { abs(it - 1f) < 1e-3f } ?: choices.firstOrNull() ?: 1f.coerceIn(minRatio, maxRatio)

    fun label(ratio: Float): String = if (abs(ratio - Math.round(ratio)) < 0.005f) "${Math.round(ratio)}×" else String.format(java.util.Locale.ROOT, "%.1f×", ratio)
}

internal data class Tilt(val pitchDeg: Double, val rollDeg: Double, val sigmaDeg: Double)

/**
 * Gravity → solver tilt (docs/aime/resection.js `basis()`): pitch > 0 when the camera looks
 * below the horizon; roll > 0 when the image's right side points down, so the horizon appears
 * higher on the right. Input is the "up" vector the gravity sensor (or a resting accelerometer)
 * reports in Android's sensor frame: x right, y top, z out of the screen, portrait natural
 * orientation. The rear camera looks along −z. CameraX saves the image upright for the display
 * rotation it was given, so image right/up in the sensor frame follow [displayRotation].
 */
internal object CaptureTilt {
    const val BASE_SIGMA_DEG = 1.0
    const val MAX_SIGMA_DEG = 10.0
    const val MAX_AGE_MS = 1000L
    const val GRAVITY = 9.80665
    /** Accelerometer magnitudes this far from 1 g are dominated by motion. */
    const val MAX_MAGNITUDE_ERROR = 1.5

    /** (pitchDeg, rollDeg) or null for an unusable vector or rotation. [displayRotation] is Surface.ROTATION_0..3. */
    fun angles(x: Double, y: Double, z: Double, displayRotation: Int): Pair<Double, Double>? {
        val norm = sqrt(x * x + y * y + z * z)
        if (!norm.isFinite() || norm < 1e-6) return null
        val ux = x / norm; val uy = y / norm; val uz = z / norm
        // Image right R and image up U, in the sensor frame, per display rotation.
        //   ROTATION_0:   R = +x, U = +y     ROTATION_90:  R = −y, U = +x
        //   ROTATION_180: R = −x, U = −y     ROTATION_270: R = +y, U = −x
        val (right, up) = when (displayRotation) {
            0 -> ux to uy
            1 -> -uy to ux
            2 -> -ux to -uy
            3 -> uy to -ux
            else -> return null
        }
        // Forward F = −z: pitch = −asin(F·up) = asin(uz). Solver: R·up = −cos p·sin r, D·up = −cos p·cos r, D = −U.
        val pitch = deg(atan2(uz, hypot(ux, uy)))
        val roll = deg(atan2(-right, up))
        return pitch to (if (roll <= -180.0) roll + 360.0 else roll)
    }

    /**
     * Tilt with a one-sigma estimate, or null when unavailable or unreliable: no fresh sample,
     * a motion-dominated accelerometer, or a pose so steep that roll is ill-defined.
     * [spreadDeg] is the angular RMS of the recent samples (hand motion).
     */
    fun measure(x: Double, y: Double, z: Double, displayRotation: Int, spreadDeg: Double, ageMs: Long,
        accelerometer: Boolean): Tilt? {
        if (ageMs < 0 || ageMs > MAX_AGE_MS || !spreadDeg.isFinite() || spreadDeg < 0) return null
        if (accelerometer && abs(sqrt(x * x + y * y + z * z) - GRAVITY) > MAX_MAGNITUDE_ERROR) return null
        val (pitch, roll) = angles(x, y, z, displayRotation) ?: return null
        val base = hypot(BASE_SIGMA_DEG, spreadDeg)
        // Roll is measured from the in-image gravity component, which shrinks with cos(pitch).
        val sigma = base / max(cos(rad(pitch)), 1e-3)
        if (sigma > MAX_SIGMA_DEG) return null
        return Tilt(pitch, roll, sigma)
    }
}

internal data class Heading(val headingDeg: Double, val accuracyDeg: Double?)

/**
 * Magnetic heading of the rear camera's optical axis from a rotation-vector sample. Weak hint
 * only. Android's rotation vector is referenced to magnetic north; no declination is applied
 * because the capture carries no location.
 */
internal object CaptureHeading {
    const val MAX_AGE_MS = 1000L
    const val MAX_ACCURACY_DEG = 45.0
    /** Near-vertical optical axes have no meaningful azimuth. */
    const val MIN_HORIZONTAL = 0.25
    // SensorManager.SENSOR_STATUS_* values, kept here so the policy is pure.
    const val STATUS_NO_CONTACT = -1
    const val STATUS_UNRELIABLE = 0

    /** Azimuth (clockwise from magnetic north) of device −z, or null when the axis is near vertical. */
    fun azimuth(values: FloatArray): Double? {
        if (values.size < 3 || values.take(min(values.size, 4)).any { !it.isFinite() }) return null
        val q1 = values[0].toDouble(); val q2 = values[1].toDouble(); val q3 = values[2].toDouble()
        val q0 = if (values.size >= 4) values[3].toDouble() else sqrt(max(0.0, 1 - q1 * q1 - q2 * q2 - q3 * q3))
        // Third column of SensorManager.getRotationMatrixFromVector (device z in east/north/up).
        val zEast = 2 * q1 * q3 + 2 * q2 * q0
        val zNorth = 2 * q2 * q3 - 2 * q1 * q0
        val horizontal = hypot(zEast, zNorth)
        if (!horizontal.isFinite() || horizontal < MIN_HORIZONTAL) return null
        val heading = deg(atan2(-zEast, -zNorth))
        return (heading % 360.0 + 360.0) % 360.0
    }

    fun measure(values: FloatArray?, status: Int, ageMs: Long): Heading? {
        if (values == null || status == STATUS_NO_CONTACT || status == STATUS_UNRELIABLE || ageMs < 0 || ageMs > MAX_AGE_MS) return null
        val heading = azimuth(values) ?: return null
        // values[4], when present, is the estimated heading accuracy in radians (−1 if unavailable).
        val accuracy = values.getOrNull(4)?.toDouble()?.takeIf { it.isFinite() && it >= 0 }?.let { deg(it) }
        if (accuracy != null && accuracy > MAX_ACCURACY_DEG) return null
        return Heading(heading, accuracy)
    }
}

/** Camera characteristics of the bound camera; `lens` is null when they are unavailable or ambiguous. */
internal data class LensState(val lens: LensSpec?, val logical: Boolean, val physical: List<LensSpec?>, val back: Boolean)

/** Everything known at the shutter, plus the saved image's oriented size. */
internal class ShutterState(val zoomRatio: Double, val lens: LensState?, val displayRotation: Int, val sensorRotationDegrees: Int?,
    val imageWidth: Int, val imageHeight: Int, val mirrored: Boolean,
    val up: DoubleArray?, val upAgeMs: Long, val spreadDeg: Double, val accelerometer: Boolean,
    val rotationVector: FloatArray?, val rotationStatus: Int, val rotationAgeMs: Long)

internal object CaptureResult {
    /**
     * Capture metadata for the saved image. Each measurement is omitted rather than guessed:
     * FOV without single-focal-length characteristics or when a lens switch is possible; tilt
     * and heading for the front camera, mirrored or inconsistently oriented output, and stale
     * or unreliable sensors.
     */
    fun describe(state: ShutterState): JSONObject {
        val lens = state.lens
        val zoom = state.zoomRatio
        val fov = lens?.lens?.takeIf { !CaptureGeometry.lensSwitchPossible(lens.logical, it, lens.physical, zoom) }
            ?.let { CaptureGeometry.fieldOfView(it, state.imageWidth, state.imageHeight, zoom) }
        // The optical-axis heading needs only the rear camera; tilt also needs the image's own axes.
        val rear = lens?.back == true
        val sensorLandscape = lens?.lens?.let { it.activeWidthMm >= it.activeHeightMm } ?: true
        val oriented = state.sensorRotationDegrees != null &&
            CaptureGeometry.orientationConsistent(state.sensorRotationDegrees, sensorLandscape, state.imageWidth, state.imageHeight)
        val up = state.up
        val tilt = if (rear && !state.mirrored && oriented && up != null && up.size == 3)
            CaptureTilt.measure(up[0], up[1], up[2], state.displayRotation, state.spreadDeg, state.upAgeMs, state.accelerometer) else null
        val heading = if (rear) CaptureHeading.measure(state.rotationVector, state.rotationStatus, state.rotationAgeMs) else null
        return capture(zoom, fov, tilt, heading)
    }

    fun capture(zoomRatio: Double, fov: FieldOfView?, tilt: Tilt?, heading: Heading?): JSONObject {
        val result = JSONObject().put("zoomRatio", round(zoomRatio, 2))
        fov?.let { result.put("fovDeg", JSONObject().put("h", round(it.h, 2)).put("v", round(it.v, 2))) }
        tilt?.let { result.put("tilt", JSONObject().put("pitchDeg", round(it.pitchDeg, 2)).put("rollDeg", round(it.rollDeg, 2))
            .put("sigmaDeg", round(it.sigmaDeg, 2))) }
        heading?.let { h ->
            result.put("headingDeg", round(h.headingDeg, 1)).put("headingRef", "magnetic")
            h.accuracyDeg?.let { result.put("headingAccuracyDeg", round(it, 1)) }
        }
        return result
    }

    /** Bridge result: API 0.13 adds `id` and `capture` to a saved photo; earlier APIs keep `{saved}`. */
    fun forModule(metadata: Boolean, saved: Boolean, id: String?, capture: JSONObject?): JSONObject {
        val result = JSONObject().put("saved", saved)
        if (!metadata || !saved) return result
        checkRule(id != null && capture != null, "CAMERA_CAPTURE", "Photo was saved without its identity; list photos to find it")
        return result.put("id", id).put("capture", capture)
    }
}

/**
 * Screen-capture policy for module sessions. Modules that can show private or selected
 * image pixels run with FLAG_SECURE unless the person turned on that module's
 * "Allow screenshots" switch. On Android 13+ the Recents thumbnail stays hidden anyway.
 * The native viewfinder is not governed by this policy; it always keeps the flag.
 */
internal object ScreenCapturePolicy {
    data class Decision(val secure: Boolean, val hideRecents: Boolean)
    const val RECENTS_API = 33
    private val sensitive = setOf("image.read", "photos.library")
    fun sensitive(capabilities: Collection<String>) = capabilities.any { it in sensitive }
    fun decide(capabilities: Collection<String>, allowScreenshots: Boolean, sdk: Int): Decision = when {
        !sensitive(capabilities) -> Decision(secure = false, hideRecents = false)
        !allowScreenshots -> Decision(secure = true, hideRecents = false)
        else -> Decision(secure = false, hideRecents = sdk >= RECENTS_API)
    }
    fun copy(sdk: Int): String = "Off by default. When on, screenshots and screen recordings of this module work, and " +
        "anything recording your screen can see its photos. " +
        (if (sdk >= RECENTS_API) "The Recents thumbnail stays hidden."
        else "On this Android version the Recents thumbnail also shows this module’s screen while this is on.") +
        " The camera viewfinder always blocks screenshots."
}
