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
        const val METADATA_DISCLOSURE = "Each saved capture also sends its photo ID, zoom and available lens, tilt and magnetic-heading estimates to this module, even when the level indicator is off. Granted storage or internet access can retain or send these measurements. No location is included; revocation cannot erase delivered copies."
        const val MAX_ZOOM_CHOICES = 4
        const val MIN_ZOOM_RATIO = 0.1
        const val MAX_ZOOM_RATIO = 10.0
        /** Steps closer than this would be indistinguishable chips; they are rejected, never merged. */
        const val MIN_ZOOM_STEP = 0.05
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
            checkRule(result.all { a -> result.count { b -> abs(a - b) < MIN_ZOOM_STEP - 1e-9 } == 1 }, "CAMERA_PARAMS",
                "Zoom ratios must differ by at least $MIN_ZOOM_STEP")
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

    /**
     * Offered zoom chips: each requested ratio at full precision, clamped to the device range.
     * Only ratios that clamp onto the same range limit collapse into one chip.
     */
    fun zoomChoices(requested: List<Double>, minRatio: Float, maxRatio: Float): List<Float> {
        if (!(minRatio > 0f) || !(maxRatio >= minRatio)) return emptyList()
        return requested.map { it.toFloat().coerceIn(minRatio, maxRatio) }.distinct()
    }

    fun initialZoom(choices: List<Float>, minRatio: Float, maxRatio: Float): Float =
        choices.firstOrNull { abs(it - 1f) < 1e-3f } ?: choices.firstOrNull() ?: 1f.coerceIn(minRatio, maxRatio)

    fun label(ratio: Float): String = when {
        abs(ratio - Math.round(ratio)) < 0.005f -> "${Math.round(ratio)}×"
        abs(ratio * 10 - Math.round(ratio * 10)) < 0.05f -> String.format(java.util.Locale.ROOT, "%.1f×", ratio)
        else -> String.format(java.util.Locale.ROOT, "%.2f×", ratio)
    }
}

/**
 * One sensor event. [timestampNs] is the measurement time (`SensorEvent.timestamp`, the
 * `SystemClock.elapsedRealtimeNanos` clock); [arrivalNs] is when the host received it, on the
 * same clock. Freshness always uses the measurement time: a sample delivered late is old.
 */
internal class SensorSample(val timestampNs: Long, val arrivalNs: Long, val values: FloatArray, val status: Int)

/**
 * The exposure started somewhere in [startNs, endNs] (elapsedRealtimeNanos): from just before
 * `takePicture` until `onCaptureStarted` arrived, or until the image was saved when that
 * callback never came. A sample's age is its worst-case distance from any instant in the window.
 */
internal data class ExposureWindow(val startNs: Long, val endNs: Long)

internal object SampleTiming {
    /** A measurement cannot postdate its delivery; beyond this tolerance the clocks disagree. */
    const val FUTURE_TOLERANCE_NS = 5_000_000L
    // SensorManager.SENSOR_STATUS_* values, kept here so the policy is pure.
    const val STATUS_NO_CONTACT = -1
    const val STATUS_UNRELIABLE = 0

    /** Plausible clock, reliable status and finite values. */
    fun usable(sample: SensorSample): Boolean = sample.timestampNs > 0 && sample.arrivalNs > 0 &&
        sample.timestampNs <= sample.arrivalNs + FUTURE_TOLERANCE_NS && sample.status > STATUS_UNRELIABLE &&
        sample.values.size >= 3 && sample.values.take(3).all { it.isFinite() }

    fun worstAgeNs(timestampNs: Long, window: ExposureWindow): Long =
        max(abs(timestampNs - window.startNs), abs(timestampNs - window.endNs))

    fun ageMs(ageNs: Long): Long = (ageNs + 999_999) / 1_000_000

    /** The usable sample nearest the exposure window and its worst-case age (ms), or null beyond [maxAgeMs]. */
    fun nearest(samples: List<SensorSample>, window: ExposureWindow?, maxAgeMs: Long): Pair<SensorSample, Long>? {
        if (window == null || window.startNs <= 0 || window.endNs < window.startNs) return null
        val best = samples.filter(::usable).minByOrNull { worstAgeNs(it.timestampNs, window) } ?: return null
        val age = ageMs(worstAgeNs(best.timestampNs, window))
        return if (age <= maxAgeMs) best to age else null
    }
}

internal data class Tilt(val pitchDeg: Double, val rollDeg: Double, val sigmaDeg: Double, val ageMs: Long)

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
    const val MAX_AGE_MS = 250L
    /** Samples within this distance of the chosen one measure hand motion. */
    const val SPREAD_WINDOW_NS = 250_000_000L
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
     * Tilt of one vector with a one-sigma estimate (≥ [BASE_SIGMA_DEG]), or null when
     * unreliable: too old, a motion-dominated accelerometer, or a pose so steep that roll is
     * ill-defined. [spreadDeg] is the angular RMS of the surrounding samples (hand motion).
     */
    fun measure(x: Double, y: Double, z: Double, displayRotation: Int, spreadDeg: Double, ageMs: Long,
        accelerometer: Boolean): Tilt? {
        if (ageMs < 0 || ageMs > MAX_AGE_MS || !spreadDeg.isFinite() || spreadDeg < 0) return null
        if (accelerometer && abs(sqrt(x * x + y * y + z * z) - GRAVITY) > MAX_MAGNITUDE_ERROR) return null
        val (pitch, roll) = angles(x, y, z, displayRotation) ?: return null
        val base = hypot(BASE_SIGMA_DEG, spreadDeg)
        // Roll is measured from the in-image gravity component, which shrinks with cos(pitch).
        val sigma = max(BASE_SIGMA_DEG, base / max(cos(rad(pitch)), 1e-3))
        if (sigma > MAX_SIGMA_DEG) return null
        return Tilt(pitch, roll, sigma, ageMs)
    }

    /** Angular RMS (degrees) of unit vectors around their mean direction. */
    fun spreadDeg(vectors: List<DoubleArray>): Double {
        if (vectors.size < 2) return 0.0
        val mean = DoubleArray(3)
        vectors.forEach { v -> for (i in 0..2) mean[i] += v[i] }
        val norm = sqrt(mean[0] * mean[0] + mean[1] * mean[1] + mean[2] * mean[2])
        if (norm < 1e-6) return Double.POSITIVE_INFINITY
        val sum = vectors.sumOf { v ->
            val cos = ((v[0] * mean[0] + v[1] * mean[1] + v[2] * mean[2]) / norm).coerceIn(-1.0, 1.0)
            val angle = deg(kotlin.math.acos(cos)); angle * angle
        }
        return sqrt(sum / vectors.size)
    }

    /** The gravity/accelerometer sample nearest the exposure, within [MAX_AGE_MS] by measurement time. */
    fun atShutter(samples: List<SensorSample>, window: ExposureWindow?, displayRotation: Int, accelerometer: Boolean): Tilt? {
        val (chosen, age) = SampleTiming.nearest(samples, window, MAX_AGE_MS) ?: return null
        val around = samples.filter { SampleTiming.usable(it) && abs(it.timestampNs - chosen.timestampNs) <= SPREAD_WINDOW_NS }
            .mapNotNull { s ->
                val v = DoubleArray(3) { s.values[it].toDouble() }
                val n = sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
                if (n > 1e-6) DoubleArray(3) { v[it] / n } else null
            }
        val v = chosen.values
        return measure(v[0].toDouble(), v[1].toDouble(), v[2].toDouble(), displayRotation, spreadDeg(around), age, accelerometer)
    }
}

internal data class Heading(val headingDeg: Double, val accuracyDeg: Double, val ageMs: Long)

/**
 * Magnetic heading of the rear camera's optical axis from a rotation-vector sample. Weak hint
 * only. Android's rotation vector is referenced to magnetic north; no declination is applied
 * because the capture carries no location. Returned only with the sensor's own accuracy estimate.
 */
internal object CaptureHeading {
    const val MAX_AGE_MS = 1000L
    const val MAX_ACCURACY_DEG = 45.0
    /** Near-vertical optical axes have no meaningful azimuth. */
    const val MIN_HORIZONTAL = 0.25
    const val STATUS_NO_CONTACT = SampleTiming.STATUS_NO_CONTACT
    const val STATUS_UNRELIABLE = SampleTiming.STATUS_UNRELIABLE

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

    /**
     * Heading, or null when the status is unreliable, the sample is older than [MAX_AGE_MS], the
     * sensor gives no accuracy estimate (values[4], radians, −1 if unavailable), or that estimate
     * is worse than [MAX_ACCURACY_DEG]. An uncertainty is never invented.
     */
    fun measure(values: FloatArray?, status: Int, ageMs: Long): Heading? {
        if (values == null || status <= STATUS_UNRELIABLE || ageMs < 0 || ageMs > MAX_AGE_MS) return null
        val heading = azimuth(values) ?: return null
        val accuracy = values.getOrNull(4)?.toDouble()?.takeIf { it.isFinite() && it >= 0 }?.let { deg(it) } ?: return null
        if (accuracy > MAX_ACCURACY_DEG) return null
        return Heading(heading, accuracy, ageMs)
    }

    fun atShutter(samples: List<SensorSample>, window: ExposureWindow?): Heading? {
        val (chosen, age) = SampleTiming.nearest(samples, window, MAX_AGE_MS) ?: return null
        return measure(chosen.values, chosen.status, age)
    }
}

/**
 * Camera characteristics of the bound camera; `lens` is null when they are unavailable or
 * ambiguous. [cropMayChange] is set when the camera advertises distortion correction (or a
 * stabilization mode is in use), which can change the saved crop slightly.
 */
internal data class LensState(val lens: LensSpec?, val logical: Boolean, val physical: List<LensSpec?>, val back: Boolean,
    val cropMayChange: Boolean = false)

/** Everything known at the shutter, plus the saved image's oriented size. */
internal class ShutterState(val zoomRatio: Double, val lens: LensState?, val displayRotation: Int, val sensorRotationDegrees: Int?,
    val imageWidth: Int, val imageHeight: Int, val mirrored: Boolean, val window: ExposureWindow?,
    val gravity: List<SensorSample>, val accelerometer: Boolean, val rotation: List<SensorSample>)

internal object CaptureResult {
    const val FOV_SIGMA_DEG = 1.0
    const val FOV_SIGMA_CROP_DEG = 2.0

    /**
     * Capture metadata for the saved image. Each measurement is omitted rather than guessed:
     * FOV without single-focal-length characteristics or when a lens switch is possible; tilt
     * and heading for the front camera, mirrored or inconsistently oriented output, and stale,
     * unreliable or clock-inconsistent samples.
     */
    fun describe(state: ShutterState): JSONObject {
        val lens = state.lens
        val zoom = state.zoomRatio
        val fov = lens?.lens?.takeIf { !CaptureGeometry.lensSwitchPossible(lens.logical, it, lens.physical, zoom) }
            ?.let { CaptureGeometry.fieldOfView(it, state.imageWidth, state.imageHeight, zoom) }
        val fovSigma = if (lens?.cropMayChange == true) FOV_SIGMA_CROP_DEG else FOV_SIGMA_DEG
        // The optical-axis heading needs only the rear camera; tilt also needs the image's own axes.
        val rear = lens?.back == true
        val sensorLandscape = lens?.lens?.let { it.activeWidthMm >= it.activeHeightMm } ?: true
        val oriented = state.sensorRotationDegrees != null &&
            CaptureGeometry.orientationConsistent(state.sensorRotationDegrees, sensorLandscape, state.imageWidth, state.imageHeight)
        val tilt = if (rear && !state.mirrored && oriented)
            CaptureTilt.atShutter(state.gravity, state.window, state.displayRotation, state.accelerometer) else null
        val heading = if (rear) CaptureHeading.atShutter(state.rotation, state.window) else null
        return capture(zoom, fov, fovSigma, tilt, heading)
    }

    fun capture(zoomRatio: Double, fov: FieldOfView?, fovSigmaDeg: Double, tilt: Tilt?, heading: Heading?): JSONObject {
        val result = JSONObject().put("zoomRatio", zoomRatio)
        fov?.let { result.put("fovDeg", JSONObject().put("h", round(it.h, 2)).put("v", round(it.v, 2)))
            .put("fovSigmaDeg", round(max(0.5, fovSigmaDeg), 2)) }
        tilt?.let { result.put("tilt", JSONObject().put("pitchDeg", round(it.pitchDeg, 2)).put("rollDeg", round(it.rollDeg, 2))
            .put("sigmaDeg", round(max(CaptureTilt.BASE_SIGMA_DEG, it.sigmaDeg), 2)).put("ageMs", it.ageMs)) }
        heading?.let { h ->
            result.put("headingDeg", (round(h.headingDeg, 1) % 360.0 + 360.0) % 360.0).put("headingRef", "magnetic")
                .put("headingAccuracyDeg", round(h.accuracyDeg, 1)).put("headingAgeMs", h.ageMs)
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
    // The Recents API suppresses stored snapshots, but launcher live tiles can still
    // show an unfocused activity surface. Opt-in only relaxes the secure window
    // while actively resumed AND focused, then protects the surface on focus loss.
    fun secureWindow(decision: Decision, resumed: Boolean, focused: Boolean): Boolean =
        decision.secure || (decision.hideRecents && (!resumed || !focused))
    fun copy(sdk: Int): String = "Off by default. When on, screenshots and screen recordings of this module work, and " +
        "anything recording your screen can see its photos. " +
        (if (sdk >= RECENTS_API) "The Recents thumbnail stays hidden."
        else "On this Android version the Recents thumbnail also shows this module’s screen while this is on.") +
        " The camera viewfinder always blocks screenshots."
}
