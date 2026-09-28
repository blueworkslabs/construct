package dev.construct.runtime

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import org.json.JSONObject
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.roundToLong
import kotlin.math.sqrt

/**
 * Compass heading and tilt from one rotation-vector sample (API 0.14 `orientation.read`).
 * Android's rotation vector is referenced to magnetic north; the host applies no declination
 * because it has no location. Fields are omitted rather than guessed.
 *
 * - `pose` is "flat" when the screen faces up or down within 45° of horizontal: `azimuthDeg`
 *   is then the bearing of the screen's top edge for the current display rotation. Otherwise
 *   "upright": the bearing of the rear camera axis (device −z).
 * - `pitchDeg`/`rollDeg` follow the Aimé solver (`docs/aime/resection.js`) via [CaptureTilt]:
 *   pitch > 0 when the rear camera axis points below the horizon, roll > 0 when the screen's
 *   right side is down.
 * - `accuracyDeg` is the sensor's own heading estimate (values[4]) when it gives one, otherwise
 *   the status mapping HIGH 8, MEDIUM 15, LOW 30. UNRELIABLE or NO_CONTACT omit the azimuth and
 *   set `calibrate`.
 */
internal object OrientationMath {
    const val FLAT_COS = 0.7071
    const val MIN_HORIZONTAL = 0.25
    const val CALIBRATE_ABOVE_DEG = 30.0

    const val MAX_AGE_NS = 250_000_000L
    /** Sensor timestamps and elapsedRealtimeNanos share Android's boot-time clock. */
    fun measurementTime(sensorNs: Long, elapsedNs: Long, wallMs: Long): Long? {
        if (sensorNs <= 0 || sensorNs > elapsedNs) return null
        val age = elapsedNs - sensorNs
        if (age > MAX_AGE_NS) return null
        return wallMs - age / 1_000_000L
    }

    private fun round1(value: Double) = (value * 10).roundToLong() / 10.0
    private fun bearing(east: Double, north: Double): Double? {
        val horizontal = hypot(east, north)
        if (!horizontal.isFinite() || horizontal < MIN_HORIZONTAL) return null
        val b = Math.toDegrees(atan2(east, north))
        return round1((b % 360.0 + 360.0) % 360.0) % 360.0
    }

    /** Row-major device→world (east, north, up) matrix, as SensorManager.getRotationMatrixFromVector. */
    fun matrix(values: FloatArray): DoubleArray? {
        if (values.size < 3 || values.take(minOf(values.size, 4)).any { !it.isFinite() }) return null
        val q1 = values[0].toDouble(); val q2 = values[1].toDouble(); val q3 = values[2].toDouble()
        val q0 = if (values.size >= 4) values[3].toDouble() else sqrt(max(0.0, 1 - q1 * q1 - q2 * q2 - q3 * q3))
        val n = sqrt(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3)
        if (!n.isFinite() || abs(n - 1) > 0.05) return null
        return doubleArrayOf(
            1 - 2 * q2 * q2 - 2 * q3 * q3, 2 * q1 * q2 - 2 * q3 * q0, 2 * q1 * q3 + 2 * q2 * q0,
            2 * q1 * q2 + 2 * q3 * q0, 1 - 2 * q1 * q1 - 2 * q3 * q3, 2 * q2 * q3 - 2 * q1 * q0,
            2 * q1 * q3 - 2 * q2 * q0, 2 * q2 * q3 + 2 * q1 * q0, 1 - 2 * q1 * q1 - 2 * q2 * q2)
    }

    fun accuracyDeg(values: FloatArray, status: Int): Double? {
        if (status <= SensorManager.SENSOR_STATUS_UNRELIABLE) return null
        val own = values.getOrNull(4)?.toDouble()?.takeIf { it.isFinite() && it >= 0 }
        return if (own != null) round1(Math.toDegrees(own)) else when (status) {
            SensorManager.SENSOR_STATUS_ACCURACY_HIGH -> 8.0
            SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM -> 15.0
            else -> 30.0
        }
    }

    /** One sample, or null when the vector or display rotation is unusable. */
    fun sample(values: FloatArray, status: Int, displayRotation: Int, timestampMs: Long): JSONObject? {
        val r = matrix(values) ?: return null
        if (displayRotation !in 0..3) return null
        // Up in device coordinates is the world "up" row; tilt uses the solver's signs.
        val (pitch, roll) = CaptureTilt.angles(r[6], r[7], r[8], displayRotation) ?: return null
        val flat = abs(r[8]) >= FLAT_COS
        // Screen-up axis per display rotation (as CaptureTilt): 0:+y 1:+x 2:−y 3:−x.
        val (col, sign) = when (displayRotation) { 0 -> 1 to 1.0; 1 -> 0 to 1.0; 2 -> 1 to -1.0; else -> 0 to -1.0 }
        val azimuth = if (flat) bearing(sign * r[col], sign * r[3 + col]) else bearing(-r[2], -r[5])
        val accuracy = accuracyDeg(values, status)
        val out = JSONObject().put("pose", if (flat) "flat" else "upright")
            .put("pitchDeg", round1(pitch)).put("rollDeg", round1(roll))
            .put("calibrate", accuracy == null || accuracy > CALIBRATE_ABOVE_DEG).put("timestamp", timestampMs)
        if (azimuth != null && accuracy != null)
            out.put("azimuthDeg", azimuth).put("headingRef", "magnetic").put("accuracyDeg", accuracy)
        return out
    }

    /** At most [rateHz] deliveries per second, by sensor time. */
    class Throttle(var rateHz: Int) {
        private var last = Long.MIN_VALUE
        fun admit(nowNs: Long): Boolean {
            if (last != Long.MIN_VALUE && nowNs - last < 1_000_000_000L / rateHz) return false
            last = nowNs; return true
        }
    }
    val rates = setOf(5, 10, 15)
}

/**
 * Foreground-only session for `orientation.read`: `{op:"get"}` answers one sample;
 * `{op:"watch", rateHz?}` pushes samples as `constructorientation` events through [emit];
 * `{op:"stop"}` ends the stream. Every delivery re-checks the grant and pause state through
 * [authorize]; a failure stops the stream. [cancel] (menu pause) and [close] stop everything.
 */
internal class ModuleOrientation(context: Context, private val authorize: () -> Unit,
    private val displayRotation: () -> Int, private val emit: (JSONObject) -> Unit,
    /** Told why the host ended an active stream: "paused" or "revoked". */
    private val ended: (String) -> Unit = {}) : SensorEventListener {
    private val handler = Handler(Looper.getMainLooper())
    private val manager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    private val sensor = manager?.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
    private var registered = false
    private var closed = false
    private val throttle = OrientationMath.Throttle(10)
    private var watching = false
    private var pending: ((JSONObject?, ConstructError?) -> Unit)? = null
    private var timeout: Runnable? = null

    private fun check() {
        checkRule(!closed, "RUN_STALE", "Orientation session closed"); authorize()
        checkRule(sensor != null, "ORIENTATION_UNAVAILABLE", "This phone has no compass and tilt sensor")
    }
    private fun register() {
        if (!registered && sensor != null) registered = manager?.registerListener(this, sensor, SensorManager.SENSOR_DELAY_GAME) == true
        checkRule(registered, "ORIENTATION_UNAVAILABLE", "Compass and tilt are unavailable")
    }
    private fun releaseIfIdle() {
        if (registered && pending == null && !watching) { manager?.unregisterListener(this); registered = false }
    }
    fun request(params: JSONObject, done: (JSONObject?, ConstructError?) -> Unit) {
        val keys = params.keys().asSequence().toSet()
        when (params.opt("op")) {
            "get" -> {
                checkRule(keys == setOf("op"), "ORIENTATION_PARAMS", "Expected op:get")
                check(); checkRule(pending == null, "ORIENTATION_BUSY", "An orientation reading is already pending")
                register(); pending = done
                timeout = Runnable {
                    val p = pending; pending = null; timeout = null; releaseIfIdle()
                    p?.invoke(null, ConstructError("ORIENTATION_UNAVAILABLE", "No compass and tilt reading within 2 seconds"))
                }.also { handler.postDelayed(it, 2000) }
            }
            "watch" -> {
                checkRule(keys.all { it in setOf("op", "rateHz") }, "ORIENTATION_PARAMS", "Expected op:watch and optional rateHz")
                val rate = if (params.has("rateHz")) params.get("rateHz") else 10
                checkRule(rate is Int && rate in OrientationMath.rates, "ORIENTATION_PARAMS", "rateHz must be 5, 10 or 15")
                check(); register()
                throttle.rateHz = rate as Int; watching = true
                done(JSONObject().put("watching", true).put("rateHz", rate), null)
            }
            "stop" -> {
                checkRule(keys == setOf("op"), "ORIENTATION_PARAMS", "Expected op:stop")
                watching = false; releaseIfIdle()
                done(JSONObject().put("watching", false), null)
            }
            else -> throw ConstructError("ORIENTATION_PARAMS", "Expected op get, watch or stop")
        }
    }
    override fun onSensorChanged(event: SensorEvent) {
        if (closed || event.sensor.type != Sensor.TYPE_ROTATION_VECTOR) return
        val timestamp = OrientationMath.measurementTime(event.timestamp, SystemClock.elapsedRealtimeNanos(), System.currentTimeMillis()) ?: return
        val sample = OrientationMath.sample(event.values, event.accuracy, displayRotation(), timestamp) ?: return
        pending?.let { done ->
            pending = null; timeout?.let { handler.removeCallbacks(it) }; timeout = null
            try { authorize(); done(sample, null) } catch (e: ConstructError) { done(null, e) }
        }
        if (watching && throttle.admit(event.timestamp)) {
            try { authorize(); emit(sample) } catch (e: ConstructError) {
                watching = false
                ended(if (e.code == "RUN_PAUSED") "paused" else "revoked")
            }
        }
        releaseIfIdle()
    }
    override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) { }
    /**
     * Menu or activity pause: stop the stream (the module must watch again on resume) and fail
     * a pending get. With a [reason], an active stream's end is reported through [ended].
     */
    fun cancel(reason: String? = null) {
        val wasWatching = watching
        watching = false
        timeout?.let { handler.removeCallbacks(it) }; timeout = null
        val p = pending; pending = null
        releaseIfIdle()
        p?.invoke(null, ConstructError("ORIENTATION_CANCELLED", "Orientation reading cancelled"))
        if (wasWatching && reason != null) ended(reason)
    }
    fun close() { closed = true; cancel() }
}
