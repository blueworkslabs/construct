package dev.construct.runtime

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorManager
import android.os.Looper
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowSensor
import org.robolectric.shadows.ShadowSensorManager
import kotlin.math.sqrt
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** API 0.14 orientation.read: frames, signs, accuracy, rate cap and manifest gating. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class OrientationTest {
    private fun denied(code: String, action: () -> Unit) { try { action(); fail("Expected $code") } catch (e: ConstructError) { assertEquals(code, e.code) } }
    private val E = doubleArrayOf(1.0, 0.0, 0.0); private val W = doubleArrayOf(-1.0, 0.0, 0.0)
    private val N = doubleArrayOf(0.0, 1.0, 0.0); private val S = doubleArrayOf(0.0, -1.0, 0.0)
    private val UP = doubleArrayOf(0.0, 0.0, 1.0)

    /** Rotation-vector values (x, y, z, w, accuracy) for device axes given in world east/north/up. */
    private fun vector(x: DoubleArray, y: DoubleArray, z: DoubleArray, accuracyRad: Double = -1.0): FloatArray {
        // Matrix columns are the device axes in world coordinates.
        val m = arrayOf(doubleArrayOf(x[0], y[0], z[0]), doubleArrayOf(x[1], y[1], z[1]), doubleArrayOf(x[2], y[2], z[2]))
        val trace = m[0][0] + m[1][1] + m[2][2]
        val (qw, qx, qy, qz) = if (trace > 0) {
            val s = sqrt(trace + 1.0) * 2
            listOf(0.25 * s, (m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s)
        } else if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
            val s = sqrt(1.0 + m[0][0] - m[1][1] - m[2][2]) * 2
            listOf((m[2][1] - m[1][2]) / s, 0.25 * s, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s)
        } else if (m[1][1] > m[2][2]) {
            val s = sqrt(1.0 + m[1][1] - m[0][0] - m[2][2]) * 2
            listOf((m[0][2] - m[2][0]) / s, (m[0][1] + m[1][0]) / s, 0.25 * s, (m[1][2] + m[2][1]) / s)
        } else {
            val s = sqrt(1.0 + m[2][2] - m[0][0] - m[1][1]) * 2
            listOf((m[1][0] - m[0][1]) / s, (m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, 0.25 * s)
        }
        return floatArrayOf(qx.toFloat(), qy.toFloat(), qz.toFloat(), qw.toFloat(), accuracyRad.toFloat())
    }
    private val high = SensorManager.SENSOR_STATUS_ACCURACY_HIGH
    private fun sample(v: FloatArray, rotation: Int = 0, status: Int = high) = OrientationMath.sample(v, status, rotation, 1234L)!!

    @Test fun flatPhoneReportsTheBearingOfItsTopEdge() {
        // Screen up, top edge north: camera looks straight down.
        val north = sample(vector(E, N, UP))
        assertEquals("flat", north.getString("pose"))
        assertEquals(0.0, north.getDouble("azimuthDeg"), 0.2)
        assertEquals(90.0, north.getDouble("pitchDeg"), 0.2)
        assertEquals("magnetic", north.getString("headingRef"))
        assertEquals(1234L, north.getLong("timestamp"))
        // Top edge east (x = y × z points south).
        assertEquals(90.0, sample(vector(S, E, UP)).getDouble("azimuthDeg"), 0.2)
        // Top edge south-west.
        val sw = doubleArrayOf(-0.70710678, -0.70710678, 0.0); val nw = doubleArrayOf(-0.70710678, 0.70710678, 0.0)
        assertEquals(225.0, sample(vector(nw, sw, UP)).getDouble("azimuthDeg"), 0.2)
    }

    @Test fun displayRotationChangesWhichEdgeIsTheTop() {
        // Same physical pose; in ROTATION_90 the screen's top is device +x (east here).
        assertEquals(90.0, sample(vector(E, N, UP), rotation = 1).getDouble("azimuthDeg"), 0.2)
        assertEquals(180.0, sample(vector(E, N, UP), rotation = 2).getDouble("azimuthDeg"), 0.2)
        assertEquals(270.0, sample(vector(E, N, UP), rotation = 3).getDouble("azimuthDeg"), 0.2)
        assertNull(OrientationMath.sample(vector(E, N, UP), high, 4, 0))
    }

    @Test fun uprightPhoneReportsTheCameraAxisWithSolverSigns() {
        // Portrait, rear camera looking east: z = west, y = up, x = y × z = south.
        val east = sample(vector(S, UP, W))
        assertEquals("upright", east.getString("pose"))
        assertEquals(90.0, east.getDouble("azimuthDeg"), 0.2)
        assertEquals(0.0, east.getDouble("pitchDeg"), 0.2)
        assertEquals(0.0, east.getDouble("rollDeg"), 0.2)
        // Tipped 30° down toward the ground: pitch > 0 (below the horizon).
        val c = 0.8660254; val s = 0.5
        val down = sample(vector(S, doubleArrayOf(s, 0.0, c), doubleArrayOf(-c, 0.0, s)))
        assertEquals(30.0, down.getDouble("pitchDeg"), 0.3)
        assertEquals(90.0, down.getDouble("azimuthDeg"), 0.3)
        // Rolled so the right side is down: roll > 0.
        val rolled = sample(vector(doubleArrayOf(0.0, -c, -s), doubleArrayOf(0.0, -s, c), W))
        assertTrue(rolled.getDouble("rollDeg") > 25)
    }

    @Test fun accuracyComesFromTheSensorAndUnreliableOmitsTheHeading() {
        assertEquals(11.5, sample(vector(E, N, UP, accuracyRad = 0.2)).getDouble("accuracyDeg"), 0.1)
        assertEquals(8.0, sample(vector(E, N, UP)).getDouble("accuracyDeg"), 0.0)
        assertEquals(15.0, sample(vector(E, N, UP), status = SensorManager.SENSOR_STATUS_ACCURACY_MEDIUM).getDouble("accuracyDeg"), 0.0)
        val low = sample(vector(E, N, UP), status = SensorManager.SENSOR_STATUS_ACCURACY_LOW)
        assertEquals(30.0, low.getDouble("accuracyDeg"), 0.0); assertFalse(low.getBoolean("calibrate"))
        assertTrue(sample(vector(E, N, UP, accuracyRad = 0.8)).getBoolean("calibrate"))
        for (status in listOf(SensorManager.SENSOR_STATUS_UNRELIABLE, SensorManager.SENSOR_STATUS_NO_CONTACT)) {
            val bad = sample(vector(E, N, UP), status = status)
            assertFalse(bad.has("azimuthDeg")); assertFalse(bad.has("accuracyDeg")); assertFalse(bad.has("headingRef"))
            assertTrue(bad.getBoolean("calibrate")); assertTrue(bad.has("pitchDeg"))
        }
        // Values are rounded to 0.1°, and a malformed vector is not a reading.
        val v = sample(vector(nwAxis(), swAxis(), UP))
        assertEquals(v.getDouble("azimuthDeg"), Math.round(v.getDouble("azimuthDeg") * 10) / 10.0, 0.0)
        assertNull(OrientationMath.sample(floatArrayOf(Float.NaN, 0f, 0f, 1f), high, 0, 0))
        assertNull(OrientationMath.sample(floatArrayOf(0.9f, 0.9f, 0.9f, 0.9f), high, 0, 0))
    }
    private fun nwAxis() = doubleArrayOf(0.6, 0.8, 0.0)
    private fun swAxis() = doubleArrayOf(-0.8, 0.6, 0.0)

    @Test fun throttleCapsDeliveriesPerSecond() {
        val t = OrientationMath.Throttle(10)
        assertTrue(t.admit(0)); assertFalse(t.admit(50_000_000)); assertTrue(t.admit(100_000_000))
        assertFalse(t.admit(150_000_000)); assertTrue(t.admit(1_000_000_000))
        assertEquals(setOf(5, 10, 15), OrientationMath.rates)
    }

    @Test fun onlyApi014ModulesMayDeclareOrientation() {
        fun manifest(api: String, vararg caps: String): ByteArray = JSONObject().put("schemaVersion", 1)
            .put("id", "dev.construct.compass").put("name", "Compass").put("version", "0.1.0")
            .put("entry", "index.html").put("runtime", JSONObject().put("kind", "webview-js"))
            .put("constructApi", JSONObject().put("min", api).put("target", api))
            .put("capabilities", JSONArray().also { a -> caps.forEach { a.put(JSONObject().put("id", it).put("reason", "Test").put("optional", true)) } })
            .toString().toByteArray()
        val m = Packages.manifest(manifest("0.14.0", "orientation.read", "location.read", "storage.kv"))
        assertEquals("0.14.0", m.api)
        val cap = m.capabilities.first { it.id == "orientation.read" }
        assertTrue(cap.explicitOptIn); assertEquals("Allow reading compass and tilt", cap.label)
        for (api in listOf("0.9.0", "0.12.0", "0.13.0")) denied("API_INCOMPATIBLE") { Packages.manifest(manifest(api, "orientation.read")) }
        // 0.14 is accepted wherever 0.13 is, for existing capabilities too.
        assertEquals("0.14.0", Packages.manifest(manifest("0.14.0", "camera.photo", "image.read", "photos.library")).api)
        assertTrue(ModuleLayout.cornerAware("0.14.0")); assertTrue(CaptureOptions.metadataApi("0.14.0"))
    }

    // ---- Session lifecycle on a shadow sensor ----
    private class Rig {
        val context: Context = RuntimeEnvironment.getApplication()
        val manager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
        val shadow: ShadowSensorManager = shadowOf(manager)
        val sensor: Sensor = ShadowSensor.newInstance(Sensor.TYPE_ROTATION_VECTOR).also { shadow.addSensor(it) }
        // Robolectric advances its clock at millisecond resolution.
        val clockOrigin = android.os.SystemClock.elapsedRealtimeNanos() + 1_000_000L
        var granted = true
        var activityPaused = false
        val emitted = mutableListOf<JSONObject>()
        val ended = mutableListOf<String>()
        // Mirrors ModuleWebView: an activity pause denies before the grant is checked.
        val session = ModuleOrientation(context, {
            checkRule(!activityPaused, "RUN_PAUSED", "paused"); checkRule(granted, "CAPABILITY_DENIED", "off")
        }, { 0 }, { emitted += it }) { ended += it }
        var result: JSONObject? = null; var error: ConstructError? = null
        fun request(json: String) { result = null; error = null; session.request(JSONObject(json)) { v, e -> result = v; error = e } }
        fun send(ns: Long, values: FloatArray = floatArrayOf(0f, 0f, 0f, 1f, 0.1f)) {
            val event = ShadowSensorManager.createSensorEvent(5, Sensor.TYPE_ROTATION_VECTOR)
            val timestamp = clockOrigin + ns
            val advance = timestamp - android.os.SystemClock.elapsedRealtimeNanos()
            if (advance > 0) org.robolectric.shadows.ShadowSystemClock.advanceBy(java.time.Duration.ofNanos(advance))
            values.copyInto(event.values); event.timestamp = timestamp; event.accuracy = SensorManager.SENSOR_STATUS_ACCURACY_HIGH
            event.sensor = sensor
            shadow.sendSensorEventToListeners(event)
        }
        val listening get() = shadow.hasListener(session)
    }

    @Test fun watchIsRateCappedAndStopsOnStopPauseRevokeAndClose() {
        val r = Rig()
        r.request("{op:'watch'}")
        assertEquals(true, r.result!!.getBoolean("watching")); assertEquals(10, r.result!!.getInt("rateHz")); assertTrue(r.listening)
        for (i in 1..20) r.send(i * 25_000_000L) // 40 Hz for half a second
        assertEquals(5, r.emitted.size)
        assertEquals(0.0, r.emitted[0].getDouble("azimuthDeg"), 0.2)
        r.request("{op:'stop'}"); assertEquals(false, r.result!!.getBoolean("watching")); assertFalse(r.listening)
        r.send(2_000_000_000L); assertEquals(5, r.emitted.size)
        // Menu pause (stopEffects → cancel) ends the stream; the module must watch again.
        r.request("{op:'watch',rateHz:5}"); r.session.cancel(); assertFalse(r.listening)
        r.send(3_000_000_000L); assertEquals(5, r.emitted.size)
        // A revoked grant stops the stream at the next sample.
        r.request("{op:'watch',rateHz:15}"); r.granted = false
        r.send(4_000_000_000L); assertEquals(5, r.emitted.size); assertFalse(r.listening)
        assertEquals(listOf("revoked"), r.ended)
        r.granted = true; r.request("{op:'watch'}"); r.session.close(); assertFalse(r.listening)
        denied("RUN_STALE") { r.request("{op:'watch'}") }
    }

    @Test fun getAnswersOneSampleOrTimesOutAndParamsAreStrict() {
        val r = Rig()
        r.request("{op:'get'}"); assertNull(r.result); assertTrue(r.listening)
        denied("ORIENTATION_BUSY") { r.request("{op:'get'}") }
        r.send(1_000_000L)
        assertEquals("flat", r.result!!.getString("pose")); assertFalse(r.listening)
        r.request("{op:'get'}")
        shadowOf(Looper.getMainLooper()).idleFor(java.time.Duration.ofSeconds(3))
        assertEquals("ORIENTATION_UNAVAILABLE", r.error!!.code); assertFalse(r.listening)
        r.request("{op:'get'}"); r.session.cancel(); assertEquals("ORIENTATION_CANCELLED", r.error!!.code)
        for (bad in listOf("{op:'watch',rateHz:30}", "{op:'watch',rateHz:'10'}", "{op:'watch',extra:1}", "{op:'get',x:1}", "{op:'stop',x:1}", "{op:'spin'}", "{}"))
            denied("ORIENTATION_PARAMS") { r.request(bad) }
        r.granted = false; denied("CAPABILITY_DENIED") { r.request("{op:'get'}") }
    }

    @Test fun noRotationSensorIsUnavailable() {
        val context: Context = RuntimeEnvironment.getApplication()
        val session = ModuleOrientation(context, { }, { 0 }, { })
        denied("ORIENTATION_UNAVAILABLE") { session.request(JSONObject("{op:'watch'}")) { _, _ -> } }
    }

    @Test fun repeatedWatchAndStopCannotResetDeliveryBudget() {
        val r = Rig()
        for (i in 1..20) {
            r.request("{op:'watch',rateHz:10}")
            r.send(i * 25_000_000L)
            r.request("{op:'stop'}")
        }
        assertEquals(5, r.emitted.size)
    }

    @Test fun failedRegistrationDoesNotLeaveGetBusy() {
        val r = Rig()
        r.shadow.setForceListenersToFail(true)
        denied("ORIENTATION_UNAVAILABLE") { r.request("{op:'get'}") }
        r.shadow.setForceListenersToFail(false)
        r.request("{op:'get'}")
        r.send(1_000_000L)
        assertNotNull(r.result)
        assertFalse(r.listening)
    }

    @Test fun activityPauseStopsTheStreamDeniesRequestsAndNeedsAFreshWatch() {
        val r = Rig()
        r.request("{op:'watch'}"); r.send(10_000_000L); assertEquals(1, r.emitted.size)
        // onPause without onStop (another window in front): ModuleSessionView.stopForeground.
        r.activityPaused = true; r.session.cancel("paused")
        assertFalse(r.listening); assertEquals(listOf("paused"), r.ended)
        r.send(500_000_000L); assertEquals(1, r.emitted.size)
        for (op in listOf("{op:'watch'}", "{op:'get'}")) denied("RUN_PAUSED") { r.request(op) }
        // A second pause signal for an idle session reports nothing more.
        r.session.cancel("paused"); assertEquals(listOf("paused"), r.ended)
        // Resume does not restart it; the module asks again.
        r.activityPaused = false
        r.send(1_000_000_000L); assertEquals(1, r.emitted.size); assertFalse(r.listening)
        r.request("{op:'watch'}"); r.send(1_200_000_000L); assertEquals(2, r.emitted.size)
        // A sample arriving while paused (before the pause hook ran) ends the stream too.
        r.activityPaused = true; r.send(1_400_000_000L)
        assertEquals(2, r.emitted.size); assertFalse(r.listening); assertEquals(listOf("paused", "paused"), r.ended)
        // Menu pause (stopEffects → cancel without a reason) keeps its visibility-event contract.
        r.activityPaused = false; r.request("{op:'watch'}"); r.session.cancel()
        assertEquals(2, r.ended.size); assertFalse(r.listening)
    }

    @Test fun sessionViewForwardsActivityPauseOnce() {
        val view = ModuleSessionView(RuntimeEnvironment.getApplication())
        var stops = 0
        view.stopForeground = { stops++ }
        view.setActivityPaused(true); view.setActivityPaused(true)
        assertTrue(view.activityPaused.get()); assertEquals(1, stops)
        view.setActivityPaused(false); assertFalse(view.activityPaused.get()); assertEquals(1, stops)
        // Picker flow is independent: the menu gate still pauses and resumes as before.
        view.pauseForPicker(); assertTrue(view.gate.paused.get())
        view.setActivityPaused(true); view.setActivityPaused(false); view.setMenuPaused(false)
        assertFalse(view.gate.paused.get()); assertEquals(2, stops)
        view.destroy()
    }
    @Test fun queuedOrientationReplyCannotCrossActivityPauseOrResume() {
        val view = ModuleSessionView(RuntimeEnvironment.getApplication())
        val request = view.activityGeneration.get()
        val pickerRequest = view.gate.generation.get()
        view.authorizeOrientation(request)
        view.setActivityPaused(true)
        denied("RUN_PAUSED") { view.authorizeOrientation(request) }
        denied("RUN_PAUSED") { view.authorizeOrientation() }
        view.setActivityPaused(false)
        denied("RUN_PAUSED") { view.authorizeOrientation(request) }
        view.authorizeOrientation()
        // Activity transitions do not change the separate picker/menu epoch.
        view.gate.authorizeReply(pickerRequest)
        view.destroy()
    }

    @Test fun measurementTimestampPreservesAgeAndRejectsStaleOrFutureSamples() {
        assertEquals(9_850L, OrientationMath.measurementTime(850_000_000L, 1_000_000_000L, 10_000L))
        assertEquals(9_750L, OrientationMath.measurementTime(750_000_000L, 1_000_000_000L, 10_000L))
        assertNull(OrientationMath.measurementTime(749_999_999L, 1_000_000_000L, 10_000L))
        assertNull(OrientationMath.measurementTime(1_000_000_001L, 1_000_000_000L, 10_000L))
        assertNull(OrientationMath.measurementTime(0L, 1_000_000_000L, 10_000L))
    }


    @Test fun foregroundNeedsResumedAndTopResumedOnAndroidQ() {
        val q = ForegroundEligibility(needsTopResumed = true).also { it.windowFocus(true) }
        assertFalse(q.eligible)
        q.resume(); assertFalse("onResume precedes top-resumed true", q.eligible)
        q.topResumed(true); assertTrue(q.eligible)
        q.topResumed(false); assertFalse("multi-window: another app is top-resumed, no onPause", q.eligible)
        q.topResumed(true); assertTrue(q.eligible)
        q.pause(); assertFalse(q.eligible)
        q.resume(); assertTrue("still top-resumed", q.eligible)
        q.topResumed(false); q.pause(); q.topResumed(true); assertFalse("paused wins", q.eligible)
        // Before Android 10 only one activity is resumed at a time.
        val legacy = ForegroundEligibility(needsTopResumed = false).also { it.windowFocus(true) }
        legacy.resume(); assertTrue(legacy.eligible); legacy.topResumed(false); assertTrue(legacy.eligible)
        legacy.pause(); assertFalse(legacy.eligible)
    }

    @Test fun topResumedLossStopsOnceAndRegainingDoesNotRestart() {
        val view = ModuleSessionView(RuntimeEnvironment.getApplication())
        val fg = ForegroundEligibility(needsTopResumed = true).also { it.windowFocus(true) }
        val r = Rig()
        var stops = 0
        view.stopForeground = { stops++; r.activityPaused = true; r.session.cancel("paused") }
        fun apply() { view.setActivityPaused(!fg.eligible); r.activityPaused = view.activityPaused.get() }
        // Late WebView creation before any callback: not eligible, so requests are denied.
        apply(); denied("RUN_PAUSED") { r.request("{op:'watch'}") }
        fg.resume(); apply(); denied("RUN_PAUSED") { r.request("{op:'watch'}") }
        fg.topResumed(true); apply()
        stops = 0 // the late-created view started ineligible
        r.request("{op:'watch'}"); r.send(10_000_000L); assertEquals(1, r.emitted.size)
        // Another app takes top-resumed in split screen: sampling stops, one terminal event.
        fg.topResumed(false); apply()
        assertFalse(r.listening); assertEquals(listOf("paused"), r.ended); assertEquals(1, stops)
        denied("RUN_PAUSED") { r.request("{op:'get'}") }
        // A later onPause while already ineligible neither stops again nor reports again.
        fg.pause(); apply(); assertEquals(1, stops); assertEquals(1, r.ended.size)
        // Regaining eligibility does not restart the watch.
        fg.resume(); fg.topResumed(true); apply()
        r.send(500_000_000L); assertEquals(1, r.emitted.size); assertFalse(r.listening)
        r.request("{op:'watch'}"); r.send(700_000_000L); assertEquals(2, r.emitted.size)
        // Menu and picker gating stay independent of foreground eligibility.
        view.pauseForPicker(); assertTrue(view.gate.paused.get()); assertFalse(view.activityPaused.get())
        view.setMenuPaused(false); assertFalse(view.gate.paused.get())
        view.destroy()
    }
    @Test fun focusLossWithoutPauseStopsOnceAndDoesNotRestart() {
        for (needsTop in listOf(false, true)) {
            val fg = ForegroundEligibility(needsTop)
            val view = ModuleSessionView(RuntimeEnvironment.getApplication())
            val r = Rig()
            view.stopForeground = { r.session.cancel("paused") }
            fun apply() { view.setActivityPaused(!fg.eligible); r.activityPaused = view.activityPaused.get() }
            fg.resume(); fg.topResumed(true); apply()
            denied("RUN_PAUSED") { r.request("{op:'watch'}") }
            fg.windowFocus(true); apply(); r.request("{op:'watch'}"); r.send(10_000_000L)
            fg.windowFocus(false); apply()
            assertFalse(r.listening); assertEquals(listOf("paused"), r.ended)
            for (op in listOf("get", "watch")) denied("RUN_PAUSED") { r.request("{op:'$op'}") }
            fg.topResumed(false); apply(); fg.pause(); apply()
            assertEquals(1, r.ended.size)
            fg.resume(); fg.topResumed(true); apply(); assertFalse(fg.eligible)
            fg.windowFocus(true); apply(); r.send(500_000_000L)
            assertFalse(r.listening); assertEquals(1, r.emitted.size)
            r.request("{op:'watch'}"); r.send(700_000_000L); assertEquals(2, r.emitted.size)
            r.session.close(); view.destroy()
        }
    }

    @Test fun getAndWatchShareOnePersistentDeliveryBudget() {
        for (withWatch in listOf(false, true)) {
            val r = Rig()
            if (withWatch) r.request("{op:'watch',rateHz:15}")
            r.request("{op:'get'}")
            var reads = 0
            // The module asks again after every answer; 100 sensor callbacks per second.
            for (i in 1..100) {
                r.send(i * 10_000_000L)
                if (r.result?.has("pose") == true) {
                    reads++
                    // Neither repeated stop/watch nor a new get may reset the budget.
                    if (withWatch) { r.request("{op:'stop'}"); r.request("{op:'watch',rateHz:15}") }
                    r.request("{op:'get'}")
                }
            }
            assertTrue(reads > 0)
            assertTrue("combined get/watch exceeded 15 per second", reads + r.emitted.size <= 15)
            r.session.close()
        }
    }

}
