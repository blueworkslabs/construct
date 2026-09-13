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
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Native human-operated camera. No exported intents, raw frames or photo bytes to JS. */
class CameraActivity : ComponentActivity() {
    companion object {
        private val launched = AtomicBoolean(false)
        private val io = Executors.newSingleThreadExecutor()
        fun hasPermission(context: Context) = context.checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED
        fun validate(params: JSONObject) {
            checkRule(params.keys().asSequence().toSet() == setOf("op") && params.optString("op") == "open",
                "INVALID_PARAMS", "Camera supports opening its native workspace only")
        }
        fun open(context: Context, store: ModuleStore, installed: Installed, params: JSONObject) {
            validate(params)
            store.withCapability(installed, "camera.capture") { }
            checkRule(hasPermission(context), "ANDROID_PERMISSION_DENIED", "Allow Android camera access in Module access first.")
            checkRule(launched.compareAndSet(false, true), "CAMERA_BUSY", "Camera workspace is already opening or open.")
            try {
                context.startActivity(Intent(context, CameraActivity::class.java)
                    .putExtra("module", installed.manifest.id).putExtra("digest", installed.digest))
            } catch (error: Exception) { launched.set(false); throw ConstructError("CAMERA_UNAVAILABLE", "Could not open camera workspace") }
        }
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
    private var saved by mutableStateOf(emptyList<File>())
    private var selected by mutableStateOf(0)
    private var bitmap by mutableStateOf<android.graphics.Bitmap?>(null)
    private var deleteConfirm by mutableStateOf(false)
    private var exportConfirm by mutableStateOf(false)
    private var imageGeneration = 0
    private val analysisGeneration = AnalysisGeneration()
    private var analysis by mutableStateOf<PhotoAnalysis?>(null)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        store = ModuleStore.shared(this)
        try {
            installed = store.inventory().modules.single { it.manifest.id == intent.getStringExtra("module") && it.digest == intent.getStringExtra("digest") }
            File(cacheDir, "camera-pending").listFiles()?.filter { it.isFile && it.name.startsWith("capture-") }?.forEach { it.delete() }
            photos = CameraPhotos(this, installed.manifest.id)
            runCatching { store.log("camera", "CAMERA_STORAGE_READY", installed.manifest, "Platform files alias normalized: ${filesDir.canonicalFile != filesDir.absoluteFile}") }
            checkAccess()
        } catch (e: Exception) {
            val code = (e as? ConstructError)?.code ?: "CAMERA_UNAVAILABLE"
            runCatching { store.log("camera", code, message = "Native camera initialization failed; details omitted") }
            setContent { MaterialTheme(colorScheme = darkColorScheme()) { Surface(Modifier.fillMaxSize()) {
                Column(Modifier.safeDrawingPadding().padding(24.dp)) {
                    Text("Camera unavailable", style = MaterialTheme.typography.titleLarge)
                    Text("[$code] Camera could not open. Check Module access, then close and retry.")
                    Button(onClick = { finish() }) { Text("Close camera") }
                }
            } } }
            return
        }
        setContent { MaterialTheme(colorScheme = darkColorScheme()) { Screen() } }
    }
    private fun checkAccess() {
        store.withCapability(installed, "camera.capture") { }
        checkRule(hasPermission(this), "ANDROID_PERMISSION_DENIED", "Android camera access is off. Return to Module access.")
    }
    override fun onStart() { super.onStart(); launched.set(true); synchronized(session) { live = true } }
    override fun onStop() {
        synchronized(session) { live = false }
        stopPreview(); imageGeneration++; bitmap = null
        analysisGeneration.invalidate(); analysis = null
        super.onStop()
        // No unattended preview or automatic restart when returning from another app.
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
                                                synchronized(session) { store.withCapability(installed, "camera.capture") { write() } }
                                            }) {
                                                checkRule(live, "CAMERA_CLOSED", "Camera was closed; capture discarded")
                                                checkRule(hasPermission(this@CameraActivity), "ANDROID_PERMISSION_DENIED", "Camera access was revoked; capture discarded")
                                            }
                                            runOnUiThread {
                                                temporary = null; busy = false
                                                if (live) {
                                                    runCatching { store.log("camera", "CAMERA_SAVED", installed.manifest, "One private photo saved; no filename or image data logged") }
                                                    showGallery("Photo saved privately.")
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
    private fun showGallery(message: String = "Saved photos stay on this phone.") {
        stopPreview(); gallery = true; status = message; busy = true
        io.execute {
            val files = photos.list()
            runOnUiThread { if (live) { saved = files; selected = (files.size - 1).coerceAtLeast(0); busy = false; loadPhoto() } }
        }
    }
    private fun loadPhoto() {
        analysisGeneration.invalidate(); analysis = null
        val generation = ++imageGeneration; bitmap = null; status = "Loading saved photo…"
        val file = saved.getOrNull(selected) ?: return
        io.execute {
            try {
                if (!live || generation != imageGeneration) return@execute
                val image = ImageDecoder.decodeBitmap(ImageDecoder.createSource(file)) { decoder, info, _ ->
                    val scale = 1024.0 / maxOf(info.size.width, info.size.height).coerceAtLeast(1024)
                    decoder.setTargetSize((info.size.width * scale).toInt().coerceAtLeast(1), (info.size.height * scale).toInt().coerceAtLeast(1))
                    decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                }
                runOnUiThread {
                    if (live && gallery && generation == imageGeneration) {
                        bitmap = image; status = "Saved photo ready. Analysis runs only when you choose."
                    } else image.recycle()
                }
            } catch (e: Exception) { runOnUiThread { if (live && generation == imageGeneration) error(ConstructError("CAMERA_IMAGE", "Saved photo could not be displayed. You can delete it.")) } }
        }
    }
    private fun analyzePhoto(kind: AnalysisKind) {
        if (busy || !live || !gallery) return
        val image = bitmap ?: return
        try { checkAccess() } catch (e: Exception) { error(e); return }
        val token = analysisGeneration.invalidate()
        analysis = null; busy = true; status = "Finding ${kind.title.lowercase()} on this phone…"
        io.execute {
            try {
                synchronized(session) {
                    checkRule(live && analysisGeneration.current(token), "CAMERA_CLOSED", "Photo analysis canceled.")
                    checkAccess()
                }
                val result = PhotoAnalyzer.detect(applicationContext, image, kind)
                runOnUiThread {
                    busy = false
                    if (!live || !gallery || !analysisGeneration.current(token)) return@runOnUiThread
                    try {
                        // A late result may never cross a revoked grant or closed selection.
                        store.withCapability(installed, "camera.capture") {
                            checkRule(hasPermission(this), "ANDROID_PERMISSION_DENIED", "Camera access changed; analysis discarded.")
                            analysis = result
                            status = if (result.boxes.isEmpty()) "No ${kind.title.lowercase()} detected above the threshold. This can miss things."
                                else "${kind.title} found: ${result.boxes.size} · on-device estimate"
                        }
                        store.log("camera", "PHOTO_ANALYZED", installed.manifest, "User-requested local analysis completed; results and image details omitted")
                    } catch (e: Exception) { analysis = null; error(e) }
                }
            } catch (e: LinkageError) {
                android.util.Log.e("ConstructVision", "Native vision linkage failed", e)
                runOnUiThread {
                    busy = false
                    if (live && analysisGeneration.current(token)) error(ConstructError("PHOTO_ANALYSIS_UNAVAILABLE", "On-device analysis is unavailable on this device. Your photos are unchanged."))
                }
            } catch (e: Exception) {
                runOnUiThread {
                    busy = false
                    if (live && analysisGeneration.current(token)) error(if (e is ConstructError) e else ConstructError("PHOTO_ANALYSIS", "Could not analyze this photo. The original is unchanged; close and retry."))
                }
            }
        }
    }
    private fun exportPhoto() {
        if (busy || android.os.Build.VERSION.SDK_INT < 29) return
        val photo = saved.getOrNull(selected) ?: return
        try { checkAccess() } catch (e: Exception) { error(e); return }
        busy = true; status = "Saving a copy to phone gallery…"
        io.execute {
            try {
                photos.readSelected(photo) { input, size ->
                    synchronized(session) {
                        checkRule(live, "CAMERA_CLOSED", "Camera workspace closed; export canceled.")
                        checkAccess()
                    }
                    GalleryExport.copy(input, size, MediaStorePhoto(contentResolver)) { publish ->
                        synchronized(session) {
                            store.withCapability(installed, "camera.capture") {
                                checkRule(live, "CAMERA_CLOSED", "Camera workspace closed; export canceled.")
                                checkRule(hasPermission(this), "ANDROID_PERMISSION_DENIED", "Camera access changed; export canceled.")
                                publish()
                            }
                        }
                    }
                }
                runCatching { store.log("camera", "PHOTO_EXPORTED", installed.manifest, "One user-selected copy saved to phone gallery; no image or location data logged") }
                runOnUiThread { busy = false; if (live) status = "Copy saved to phone gallery · Pictures/Construct. Private original kept." }
            } catch (e: Exception) {
                runOnUiThread {
                    busy = false
                    if (live) error(if (e is ConstructError) e else ConstructError("PHOTO_EXPORT", "Could not save to phone gallery. Check free space and retry; the private original is kept."))
                }
            }
        }
    }
    @Composable private fun Screen() {
        BackHandler { finish() }
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().safeDrawingPadding().padding(16.dp)) {
                Text("${installed.manifest.name} · Camera", style = MaterialTheme.typography.titleLarge)
                Text("Private photos · gallery copies only when you choose", style = MaterialTheme.typography.bodySmall)
                Text(status, color = MaterialTheme.colorScheme.primary)
                Row {
                    TextButton(onClick = { finish() }) { Text("Close camera") }
                    TextButton(enabled = !busy, onClick = { if (gallery) { imageGeneration++; analysisGeneration.invalidate(); analysis = null; bitmap = null; gallery = false; status = "Opening camera…" } else showGallery() }) { Text(if (gallery) "Back to camera" else "Saved photos") }
                }
                if (gallery) {
                    Text("Saved photos: ${saved.size} / ${CameraPhotos.MAX_PHOTOS}")
                    bitmap?.let { photo ->
                        Box(Modifier.weight(1f).fillMaxWidth()) {
                            Image(photo.asImageBitmap(), "Saved photo preview", Modifier.fillMaxSize(), contentScale = ContentScale.Fit)
                            Canvas(Modifier.fillMaxSize()) {
                                val fit = PhotoFit.fit(photo.width, photo.height, size.width, size.height)
                                analysis?.boxes?.forEach { box ->
                                    drawRect(Color.Cyan, Offset(fit.left + box.left * fit.width, fit.top + box.top * fit.height),
                                        Size((box.right - box.left) * fit.width, (box.bottom - box.top) * fit.height), style = Stroke(2.dp.toPx()))
                                }
                            }
                        }
                    }
                        ?: Spacer(Modifier.weight(1f))
                    if (saved.isEmpty()) Text("No saved photos yet.")
                    Row {
                        OutlinedButton(enabled = !busy && bitmap != null, onClick = { analyzePhoto(AnalysisKind.FACES) }) { Text("Find faces") }
                        OutlinedButton(enabled = !busy && bitmap != null, onClick = { analyzePhoto(AnalysisKind.OBJECTS) }) { Text("Find objects") }
                    }
                    analysis?.let { result ->
                        Text(result.boxes.joinToString(" · ") { "${it.label} ${(it.score * 100).toInt()}%" }.ifEmpty { "No detections" }, style = MaterialTheme.typography.bodySmall)
                        Text("Estimates can be wrong. No identity or emotion recognition. Results are not saved or exported.", style = MaterialTheme.typography.bodySmall)
                    }
                    Row {
                        TextButton(enabled = !busy && selected > 0, onClick = { selected--; loadPhoto() }) { Text("Previous photo") }
                        TextButton(enabled = !busy && selected + 1 < saved.size, onClick = { selected++; loadPhoto() }) { Text("Next photo") }
                    }
                    Button(enabled = !busy && saved.isNotEmpty(), onClick = { deleteConfirm = true }) { Text("Delete photo") }
                    if (android.os.Build.VERSION.SDK_INT >= 29) {
                        OutlinedButton(enabled = !busy && bitmap != null && saved.isNotEmpty(), onClick = { exportConfirm = true }) { Text("Save to phone gallery") }
                    } else Text("Gallery export requires Android 10 or later. Private photos remain available here.", style = MaterialTheme.typography.bodySmall)
                } else {
                    key(front) { AndroidView(factory = { PreviewView(it).apply { implementationMode = PreviewView.ImplementationMode.COMPATIBLE }.also { view -> bind(view) } }, modifier = Modifier.weight(1f).fillMaxWidth()) }
                    Row {
                        Button(enabled = ready && !busy, onClick = { shoot() }) { Text("Take photo") }
                        TextButton(enabled = canSwitch && !busy, onClick = { stopPreview(); front = !front; status = "Switching camera…" }) { Text("Switch camera") }
                    }
                }
                Text("Up to 8 photos / 20 MiB here. Closing, backgrounding or rotating closes the camera. Saved photos remain until you delete them.", style = MaterialTheme.typography.bodySmall)
                if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            }
            if (exportConfirm) AlertDialog(onDismissRequest = { exportConfirm = false }, title = { Text("Save a gallery copy?") }, text = {
                Text("Save this photo to Pictures/Construct? Other apps with photo access, including configured photo backup services, may read it. The private original stays here. Deleting it or uninstalling Construct will not remove the gallery copy. Each save creates a new copy.")
            }, confirmButton = { TextButton(onClick = { exportConfirm = false; exportPhoto() }) { Text("Save copy") } },
                dismissButton = { TextButton(onClick = { exportConfirm = false }) { Text("Keep private") } })
            if (deleteConfirm) AlertDialog(onDismissRequest = { deleteConfirm = false }, title = { Text("Delete this photo?") }, text = { Text("This permanently deletes the selected private photo. Any exported gallery copies remain.") }, confirmButton = { TextButton(onClick = {
                deleteConfirm = false; val file = saved.getOrNull(selected) ?: return@TextButton; busy = true; imageGeneration++; analysisGeneration.invalidate(); analysis = null; bitmap = null
                io.execute { try { photos.delete(file); runOnUiThread { if (live) showGallery("Photo deleted.") } } catch (e: Exception) { runOnUiThread { busy = false; if (live) error(e) } } }
            }) { Text("Delete permanently") } }, dismissButton = { TextButton(onClick = { deleteConfirm = false }) { Text("Keep photo") } })
        }
    }
}
