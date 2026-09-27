package dev.construct.runtime

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.BitmapFactory
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CameraMetadata
import android.media.ExifInterface
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.camera.camera2.interop.Camera2CameraInfo
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.Camera
import androidx.camera.core.CameraInfo
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.unit.dp
import androidx.compose.ui.draw.clipToBounds
import android.view.ViewOutlineProvider
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Reusable native acquisition surface: preview and human shutter, no album or analysis workflow. */
class PhotoCaptureActivity : ComponentActivity() {
    companion object {
        private val launched = AtomicBoolean(false)
        private val io = Executors.newSingleThreadExecutor()
        /** Legacy callers (API < 0.13) accept exactly `{op:"capture"}`. */
        internal fun validate(args: JSONObject, api: String = "0.11.0"): CaptureOptions = CaptureOptions.parse(args, api)
        fun hasPermission(context: Context) = context.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        internal fun intent(context: Context, installed: Installed, options: CaptureOptions = CaptureOptions()) = Intent(context, PhotoCaptureActivity::class.java)
            .putExtra("module", installed.manifest.id).putExtra("digest", installed.digest)
            .putExtra("level", options.level).putExtra("zoom", options.zoom.toDoubleArray())

    }
    private lateinit var store: ModuleStore
    private lateinit var installed: Installed
    private lateinit var photos: CameraPhotos
    private val session = Any()
    @Volatile private var live = false
    private var provider: ProcessCameraProvider? = null
    private var capture: ImageCapture? = null
    private var camera: Camera? = null
    private var lens: LensState? = null
    private var options = CaptureOptions()
    private var sensors: CaptureSensors? = null
    private var shutter: CaptureSensors.Snapshot? = null
    private var zoomRequest = 0
    private var zoomChoices by mutableStateOf(emptyList<Float>())
    private var zoomSelected by mutableStateOf(1f)
    private var zoomPending by mutableStateOf(false)
    private var level by mutableStateOf<Pair<Double, Double>?>(null)
    private var rearCamera by mutableStateOf(true)
    private var preview: PreviewView? = null
    private var bindGeneration = 0
    private var temporary: File? = null
    private var status by mutableStateOf("Opening camera…")
    private var ready by mutableStateOf(false)
    private var busy by mutableStateOf(false)
    private var front by mutableStateOf(false)
    private var canSwitch by mutableStateOf(false)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        store = ModuleStore.shared(this)
        try {
            checkRule(launched.compareAndSet(false, true), "CAMERA_BUSY", "A capture is already open")
            installed = store.inventory().modules.single { it.manifest.id == intent.getStringExtra("module") && it.digest == intent.getStringExtra("digest") }
            File(cacheDir, "camera-pending").listFiles()?.filter { it.isFile && it.name.startsWith("capture-") }?.forEach { it.delete() }
            photos = CameraPhotos(this, installed.manifest.id)
            // API 0.13 options only; the bridge rejected them for earlier APIs, and the manifest decides here.
            val metadata = CaptureOptions.metadataApi(installed.manifest.api)
            options = if (!metadata) CaptureOptions() else CaptureOptions(intent.getBooleanExtra("level", false),
                intent.getDoubleArrayExtra("zoom")?.toList().orEmpty().take(CaptureOptions.MAX_ZOOM_CHOICES), true)
            if (metadata) sensors = CaptureSensors(this) { refreshLevel() }
            runCatching { store.log("camera", "CAMERA_STORAGE_READY", installed.manifest, "Platform files alias normalized: ${filesDir.canonicalFile != filesDir.absoluteFile}") }
            checkAccess()
        } catch (e: Exception) {
            val code = (e as? ConstructError)?.code ?: "CAMERA_UNAVAILABLE"
            runCatching { store.log("camera", code, message = "Native camera initialization failed; details omitted") }
            setContent { ConstructTheme { Surface(Modifier.fillMaxSize()) {
                Column(Modifier.safeDrawingPadding().padding(24.dp)) {
                    Text("Camera unavailable", style = MaterialTheme.typography.titleLarge)
                    Text("[$code] Camera could not open. Check Module access, then close and retry.")
                    Button(onClick = { finish() }) { Text("Close camera") }
                }
            } } }
            return
        }
        setContent { ConstructTheme { Screen() } }
    }
    private fun checkAccess() {
        store.withCapability(installed, "camera.photo") { }
        checkRule(hasPermission(this), "ANDROID_PERMISSION_DENIED", "Android camera access is off. Return to Module access.")
    }
    override fun onStart() { super.onStart(); launched.set(true); synchronized(session) { live = true }; sensors?.start() }
    override fun onStop() {
        synchronized(session) { live = false }
        sensors?.stop()
        stopPreview()
        super.onStop()
        // Background/rotation closes the parent image run too; a completed shutter/back does not.
        if (!isFinishing) setResult(RESULT_CANCELED, Intent().putExtra("closed", true))
        finish()
    }
    override fun onDestroy() { stopPreview(); temporary?.delete(); launched.set(false); super.onDestroy() }
    private fun error(error: Exception) {
        val known = error as? ConstructError
        status = "[${known?.code ?: "CAMERA_UNAVAILABLE"}] ${known?.message ?: "Camera could not complete this action. Close and reopen to retry."}"
        runCatching { store.log("camera", known?.code ?: "CAMERA_UNAVAILABLE", installed.manifest, "Camera operation failed; image/path/provider details omitted") }
    }
    private fun stopPreview() {
        val hadCapture = capture != null
        bindGeneration++; ready = false; capture = null; camera = null; lens = null; zoomPending = false
        val released = runCatching { provider?.unbindAll() }.isSuccess
        if (hadCapture) runCatching { store.log("camera", if (released) "CAMERA_RELEASED" else "CAMERA_RELEASE_FAILED", installed.manifest, "Native camera release; no image data logged") }
        preview = null
    }
    private fun bind(view: PreviewView) {
        val generation = ++bindGeneration
        preview = view; ready = false
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            if (!live || generation != bindGeneration || isFinishing) return@addListener
            try {
                checkAccess()
                val p = future.get(); provider = p; p.unbindAll()
                val back = p.hasCamera(CameraSelector.DEFAULT_BACK_CAMERA)
                val selfie = p.hasCamera(CameraSelector.DEFAULT_FRONT_CAMERA)
                checkRule(back || selfie, "CAMERA_UNAVAILABLE", "This device has no available camera")
                canSwitch = back && selfie
                val selector = if ((front && selfie) || !back) CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
                val resolution = ResolutionSelector.Builder().setResolutionStrategy(
                    ResolutionStrategy(android.util.Size(1280, 960), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER)).build()
                val image = ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
                    .setJpegQuality(85).setResolutionSelector(resolution).setTargetRotation(view.display?.rotation ?: android.view.Surface.ROTATION_0).build()
                val surface = Preview.Builder().build().also { it.setSurfaceProvider(view.surfaceProvider) }
                val camera = p.bindToLifecycle(this, selector, surface, image)
                camera.cameraInfo.cameraState.observe(this) { state ->
                    if (live && generation == bindGeneration && state.error != null) {
                        stopPreview()
                        error(ConstructError("CAMERA_UNAVAILABLE", "Camera was interrupted. Close and reopen to retry."))
                    }
                }
                capture = image; this.camera = camera
                val backSelected = selector == CameraSelector.DEFAULT_BACK_CAMERA
                rearCamera = backSelected
                if (options.metadata) {
                    lens = runCatching { lensState(camera.cameraInfo, backSelected) }.getOrNull()
                    // Fixed steps only, clamped to this camera's range; default 1×. Re-derived if the range changes.
                    var applied = false
                    camera.cameraInfo.zoomState.observe(this) { zoom ->
                        if (zoom == null || generation != bindGeneration || !live) return@observe
                        val choices = CaptureGeometry.zoomChoices(options.zoom, zoom.minZoomRatio, zoom.maxZoomRatio)
                        if (!applied || choices != zoomChoices) {
                            applied = true; zoomChoices = choices
                            applyZoom(zoomSelected.takeIf { it in choices } ?: CaptureGeometry.initialZoom(choices, zoom.minZoomRatio, zoom.maxZoomRatio))
                        }
                    }
                }
                view.previewStreamState.removeObservers(this)
                view.previewStreamState.observe(this) { stream ->
                    if (generation == bindGeneration && live) {
                        ready = stream == PreviewView.StreamState.STREAMING
                        status = if (ready) "Camera preview ready. Tap Take photo to save." else "Waiting for camera preview…"
                    }
                }
                runCatching { store.log("camera", "CAMERA_OPENED", installed.manifest, "Native foreground viewfinder; no frame data logged") }
            } catch (e: Exception) { stopPreview(); error(e) }
        }, ContextCompat.getMainExecutor(this))
    }
    private fun applyZoom(ratio: Float) {
        val control = camera?.cameraControl ?: return
        val request = ++zoomRequest
        zoomSelected = ratio; zoomPending = true
        control.setZoomRatio(ratio).addListener({ if (request == zoomRequest) zoomPending = false }, ContextCompat.getMainExecutor(this))
    }
    private fun refreshLevel() {
        val up = sensors?.snapshot()?.up
        level = if (!options.level || !rearCamera || up == null) null
            else CaptureTilt.angles(up[0], up[1], up[2], capture?.targetRotation ?: android.view.Surface.ROTATION_0)
    }
    /** Published characteristics of the bound camera. Only [Camera2CameraInfo.getCameraId] needs interop. */
    @androidx.annotation.OptIn(ExperimentalCamera2Interop::class)
    private fun lensState(info: CameraInfo, back: Boolean): LensState {
        val manager = getSystemService(CameraManager::class.java)
        val characteristics = manager.getCameraCharacteristics(Camera2CameraInfo.from(info).cameraId)
        val logical = characteristics.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)
            ?.contains(CameraMetadata.REQUEST_AVAILABLE_CAPABILITIES_LOGICAL_MULTI_CAMERA) == true
        val physical = if (!logical) emptyList() else characteristics.physicalCameraIds.map { id ->
            runCatching { lensSpec(manager.getCameraCharacteristics(id)) }.getOrNull()
        }
        return LensState(lensSpec(characteristics), logical, physical, back)
    }
    private fun lensSpec(c: CameraCharacteristics): LensSpec? {
        // Several focal lengths mean the lens actually used is unknown: omit rather than guess.
        val focal = c.get(CameraCharacteristics.LENS_INFO_AVAILABLE_FOCAL_LENGTHS)?.takeIf { it.size == 1 } ?: return null
        val size = c.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE) ?: return null
        val pixels = c.get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE) ?: return null
        val active = c.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE) ?: return null
        return LensSpec(focal[0].toDouble(), size.width.toDouble(), size.height.toDouble(),
            pixels.width, pixels.height, active.width(), active.height()).takeIf { it.valid }
    }
    /** Oriented size and mirroring of the saved JPEG as a module will open it. */
    private fun describe(temp: File, zoom: Double, lensAtShutter: LensState?, rotation: Int, sensorRotation: Int?,
        sample: CaptureSensors.Snapshot?): JSONObject {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(temp.path, bounds)
        val orientation = runCatching { ExifInterface(temp.path).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL) }
            .getOrDefault(ExifInterface.ORIENTATION_NORMAL)
        val transposed = orientation in setOf(ExifInterface.ORIENTATION_TRANSPOSE, ExifInterface.ORIENTATION_ROTATE_90,
            ExifInterface.ORIENTATION_TRANSVERSE, ExifInterface.ORIENTATION_ROTATE_270)
        val mirrored = orientation in setOf(ExifInterface.ORIENTATION_FLIP_HORIZONTAL, ExifInterface.ORIENTATION_FLIP_VERTICAL,
            ExifInterface.ORIENTATION_TRANSPOSE, ExifInterface.ORIENTATION_TRANSVERSE)
        return CaptureResult.describe(ShutterState(zoom, lensAtShutter, rotation, sensorRotation,
            if (transposed) bounds.outHeight else bounds.outWidth, if (transposed) bounds.outWidth else bounds.outHeight, mirrored,
            sample?.up, sample?.upAgeMs ?: -1, sample?.spreadDeg ?: 0.0, sample?.accelerometer ?: false,
            sample?.rotation, sample?.rotationStatus ?: CaptureHeading.STATUS_UNRELIABLE, sample?.rotationAgeMs ?: -1))
    }
    private fun shoot() {
        if (busy || !ready || zoomPending) return
        val image = capture ?: return
        try { checkAccess() } catch (e: Exception) { stopPreview(); error(e); return }
        busy = true; status = "Taking photo…"
        // Shutter-time state: the zoom actually applied, the camera's characteristics and the
        // orientation CameraX saves for. The sensor sample is refreshed when exposure starts.
        val zoomAtShutter = camera?.cameraInfo?.zoomState?.value?.zoomRatio?.toDouble() ?: 1.0
        val lensAtShutter = lens
        val rotationAtShutter = image.targetRotation
        val sensorRotation = runCatching { camera?.cameraInfo?.getSensorRotationDegrees(rotationAtShutter) }.getOrNull()
        shutter = sensors?.snapshot()
        // Reserve quota/check disk away from UI; shutter itself is native and user-driven.
        io.execute {
            try {
                photos.reserve()
                val dir = File(cacheDir, "camera-pending").apply { mkdirs() }
                val temp = File.createTempFile("capture-", ".jpg", dir)
                runOnUiThread {
                    if (!live || isFinishing) { temp.delete(); busy = false; return@runOnUiThread }
                    temporary = temp
                    try {
                        checkAccess()
                        image.takePicture(ImageCapture.OutputFileOptions.Builder(temp).build(), ContextCompat.getMainExecutor(this),
                            object : ImageCapture.OnImageSavedCallback {
                                override fun onCaptureStarted() { sensors?.snapshot()?.let { shutter = it } }
                                override fun onError(e: ImageCaptureException) { temp.delete(); temporary = null; busy = false; if (live) error(ConstructError("CAMERA_CAPTURE", "Photo was not saved. Close and reopen to retry.")) }
                                override fun onImageSaved(result: ImageCapture.OutputFileResults) {
                                    val sample = shutter; shutter = null
                                    io.execute {
                                        try {
                                            val metadata = if (options.metadata)
                                                describe(temp, zoomAtShutter, lensAtShutter, rotationAtShutter, sensorRotation, sample) else null
                                            var id: String? = null
                                            photos.commit(temp, publish = { write ->
                                                synchronized(session) { store.withCapability(installed, "camera.photo") { write() } }
                                            }, published = { saved -> if (metadata != null) id = photos.identify(saved) }) {
                                                checkRule(live, "CAMERA_CLOSED", "Camera was closed; capture discarded")
                                                checkRule(hasPermission(this@PhotoCaptureActivity), "ANDROID_PERMISSION_DENIED", "Camera access was revoked; capture discarded")
                                            }
                                            runOnUiThread {
                                                temporary = null; busy = false
                                                if (live) {
                                                    runCatching { store.log("camera", "CAMERA_SAVED", installed.manifest, "One private photo saved; no filename or image data logged") }
                                                    val data = Intent().putExtra("saved", true)
                                                    if (metadata != null) data.putExtra("id", id).putExtra("capture", metadata.toString())
                                                    setResult(RESULT_OK, data); finish()
                                                }
                                            }
                                        } catch (e: Exception) { temp.delete(); runOnUiThread { temporary = null; busy = false; if (live) error(e) } }
                                    }
                                }
                            })
                    } catch (e: Exception) { temp.delete(); temporary = null; busy = false; error(e) }
                }
            } catch (e: Exception) { runOnUiThread { busy = false; if (live) error(e) } }
        }
    }
    /** Horizon line (true horizon's tilt in the preview) plus pitch/roll readout, highlighted within ±1°. */
    @Composable private fun LevelOverlay(modifier: Modifier) {
        val reading = level
        val pitchLevel = reading != null && kotlin.math.abs(reading.first) <= 1.0
        val rollLevel = reading != null && kotlin.math.abs(reading.second) <= 1.0
        val guide = Color.White.copy(alpha = .7f)
        val line = if (rollLevel) ConstructColors.jade else ConstructColors.amber
        Box(modifier) {
            Canvas(Modifier.fillMaxSize()) {
                val half = size.minDimension * .38f
                val tick = size.minDimension * .06f
                drawLine(guide, Offset(center.x - half - tick, center.y), Offset(center.x - half, center.y), strokeWidth = 4f)
                drawLine(guide, Offset(center.x + half, center.y), Offset(center.x + half + tick, center.y), strokeWidth = 4f)
                // Roll > 0 raises the horizon on the right, i.e. a counter-clockwise screen rotation.
                if (reading != null) rotate(-reading.second.toFloat(), center) {
                    drawLine(line, Offset(center.x - half, center.y), Offset(center.x + half, center.y), strokeWidth = 5f)
                }
            }
            Row(Modifier.align(Alignment.TopCenter).padding(6.dp).background(Color.Black.copy(alpha = .6f)).padding(horizontal = 8.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                if (reading == null) Text(if (rearCamera) "Level unavailable" else "Level: rear camera only", color = Color.White,
                    style = MaterialTheme.typography.labelLarge)
                else {
                    Text(String.format(java.util.Locale.ROOT, "Pitch %+.1f°", reading.first), style = MaterialTheme.typography.labelLarge,
                        color = if (pitchLevel) ConstructColors.jade else Color.White)
                    Text(String.format(java.util.Locale.ROOT, "Roll %+.1f°", reading.second), style = MaterialTheme.typography.labelLarge,
                        color = if (rollLevel) ConstructColors.jade else Color.White)
                }
            }
        }
    }
    @OptIn(ExperimentalLayoutApi::class)
    @Composable private fun Screen() {
        BackHandler { finish() }
        @Composable fun Viewfinder(modifier: Modifier) {
            // Give the embedded Android view exact bounds before CameraX applies its transform.
            Box(modifier.clipToBounds().semantics { contentDescription = "Camera viewfinder" }) {
                AndroidView(factory = { context -> PreviewView(context).apply {
                    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
                    scaleType = PreviewView.ScaleType.FIT_CENTER
                    clipChildren = true
                    outlineProvider = ViewOutlineProvider.BOUNDS
                    clipToOutline = true
                }.also { bind(it) } }, modifier = Modifier.fillMaxSize().clipToBounds())
                if (options.level) LevelOverlay(Modifier.matchParentSize())
            }
        }
        @Composable fun Controls(modifier: Modifier) {
            Column(modifier.verticalScroll(rememberScrollState()).semantics { contentDescription = "Capture controls" },
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Construct · Take photo", style = MaterialTheme.typography.titleLarge)
                Text(installed.manifest.name, style = MaterialTheme.typography.bodySmall)
                Text(status, style = MaterialTheme.typography.bodyMedium)
                Text("Only this shutter saves a private photo. No live frames reach the module.", style = MaterialTheme.typography.bodySmall)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Button(enabled = ready && !busy && !zoomPending, onClick = ::shoot) { Text("Take photo") }
                    OutlinedButton(enabled = canSwitch && !busy, onClick = {
                        val view = preview
                        stopPreview(); front = !front
                        if (view != null) bind(view)
                    }) { Text("Switch camera") }
                }
                if (zoomChoices.isNotEmpty()) FlowRow(Modifier.semantics { contentDescription = "Zoom steps" },
                    horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    for (ratio in zoomChoices) {
                        val label = CaptureGeometry.label(ratio)
                        val chosen = ratio == zoomSelected
                        FilterChip(selected = chosen, enabled = ready && !busy, onClick = { if (!chosen) applyZoom(ratio) },
                            label = { Text(label) }, modifier = Modifier.semantics { contentDescription = "Zoom $label"; selected = chosen })
                    }
                }
                TextButton(onClick = { finish() }) { Text("Cancel capture") }
                if (options.level) Text("Level: pitch + means looking down; roll + means the right side is low. Green within ±1°.",
                    style = MaterialTheme.typography.bodySmall)
            }
        }
        Surface(Modifier.fillMaxSize()) {
            BoxWithConstraints(Modifier.fillMaxSize().safeDrawingPadding().padding(12.dp)) {
                if (maxWidth > maxHeight) {
                    Row(Modifier.fillMaxSize(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Viewfinder(Modifier.weight(.56f).fillMaxHeight())
                        Controls(Modifier.weight(.44f).fillMaxHeight())
                    }
                } else {
                    Column(Modifier.fillMaxSize(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Viewfinder(Modifier.fillMaxWidth().weight(.58f))
                        Controls(Modifier.fillMaxWidth().weight(.42f))
                    }
                }
            }
        }
    }
}
