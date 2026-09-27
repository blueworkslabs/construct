package dev.construct.runtime

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.SystemClock

/**
 * Foreground-only orientation sampling for the native viewfinder (API 0.13). Only derived
 * tilt/heading for the shutter leave the host; no stream reaches a module. Gravity is preferred;
 * the raw accelerometer is the fallback. Every sample keeps its measurement time
 * (`SensorEvent.timestamp`) and its arrival time from [clock] (elapsedRealtimeNanos by default,
 * injectable for tests), so selection at the shutter never mistakes a late delivery for a fresh one.
 */
internal class CaptureSensors(context: Context, private val clock: () -> Long = SystemClock::elapsedRealtimeNanos,
    private val onUpdate: () -> Unit) : SensorEventListener {
    companion object {
        /** Long enough to cover a slow save after exposure; bounded by count as well. */
        const val BUFFER_NS = 5_000_000_000L
        const val MAX_SAMPLES = 1000
        private const val UI_INTERVAL_NS = 100_000_000L
        private const val GRAVITY_ALPHA = 0.5
        private const val ACCELEROMETER_ALPHA = 0.15
    }
    private val manager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
    private val gravitySensor = manager?.getDefaultSensor(Sensor.TYPE_GRAVITY)
    private val accelerometerSensor = if (gravitySensor == null) manager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) else null
    private val rotationSensor = manager?.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
    /** True when tilt comes from the raw accelerometer rather than a gravity sensor. */
    val accelerometerFallback: Boolean get() = gravitySensor == null
    private val gravitySamples = ArrayDeque<SensorSample>()
    private val rotationSamples = ArrayDeque<SensorSample>()
    /** Low-pass "up" vector for the live level readout only; never used for capture metadata. */
    var level: DoubleArray? = null
        private set
    private var lastUpdate = 0L
    private var running = false

    fun now(): Long = clock()

    fun start() {
        if (running || manager == null) return
        running = true
        (gravitySensor ?: accelerometerSensor)?.let { manager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
        rotationSensor?.let { manager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME) }
    }

    fun stop() {
        if (!running) return
        running = false
        manager?.unregisterListener(this)
        level = null; gravitySamples.clear(); rotationSamples.clear()
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (running) record(event.sensor.type, event.timestamp, event.values, event.accuracy)
    }

    override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) { }

    /** One event: [timestampNs] is its measurement time; arrival is stamped from [clock]. */
    fun record(type: Int, timestampNs: Long, values: FloatArray, accuracy: Int) {
        if (values.size < 3) return
        val arrival = clock()
        val sample = SensorSample(timestampNs, arrival, values.copyOf(), accuracy)
        when (type) {
            Sensor.TYPE_GRAVITY, Sensor.TYPE_ACCELEROMETER -> {
                append(gravitySamples, sample, arrival)
                val raw = DoubleArray(3) { values[it].toDouble() }
                if (raw.all { it.isFinite() }) {
                    val alpha = if (type == Sensor.TYPE_ACCELEROMETER) ACCELEROMETER_ALPHA else GRAVITY_ALPHA
                    val previous = level
                    level = if (previous == null) raw else DoubleArray(3) { previous[it] + alpha * (raw[it] - previous[it]) }
                }
            }
            Sensor.TYPE_ROTATION_VECTOR -> append(rotationSamples, sample, arrival)
            else -> return
        }
        if (arrival - lastUpdate >= UI_INTERVAL_NS) { lastUpdate = arrival; onUpdate() }
    }

    private fun append(buffer: ArrayDeque<SensorSample>, sample: SensorSample, now: Long) {
        buffer.addLast(sample)
        while (buffer.isNotEmpty() && (now - buffer.first().arrivalNs > BUFFER_NS || buffer.size > MAX_SAMPLES)) buffer.removeFirst()
    }

    fun gravity(): List<SensorSample> = gravitySamples.toList()
    fun rotation(): List<SensorSample> = rotationSamples.toList()
}
