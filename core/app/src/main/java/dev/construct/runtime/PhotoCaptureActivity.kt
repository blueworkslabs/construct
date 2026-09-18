package dev.construct.runtime

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.ImageDecoder
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.Image
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
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
        fun hasPermission(context: Context) = context.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        fun intent(context: Context, installed: Installed) = Intent(context, PhotoCaptureActivity::class.java)
            .putExtra("module", installed.manifest.id).putExtra("digest", installed.digest)

    }
    private lateinit var store: ModuleStore
    private lateinit var installed: Installed
    private lateinit var photos: CameraPhotos
    private val session = Any()
    @Volatile private var live = false
    private var provider: ProcessCameraProvider? = null
    private var capture: ImageCapture? = null
    private var preview: PreviewView? = null
    private var bindGeneration = 0
    private var temporary: File? = null
    private var status by mutableStateOf("Opening camera…")
    private var ready by mutableStateOf(false)
    private var busy by mutableStateOf(false)
    private var front by mutableStateOf(false)
    private var canSwitch by mutableStateOf(false)
    private var gallery by mutableStateOf(false)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        store = ModuleStore.shared(this)
        try {
            checkRule(launched.compareAndSet(false, true), "CAMERA_BUSY", "A capture is already open")
            installed = store.inventory().modules.single { it.manifest.id == intent.getStringExtra("module") && it.digest == intent.getStringExtra("digest") }
            File(cacheDir, "camera-pending").listFiles()?.filter { it.isFile && it.name.startsWith("capture-") }?.forEach { it.delete() }
            photos = CameraPhotos(this, installed.manifest.id)
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
    override fun onStart() { super.onStart(); launched.set(true); synchronized(session) { live = true } }
    override fun onStop() {
        synchronized(session) { live = false }
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
        bindGeneration++; ready = false; capture = null
        val released = runCatching { provider?.unbindAll() }.isSuccess
        if (hadCapture) runCatching { store.log("camera", if (released) "CAMERA_RELEASED" else "CAMERA_RELEASE_FAILED", installed.manifest, "Native camera release; no image data logged") }
        preview = null
    }
    private fun bind(view: PreviewView) {
        val generation = ++bindGeneration
        preview = view; ready = false
        val future = ProcessCameraProvider.getInstance(this)
        future.addListener({
            if (!live || generation != bindGeneration || gallery || isFinishing) return@addListener
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
                capture = image
                view.previewStreamState.removeObservers(this)
                view.previewStreamState.observe(this) { stream ->
                    if (generation == bindGeneration && live && !gallery) {
                        ready = stream == PreviewView.StreamState.STREAMING
                        status = if (ready) "Camera preview ready. Tap Take photo to save." else "Waiting for camera preview…"
                    }
                }
                runCatching { store.log("camera", "CAMERA_OPENED", installed.manifest, "Native foreground viewfinder; no frame data logged") }
            } catch (e: Exception) { stopPreview(); error(e) }
        }, ContextCompat.getMainExecutor(this))
    }
    private fun shoot() {
        if (busy || !ready) return
        val image = capture ?: return
        try { checkAccess() } catch (e: Exception) { stopPreview(); error(e); return }
        busy = true; status = "Taking photo…"
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
                                override fun onError(e: ImageCaptureException) { temp.delete(); temporary = null; busy = false; if (live) error(ConstructError("CAMERA_CAPTURE", "Photo was not saved. Close and reopen to retry.")) }
                                override fun onImageSaved(result: ImageCapture.OutputFileResults) {
                                    io.execute {
                                        try {
                                            photos.commit(temp, publish = { write ->
                                                synchronized(session) { store.withCapability(installed, "camera.photo") { write() } }
                                            }) {
                                                checkRule(live, "CAMERA_CLOSED", "Camera was closed; capture discarded")
                                                checkRule(hasPermission(this@PhotoCaptureActivity), "ANDROID_PERMISSION_DENIED", "Camera access was revoked; capture discarded")
                                            }
                                            runOnUiThread {
                                                temporary = null; busy = false
                                                if (live) {
                                                    runCatching { store.log("camera", "CAMERA_SAVED", installed.manifest, "One private photo saved; no filename or image data logged") }
                                                    setResult(RESULT_OK, Intent().putExtra("saved", true)); finish()
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
    @Composable private fun Screen() {
        BackHandler { finish() }
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().safeDrawingPadding().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Construct · Take photo", style = MaterialTheme.typography.titleLarge)
                Text(installed.manifest.name, style = MaterialTheme.typography.bodySmall)
                AndroidView(factory = { context -> PreviewView(context).also { bind(it) } },
                    modifier = Modifier.fillMaxWidth().weight(1f).semantics { contentDescription = "Camera viewfinder" })
                Column(Modifier.heightIn(max = 180.dp).verticalScroll(rememberScrollState())) {
                    Text(status, style = MaterialTheme.typography.bodyMedium)
                    Text("Only this shutter saves a private photo. No live frames reach the module.", style = MaterialTheme.typography.bodySmall)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(enabled = ready && !busy, onClick = ::shoot) { Text("Take photo") }
                        OutlinedButton(enabled = canSwitch && !busy, onClick = {
                            val view = preview
                            stopPreview(); front = !front
                            if (view != null) bind(view)
                        }) { Text("Switch camera") }
                    }
                    TextButton(onClick = { finish() }) { Text("Cancel capture") }
                }
            }
        }
    }
}
