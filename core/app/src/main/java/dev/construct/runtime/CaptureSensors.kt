package dev.construct.runtime

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.SystemClock
import kotlin.math.acos
import kotlin.math.sqrt

/**
 * Foreground-only orientation sampling for the native viewfinder (API 0.13). Only the
 * shutter snapshot leaves the host, as derived tilt/heading; no stream reaches a module.
 * Gravity is preferred; a low-pass-filtered accelerometer is the fallback.
 */
internal class CaptureSensors(context: Context, private val onUpdate: () -> Unit) : SensorEventListener {
    class Snapshot(val up: DoubleArray?, val upAgeMs: Long, val spreadDeg: Double, val accelerometer: Boolean,
        val rotation: FloatArray?, val rotationStatus: Int, val rotationAgeMs: Long)
    companion object {
        private const val WINDOW_MS = 500L
        private const val UI_INTERVAL_MS = 100L
        private const val GRAVITY_ALPHA = 0.5
        private const val ACCELEROMETER_ALPHA = 0.15
    }
    private val manager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    private val gravity = manager?.getDefaultSensor(Sensor.TYPE_GRAVITY)
    private val accelerometer = if (gravity == null) manager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) else null
    private val rotationVector = manager?.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
    val tiltAvailable: Boolean get() = gravity != null || accelerometer != null
    private var filtered: DoubleArray? = null
    private var upTime = 0L
    private val recent = ArrayDeque<Pair<Long, DoubleArray>>()
    private var rotation: FloatArray? = null
    private var rotationStatus = SensorManager.SENSOR_STATUS_UNRELIABLE
    private var rotationTime = 0L
    private var lastUpdate = 0L
    private var running = false

    fun start() {
        if (running || manager == null) return
        running = true
        (gravity ?: accelerometer)?.let { manager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
        rotationVector?.let { manager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
    }

    fun stop() {
        if (!running) return
        running = false
        manager?.unregisterListener(this)
        filtered = null; recent.clear(); rotation = null
        rotationStatus = SensorManager.SENSOR_STATUS_UNRELIABLE
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (!running || event.values.size < 3) return
        val now = SystemClock.elapsedRealtime()
        when (event.sensor.type) {
            Sensor.TYPE_GRAVITY, Sensor.TYPE_ACCELEROMETER -> {
                val raw = doubleArrayOf(event.values[0].toDouble(), event.values[1].toDouble(), event.values[2].toDouble())
                if (raw.any { !it.isFinite() }) return
                val alpha = if (event.sensor.type == Sensor.TYPE_ACCELEROMETER) ACCELEROMETER_ALPHA else GRAVITY_ALPHA
                val previous = filtered
                filtered = if (previous == null) raw else DoubleArray(3) { previous[it] + alpha * (raw[it] - previous[it]) }
                upTime = now
                val norm = sqrt(raw[0] * raw[0] + raw[1] * raw[1] + raw[2] * raw[2])
                if (norm > 1e-6) recent.addLast(now to DoubleArray(3) { raw[it] / norm })
                while (recent.isNotEmpty() && (now - recent.first().first > WINDOW_MS || recent.size > 200)) recent.removeFirst()
            }
            Sensor.TYPE_ROTATION_VECTOR -> {
                rotation = event.values.copyOf(); rotationStatus = event.accuracy; rotationTime = now
            }
        }
        if (now - lastUpdate >= UI_INTERVAL_MS) { lastUpdate = now; onUpdate() }
    }

    override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {
        if (sensor.type == Sensor.TYPE_ROTATION_VECTOR) rotationStatus = accuracy
    }

    /** Angular RMS (degrees) of the recent raw samples around their mean direction. */
    private fun spread(): Double {
        if (recent.size < 2) return 0.0
        val mean = DoubleArray(3)
        recent.forEach { (_, v) -> for (i in 0..2) mean[i] += v[i] }
        val norm = sqrt(mean[0] * mean[0] + mean[1] * mean[1] + mean[2] * mean[2])
        if (norm < 1e-6) return Double.POSITIVE_INFINITY
        val sum = recent.sumOf { (_, v) ->
            val cos = ((v[0] * mean[0] + v[1] * mean[1] + v[2] * mean[2]) / norm).coerceIn(-1.0, 1.0)
            val angle = Math.toDegrees(acos(cos)); angle * angle
        }
        return sqrt(sum / recent.size)
    }

    fun snapshot(): Snapshot {
        val now = SystemClock.elapsedRealtime()
        val up = filtered?.copyOf()
        val vector = rotation?.copyOf()
        return Snapshot(up, if (up == null) -1 else now - upTime, spread(), gravity == null,
            vector, rotationStatus, if (vector == null) -1 else now - rotationTime)
    }
}
