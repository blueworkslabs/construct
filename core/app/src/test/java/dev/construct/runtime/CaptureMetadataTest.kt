package dev.construct.runtime

import kotlin.math.atan
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.math.tan
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** API 0.13 capture request validation, FOV, tilt and heading derivations, and result shape. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class CaptureMetadataTest {
    private fun denied(code: String, action: () -> Unit) { try { action(); fail("Expected $code") } catch (e: ConstructError) { assertEquals(code, e.code) } }
    private fun rad(d: Double) = Math.toRadians(d)
    private fun deg(r: Double) = Math.toDegrees(r)
    private val g = 9.80665

    // ---- Request validation ----

    @Test fun legacyApisKeepTheExactCaptureRequest() {
        for (api in listOf("0.11.0", "0.12.0")) {
            assertEquals(CaptureOptions(), CaptureOptions.parse(JSONObject("{op:capture}"), api))
            for (args in listOf("{op:capture,level:true}", "{op:capture,zoom:[1,2]}", "{op:capture,level:false}", "{op:shoot}", "{}"))
                denied("CAMERA_PARAMS") { CaptureOptions.parse(JSONObject(args), api) }
        }
        // The pre-existing entry point defaults to the legacy contract.
        denied("CAMERA_PARAMS") { PhotoCaptureActivity.validate(JSONObject("{op:capture,level:true}")) }
    }

    @Test fun api013AcceptsBooleanLevelAndBoundedDistinctPositiveZoomSteps() {
        val api = "0.13.0"
        assertEquals(CaptureOptions(metadata = true), CaptureOptions.parse(JSONObject("{op:capture}"), api))
        assertEquals(CaptureOptions(level = true, metadata = true), CaptureOptions.parse(JSONObject("{op:capture,level:true}"), api))
        assertEquals(CaptureOptions(level = false, metadata = true), CaptureOptions.parse(JSONObject("{op:capture,level:false}"), api))
        val both = CaptureOptions.parse(JSONObject("{op:capture,level:true,zoom:[1,2]}"), api)
        assertTrue(both.level && both.metadata); assertEquals(listOf(1.0, 2.0), both.zoom)
        assertEquals(listOf(1.0, 1.5, 2.0, 3.0), CaptureOptions.parse(JSONObject("{op:capture,zoom:[1,1.5,2,3]}"), api).zoom)
        assertEquals(listOf(0.6), CaptureOptions.parse(JSONObject("{op:capture,zoom:[0.6]}"), api).zoom)
        assertEquals(CaptureOptions(level = true, zoom = listOf(1.0, 2.0), metadata = true),
            PhotoCaptureActivity.validate(JSONObject("{op:capture,level:true,zoom:[1,2]}"), api))
    }

    @Test fun api013RejectsMalformedLevelAndZoom() {
        val api = "0.13.0"
        for (args in listOf(
            "{op:capture,level:'true'}", "{op:capture,level:1}", "{op:capture,level:null}",
            "{op:capture,zoom:2}", "{op:capture,zoom:'2'}", "{op:capture,zoom:[]}", "{op:capture,zoom:[1,2,3,4,5]}",
            "{op:capture,zoom:[1,1]}", "{op:capture,zoom:[1,1.0]}", "{op:capture,zoom:[0]}", "{op:capture,zoom:[-1]}",
            "{op:capture,zoom:['2']}", "{op:capture,zoom:[true]}", "{op:capture,zoom:[1,null]}", "{op:capture,zoom:[[2]]}",
            "{op:capture,zoom:[0.05]}", "{op:capture,zoom:[11]}", "{op:capture,zoom:[1e308]}",
            "{op:capture,free:true}", "{op:capture,path:'/x.jpg'}", "{op:capture,shutter:true}", "{level:true}", "{op:shoot,level:true}",
        )) denied("CAMERA_PARAMS") { CaptureOptions.parse(JSONObject(args), api) }
    }

    @Test fun zoomChipsAreClampedToTheDeviceRangeWithDefaultOneX() {
        assertEquals(listOf(1f, 2f), CaptureGeometry.zoomChoices(listOf(1.0, 2.0), 1f, 8f))
        // A 2× request on a device limited to 1.6× offers 1.6×; clamping never duplicates a chip.
        assertEquals(listOf(1f, 1.6f), CaptureGeometry.zoomChoices(listOf(1.0, 2.0, 3.0), 1f, 1.6f))
        assertEquals(listOf(0.7f, 1f), CaptureGeometry.zoomChoices(listOf(0.5, 1.0), 0.7f, 10f))
        assertEquals(emptyList<Float>(), CaptureGeometry.zoomChoices(listOf(1.0), 0f, 0f))
        assertEquals(1f, CaptureGeometry.initialZoom(listOf(2f, 1f), 1f, 8f))
        assertEquals(2f, CaptureGeometry.initialZoom(listOf(2f, 3f), 1f, 8f))
        assertEquals(1f, CaptureGeometry.initialZoom(emptyList(), 0.6f, 8f))
        assertEquals(1.2f, CaptureGeometry.initialZoom(emptyList(), 1.2f, 8f))
        assertEquals("2×", CaptureGeometry.label(2f)); assertEquals("1.6×", CaptureGeometry.label(1.6f))
    }

    // ---- Field of view ----

    /** 4:3 sensor 5.6 × 4.2 mm, 4.38 mm lens: tan(h/2) = 2.8/4.38. */
    private val lens = LensSpec(4.38, 5.6, 4.2, 4000, 3000, 4000, 3000)

    @Test fun digitalZoomDividesTheTangentNotTheAngle() {
        assertEquals(38.59, CaptureGeometry.zoomedDeg(70.0, 2.0), 0.01) // Astra's corrected example, not 35°
        assertEquals(70.0, CaptureGeometry.zoomedDeg(70.0, 1.0), 1e-9)
        val one = CaptureGeometry.fieldOfView(lens, 4000, 3000, 1.0)!!
        val two = CaptureGeometry.fieldOfView(lens, 4000, 3000, 2.0)!!
        assertEquals(deg(2 * atan(2.8 / 4.38)), one.h, 1e-9)
        assertEquals(deg(2 * atan(2.1 / 4.38)), one.v, 1e-9)
        assertEquals(deg(2 * atan(tan(rad(one.h) / 2) / 2)), two.h, 1e-9)
        assertEquals(deg(2 * atan(tan(rad(one.v) / 2) / 2)), two.v, 1e-9)
        assertTrue("2× must be wider than half the 1× angle", two.h > one.h / 2 + 1)
    }

    @Test fun fovFollowsOutputAspectCropActiveArrayAndOrientation() {
        // Portrait image as opened (after EXIF): h and v swap.
        val portrait = CaptureGeometry.fieldOfView(lens, 3000, 4000, 1.0)!!
        val landscape = CaptureGeometry.fieldOfView(lens, 4000, 3000, 1.0)!!
        assertEquals(landscape.h, portrait.v, 1e-9); assertEquals(landscape.v, portrait.h, 1e-9)
        // Downscaled output keeps the FOV.
        assertEquals(landscape, CaptureGeometry.fieldOfView(lens, 1280, 960, 1.0))
        // 16:9 from a 4:3 sensor keeps the width and crops the height.
        val wide = CaptureGeometry.fieldOfView(lens, 1920, 1080, 1.0)!!
        assertEquals(landscape.h, wide.h, 1e-9)
        assertEquals(deg(2 * atan(5.6 / (16.0 / 9) / 2 / 4.38)), wide.v, 1e-9)
        // 1:1 crops the width to the height.
        val square = CaptureGeometry.fieldOfView(lens, 960, 960, 1.0)!!
        assertEquals(landscape.v, square.h, 1e-9); assertEquals(landscape.v, square.v, 1e-9)
        // Only the active array images: 3800 of 4000 columns narrows the width.
        val cropped = CaptureGeometry.fieldOfView(LensSpec(4.38, 5.6, 4.2, 4000, 3000, 3800, 3000), 3800, 3000, 1.0)!!
        assertEquals(deg(2 * atan(5.6 * 0.95 / 2 / 4.38)), cropped.h, 1e-9)
        // Unusable inputs are omitted, not guessed.
        assertNull(CaptureGeometry.fieldOfView(LensSpec(0.0, 5.6, 4.2, 4000, 3000, 4000, 3000), 4000, 3000, 1.0))
        assertNull(CaptureGeometry.fieldOfView(LensSpec(4.38, 5.6, 4.2, 4000, 3000, 4100, 3000), 4000, 3000, 1.0))
        assertNull(CaptureGeometry.fieldOfView(lens, 0, 3000, 1.0))
        assertNull(CaptureGeometry.fieldOfView(lens, 4000, 3000, Double.NaN))
    }

    @Test fun logicalMultiCameraLensSwitchesAreDetected() {
        val wide = LensSpec(2.0, 5.6, 4.2, 4000, 3000, 4000, 3000)
        val tele2 = LensSpec(8.76, 5.6, 4.2, 4000, 3000, 4000, 3000)
        val tele5 = LensSpec(21.9, 5.6, 4.2, 4000, 3000, 4000, 3000)
        assertFalse(CaptureGeometry.lensSwitchPossible(false, lens, emptyList(), 0.5))
        assertFalse(CaptureGeometry.lensSwitchPossible(false, lens, emptyList(), 2.0))
        assertTrue("Below 1× a wider lens is in use", CaptureGeometry.lensSwitchPossible(true, lens, listOf(lens, wide), 0.7))
        assertFalse(CaptureGeometry.lensSwitchPossible(true, lens, listOf(lens, wide), 1.0))
        assertFalse("Main + ultrawide at 2× is a main-lens crop", CaptureGeometry.lensSwitchPossible(true, lens, listOf(lens, wide), 2.0))
        assertFalse("A 5× tele cannot serve 2×", CaptureGeometry.lensSwitchPossible(true, lens, listOf(lens, wide, tele5), 2.0))
        assertTrue("A 2× tele can serve 2×", CaptureGeometry.lensSwitchPossible(true, lens, listOf(lens, tele2), 2.0))
        assertFalse(CaptureGeometry.lensSwitchPossible(true, lens, listOf(lens, tele2), 1.5))
        assertTrue("Unknown physical lenses count as possible switches", CaptureGeometry.lensSwitchPossible(true, lens, listOf(lens, null), 2.0))
    }

    @Test fun orientationConsistencyUsesCameraXRotation() {
        assertTrue(CaptureGeometry.orientationConsistent(90, true, 960, 1280))
        assertTrue(CaptureGeometry.orientationConsistent(270, true, 960, 1280))
        assertTrue(CaptureGeometry.orientationConsistent(0, true, 1280, 960))
        assertTrue(CaptureGeometry.orientationConsistent(180, true, 1280, 960))
        assertFalse(CaptureGeometry.orientationConsistent(90, true, 1280, 960))
        assertFalse(CaptureGeometry.orientationConsistent(0, true, 960, 1280))
        assertFalse(CaptureGeometry.orientationConsistent(45, true, 1280, 960))
        assertTrue(CaptureGeometry.orientationConsistent(90, true, 960, 960))
    }

    // ---- Tilt ----

    private fun tilt(x: Double, y: Double, z: Double, rotation: Int) = CaptureTilt.angles(x, y, z, rotation)!!
    private fun assertTilt(pitch: Double, roll: Double, actual: Pair<Double, Double>) {
        assertEquals("pitch", pitch, actual.first, 1e-6); assertEquals("roll", roll, actual.second, 1e-6)
    }
    private val s10 = g * sin(rad(10.0))
    private val c10 = g * cos(rad(10.0))

    @Test fun levelPoseReadsZeroInEveryDisplayRotation() {
        assertTilt(0.0, 0.0, tilt(0.0, g, 0.0, 0))  // portrait
        assertTilt(0.0, 0.0, tilt(g, 0.0, 0.0, 1))  // ROTATION_90: device top to the left, +x up
        assertTilt(0.0, 0.0, tilt(0.0, -g, 0.0, 2)) // upside-down portrait
        assertTilt(0.0, 0.0, tilt(-g, 0.0, 0.0, 3)) // ROTATION_270: device top to the right, −x up
    }

    /** Pitch > 0 looks below the horizon: the rear camera (−z) tips down, so "up" gains +z. */
    @Test fun pitchSignsInAllRotations() {
        assertTilt(10.0, 0.0, tilt(0.0, c10, s10, 0)); assertTilt(-10.0, 0.0, tilt(0.0, c10, -s10, 0))
        assertTilt(10.0, 0.0, tilt(c10, 0.0, s10, 1)); assertTilt(-10.0, 0.0, tilt(c10, 0.0, -s10, 1))
        assertTilt(10.0, 0.0, tilt(0.0, -c10, s10, 2)); assertTilt(-10.0, 0.0, tilt(0.0, -c10, -s10, 2))
        assertTilt(10.0, 0.0, tilt(-c10, 0.0, s10, 3)); assertTilt(-10.0, 0.0, tilt(-c10, 0.0, -s10, 3))
        assertTilt(90.0, 0.0, tilt(0.0, 0.0, g, 0)) // lying screen-up: the camera looks at the floor
    }

    /**
     * Roll > 0 when the image's right side points down (horizon higher on the right).
     * Image right in the sensor frame: ROTATION_0 +x, _90 −y, _180 −x, _270 +y; that side
     * pointing down means "up" has a negative component along it.
     */
    @Test fun rollSignsInAllRotations() {
        assertTilt(0.0, 10.0, tilt(-s10, c10, 0.0, 0)); assertTilt(0.0, -10.0, tilt(s10, c10, 0.0, 0))
        assertTilt(0.0, 10.0, tilt(c10, s10, 0.0, 1)); assertTilt(0.0, -10.0, tilt(c10, -s10, 0.0, 1))
        assertTilt(0.0, 10.0, tilt(s10, -c10, 0.0, 2)); assertTilt(0.0, -10.0, tilt(-s10, -c10, 0.0, 2))
        assertTilt(0.0, 10.0, tilt(-c10, -s10, 0.0, 3)); assertTilt(0.0, -10.0, tilt(-c10, s10, 0.0, 3))
        // Rotation locked to portrait while the phone is held landscape (top to the left):
        // the saved image is sideways with its right side up.
        assertTilt(0.0, -90.0, tilt(g, 0.0, 0.0, 0))
        assertNull(CaptureTilt.angles(0.0, 0.0, 0.0, 0)); assertNull(CaptureTilt.angles(0.0, g, 0.0, 4))
    }

    /** Round trip through the solver's own basis(): world up expressed on the camera axes. */
    @Test fun matchesSolverBasisForCombinedPitchAndRoll() {
        // Image right R and image down D in the sensor frame per display rotation; forward is −z.
        val right = mapOf(0 to doubleArrayOf(1.0, 0.0, 0.0), 1 to doubleArrayOf(0.0, -1.0, 0.0), 2 to doubleArrayOf(-1.0, 0.0, 0.0), 3 to doubleArrayOf(0.0, 1.0, 0.0))
        val down = mapOf(0 to doubleArrayOf(0.0, -1.0, 0.0), 1 to doubleArrayOf(-1.0, 0.0, 0.0), 2 to doubleArrayOf(0.0, 1.0, 0.0), 3 to doubleArrayOf(1.0, 0.0, 0.0))
        val forward = doubleArrayOf(0.0, 0.0, -1.0)
        for (rotation in 0..3) for (p in listOf(-40.0, -5.0, 0.0, 12.0, 60.0)) for (r in listOf(-150.0, -30.0, -1.0, 0.0, 2.5, 45.0, 170.0)) {
            // basis(): F·up = −sin p, R·up = −cos p sin r, D·up = −cos p cos r.
            val f = -sin(rad(p)); val rr = -cos(rad(p)) * sin(rad(r)); val d = -cos(rad(p)) * cos(rad(r))
            val up = DoubleArray(3) { i -> g * (f * forward[i] + rr * right[rotation]!![i] + d * down[rotation]!![i]) }
            assertTilt(p, r, tilt(up[0], up[1], up[2], rotation))
        }
    }

    @Test fun tiltSigmaAndOmission() {
        val level = CaptureTilt.measure(0.0, g, 0.0, 0, 0.0, 20, accelerometer = false)!!
        assertEquals(CaptureTilt.BASE_SIGMA_DEG, level.sigmaDeg, 1e-9)
        assertEquals(sqrt(1.0 + 4.0), CaptureTilt.measure(0.0, g, 0.0, 0, 2.0, 20, false)!!.sigmaDeg, 1e-9)
        // Steeper poses inflate sigma (roll comes from the in-image component) until it is omitted.
        assertEquals(1 / cos(rad(60.0)), CaptureTilt.measure(0.0, g * cos(rad(60.0)), g * sin(rad(60.0)), 0, 0.0, 20, false)!!.sigmaDeg, 1e-6)
        assertNull(CaptureTilt.measure(0.0, g * cos(rad(86.0)), g * sin(rad(86.0)), 0, 0.0, 20, false))
        assertNull("stale", CaptureTilt.measure(0.0, g, 0.0, 0, 0.0, CaptureTilt.MAX_AGE_MS + 1, false))
        assertNull("no sample", CaptureTilt.measure(0.0, g, 0.0, 0, 0.0, -1, false))
        assertNull("shaking", CaptureTilt.measure(0.0, g, 0.0, 0, 12.0, 20, false))
        assertNull("accelerating", CaptureTilt.measure(0.0, g + 3, 0.0, 0, 0.0, 20, accelerometer = true))
        assertNotNull("gravity magnitude is not a motion signal", CaptureTilt.measure(0.0, g + 3, 0.0, 0, 0.0, 20, accelerometer = false))
    }

    // ---- Heading ----

    /** Rotation-vector quaternion (x, y, z, w) for the device upright (portrait) with the rear camera at [heading]. */
    private fun upright(heading: Double, extra: Float? = null): FloatArray {
        val h = rad(heading)
        // Columns: device x (right), y (up), z (towards the user) in east/north/up.
        val m = arrayOf(doubleArrayOf(cos(h), 0.0, -sin(h)), doubleArrayOf(-sin(h), 0.0, -cos(h)), doubleArrayOf(0.0, 1.0, 0.0))
        val w = sqrt(maxOf(0.0, 1 + m[0][0] + m[1][1] + m[2][2])) / 2
        val q = if (w > 1e-3) doubleArrayOf((m[2][1] - m[1][2]) / (4 * w), (m[0][2] - m[2][0]) / (4 * w), (m[1][0] - m[0][1]) / (4 * w), w)
        else {
            // Fallback for 180° rotations about a horizontal axis.
            val x = sqrt(maxOf(0.0, 1 + m[0][0] - m[1][1] - m[2][2])) / 2
            doubleArrayOf(x, (m[0][1] + m[1][0]) / (4 * x), (m[0][2] + m[2][0]) / (4 * x), (m[2][1] - m[1][2]) / (4 * x))
        }
        val base = q.map { it.toFloat() }
        return (if (extra == null) base else base + extra).toFloatArray()
    }

    @Test fun headingIsTheRearCameraAzimuth() {
        for (h in listOf(0.0, 45.0, 90.0, 200.0, 350.0)) {
            val a = CaptureHeading.azimuth(upright(h))!!
            val diff = ((a - h) % 360 + 540) % 360 - 180
            assertEquals("heading $h", 0.0, diff, 1e-3)
        }
        // Flat on a table, screen up: the camera looks at the floor, so there is no azimuth.
        assertNull(CaptureHeading.azimuth(floatArrayOf(0f, 0f, 0f, 1f)))
    }

    @Test fun headingIsOmittedWhenUnreliableStaleOrInaccurate() {
        val fresh = 50L
        assertNull(CaptureHeading.measure(upright(90.0), CaptureHeading.STATUS_UNRELIABLE, fresh))
        assertNull(CaptureHeading.measure(upright(90.0), CaptureHeading.STATUS_NO_CONTACT, fresh))
        assertNull(CaptureHeading.measure(null, 3, fresh))
        assertNull(CaptureHeading.measure(upright(90.0), 3, CaptureHeading.MAX_AGE_MS + 1))
        assertNull(CaptureHeading.measure(upright(90.0), 3, -1))
        assertEquals(90.0, CaptureHeading.measure(upright(90.0), 1, fresh)!!.headingDeg, 1e-3)
        assertNull(CaptureHeading.measure(upright(90.0), 3, fresh)!!.accuracyDeg)
        assertNull(CaptureHeading.measure(upright(90.0, -1f), 3, fresh)!!.accuracyDeg)
        assertEquals(deg(0.2), CaptureHeading.measure(upright(90.0, 0.2f), 3, fresh)!!.accuracyDeg!!, 1e-4)
        assertNull("worse than ${CaptureHeading.MAX_ACCURACY_DEG}°", CaptureHeading.measure(upright(90.0, 1.0f), 3, fresh))
    }

    // ---- Result shape ----

    private fun state(back: Boolean = true, logical: Boolean = false, physical: List<LensSpec?> = emptyList(), zoom: Double = 2.0,
        mirrored: Boolean = false, sensorRotation: Int? = 90, width: Int = 960, height: Int = 1280, up: DoubleArray? = doubleArrayOf(0.0, c10, s10),
        upAge: Long = 30, rotation: FloatArray? = upright(120.0, 0.1f), status: Int = 3, lensSpec: LensSpec? = lens) =
        ShutterState(zoom, LensState(lensSpec, logical, physical, back), 0, sensorRotation, width, height, mirrored,
            up, upAge, 0.0, false, rotation, status, 40)

    @Test fun describeReportsEveryReliableMeasurementForTheImageAsOpened() {
        val capture = CaptureResult.describe(state())
        assertEquals(2.0, capture.getDouble("zoomRatio"), 0.0)
        val fov = capture.getJSONObject("fovDeg")
        val expected = CaptureGeometry.fieldOfView(lens, 960, 1280, 2.0)!!
        assertEquals(expected.h, fov.getDouble("h"), 0.01); assertEquals(expected.v, fov.getDouble("v"), 0.01)
        assertTrue("portrait: narrower horizontally", fov.getDouble("h") < fov.getDouble("v"))
        val tilt = capture.getJSONObject("tilt")
        assertEquals(10.0, tilt.getDouble("pitchDeg"), 0.01); assertEquals(0.0, tilt.getDouble("rollDeg"), 0.01)
        assertEquals(1.0 / cos(rad(10.0)), tilt.getDouble("sigmaDeg"), 0.01)
        assertEquals(120.0, capture.getDouble("headingDeg"), 0.1)
        assertEquals("magnetic", capture.getString("headingRef"))
        assertEquals(deg(0.1), capture.getDouble("headingAccuracyDeg"), 0.1)
        assertEquals(setOf("zoomRatio", "fovDeg", "tilt", "headingDeg", "headingRef", "headingAccuracyDeg"), capture.keys().asSequence().toSet())
        assertFalse("no location in capture metadata", capture.toString().contains("lat"))
    }

    @Test fun describeOmitsWhatIsUnavailableOrUnreliable() {
        fun keys(s: ShutterState) = CaptureResult.describe(s).keys().asSequence().toSet()
        assertEquals(setOf("zoomRatio", "fovDeg"), keys(state(back = false)))
        assertEquals(setOf("zoomRatio", "fovDeg", "headingDeg", "headingRef", "headingAccuracyDeg"), keys(state(mirrored = true)))
        assertEquals(setOf("zoomRatio", "fovDeg", "headingDeg", "headingRef", "headingAccuracyDeg"), keys(state(sensorRotation = 0)))
        assertEquals(setOf("zoomRatio", "fovDeg", "headingDeg", "headingRef", "headingAccuracyDeg"), keys(state(sensorRotation = null)))
        assertEquals(setOf("zoomRatio", "fovDeg", "headingDeg", "headingRef", "headingAccuracyDeg"), keys(state(upAge = 5000)))
        assertEquals(setOf("zoomRatio", "fovDeg", "headingDeg", "headingRef", "headingAccuracyDeg"), keys(state(up = null)))
        assertEquals(setOf("zoomRatio", "fovDeg", "tilt"), keys(state(status = 0)))
        assertEquals(setOf("zoomRatio", "fovDeg", "tilt"), keys(state(rotation = null)))
        assertEquals(setOf("zoomRatio", "tilt", "headingDeg", "headingRef", "headingAccuracyDeg"), keys(state(lensSpec = null)))
        val tele = LensSpec(8.76, 5.6, 4.2, 4000, 3000, 4000, 3000)
        assertEquals(setOf("zoomRatio", "tilt", "headingDeg", "headingRef", "headingAccuracyDeg"), keys(state(logical = true, physical = listOf(lens, tele))))
        assertTrue("1× on the same logical camera keeps FOV", "fovDeg" in keys(state(logical = true, physical = listOf(lens, tele), zoom = 1.0)))
        assertEquals(setOf("zoomRatio"), keys(ShutterState(1.0, null, 0, 90, 960, 1280, false, null, -1, 0.0, false, null, 0, -1)))
    }

    @Test fun bridgeResultKeepsLegacyShapeAndAddsIdentityForApi013() {
        val capture = CaptureResult.capture(1.0, FieldOfView(50.0, 66.0), null, null)
        assertEquals("{\"saved\":true}", CaptureResult.forModule(false, true, "pX", capture).toString())
        assertEquals("{\"saved\":false}", CaptureResult.forModule(false, false, null, null).toString())
        assertEquals("{\"saved\":false}", CaptureResult.forModule(true, false, null, null).toString())
        val modern = CaptureResult.forModule(true, true, "pAbc", capture)
        assertEquals(setOf("saved", "id", "capture"), modern.keys().asSequence().toSet())
        assertEquals("pAbc", modern.getString("id"))
        assertEquals(66.0, modern.getJSONObject("capture").getJSONObject("fovDeg").getDouble("v"), 0.0)
        denied("CAMERA_CAPTURE") { CaptureResult.forModule(true, true, null, capture) }
        denied("CAMERA_CAPTURE") { CaptureResult.forModule(true, true, "pAbc", null) }
    }

    @Test fun headingRoundingStaysInNormalizedRange() {
        for ((input, expected) in listOf(359.96 to 0.0, 359.94 to 359.9, 0.04 to 0.0)) {
            val result = CaptureResult.capture(1.0, null, null, Heading(input, 5.0))
            assertEquals(expected, result.getDouble("headingDeg"), 1e-9)
        }
    }

    // ---- API version gating ----

    private fun manifest(api: String, vararg caps: String, target: String = api): ByteArray = JSONObject().put("schemaVersion", 1)
        .put("id", "dev.construct.capture").put("name", "Capture").put("version", "0.1.0")
        .put("entry", "index.html").put("runtime", JSONObject().put("kind", "webview-js"))
        .put("constructApi", JSONObject().put("min", api).put("target", target))
        .put("capabilities", JSONArray().also { a -> caps.forEach { a.put(JSONObject().put("id", it).put("reason", "Test").put("optional", true)) } })
        .toString().toByteArray()

    @Test fun api013IsAcceptedWhereApi012WasAndOnlyItGetsCaptureMetadata() {
        val m = Packages.manifest(manifest("0.13.0", "camera.photo", "image.read", "photos.library", "location.read", "storage.kv"))
        assertEquals("0.13.0", m.api)
        assertTrue(ModuleLayout.cornerAware("0.13.0"))
        assertTrue(CaptureOptions.metadataApi("0.13.0"))
        for (api in listOf("0.10.0", "0.11.0", "0.12.0")) assertFalse(CaptureOptions.metadataApi(api))
        for (retired in listOf("camera.capture", "photo.measure", "sky.watch"))
            denied("API_INCOMPATIBLE") { Packages.manifest(manifest("0.13.0", retired)) }
        denied("API_INCOMPATIBLE") { Packages.manifest(manifest("0.12.0", "image.read", target = "0.13.0")) }
        denied("API_INCOMPATIBLE") { Packages.manifest(manifest("0.14.0", "image.read")) }
        // 0.12 modules keep working unchanged.
        assertEquals("0.12.0", Packages.manifest(manifest("0.12.0", "camera.photo", "image.read", "photos.library")).api)
    }
}
