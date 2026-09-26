package dev.construct.runtime

import android.content.ClipData
import android.content.ClipboardManager
import android.content.res.Configuration
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.net.Uri
import android.view.WindowManager
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Settings
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.AbsoluteAlignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import java.util.concurrent.Executors

/** One native accessibility root per launch. Configuration changes retain this session. */
class ModuleActivity : ComponentActivity() {
    companion object {
        fun intent(context: Context, module: Installed) = Intent(context, ModuleActivity::class.java)
            .putExtra("module", module.manifest.id).putExtra("digest", module.digest)
    }
    private val worker = Executors.newSingleThreadExecutor()
    private lateinit var store: ModuleStore
    private var selected by mutableStateOf<Installed?>(null)
    private var menu by mutableStateOf(false)
    private var diagnosticsOpen by mutableStateOf(false)
    private var diagnosticText by mutableStateOf<String?>(null)
    private var webView: ModuleSessionView? = null
    private var ending = false
    private var pickingImage = false
    private var pickerReturned = false
    private var pickedUri: Uri? = null
    private var imageCompletion: ((Uri?) -> Unit)? = null
    private var capturingPhoto = false
    private var captureReturned = false
    private var captureSaved = false
    private var captureClosed = false
    private var captureCompletion: ((Boolean) -> Unit)? = null
    private data class PhotoConfirmation(val op: String, val image: android.graphics.Bitmap, val done: (Boolean) -> Unit)
    private var photoConfirmation by mutableStateOf<PhotoConfirmation?>(null)
    private val photoCapture = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        captureSaved = result.resultCode == RESULT_OK && result.data?.getBooleanExtra("saved", false) == true
        captureClosed = result.data?.getBooleanExtra("closed", false) == true
        captureReturned = true
    }
    private fun capturePhoto(done: (Boolean) -> Unit) {
        checkRule(!ending && !pickingImage && !capturingPhoto && !menu && !diagnosticsOpen && photoConfirmation == null,
            "CAMERA_BUSY", "Capture is unavailable")
        val module = selected ?: throw ConstructError("RUN_STALE", "Module closed")
        store.withCapability(module, "camera.photo") { }
        checkRule(PhotoCaptureActivity.hasPermission(this), "ANDROID_PERMISSION_DENIED", "Allow Android camera access in Module access first")
        capturingPhoto = true; captureCompletion = done
        webView?.pauseForPicker()
        try { photoCapture.launch(PhotoCaptureActivity.intent(this, module)) }
        catch (e: Exception) {
            capturingPhoto = false; captureCompletion = null; webView?.setMenuPaused(false)
            throw ConstructError("CAMERA_UNAVAILABLE", "Could not open camera capture")
        }
    }
    private fun confirmPhoto(op: String, image: android.graphics.Bitmap, done: (Boolean) -> Unit) {
        checkRule(!ending && !menu && !diagnosticsOpen && !pickingImage && !capturingPhoto && photoConfirmation == null,
            "PHOTO_BUSY", "Photo confirmation unavailable")
        webView?.pauseForPicker()
        photoConfirmation = PhotoConfirmation(op, image, done)
    }
    private fun finishPhotoConfirmation(accepted: Boolean) {
        val current = photoConfirmation ?: return
        photoConfirmation = null
        webView?.setMenuPaused(false)
        current.done(accepted)
    }
    private val imagePicker = registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        pickedUri = uri; pickerReturned = true
    }
    private fun pickImage(done: (Uri?) -> Unit) {
        checkRule(!ending && !pickingImage && !menu && !diagnosticsOpen, "IMAGE_BUSY", "Image picker is unavailable")
        pickingImage = true; imageCompletion = done
        webView?.pauseForPicker()
        try { imagePicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }
        catch (e: Exception) {
            pickingImage = false; imageCompletion = null
            webView?.setMenuPaused(false)
            throw ConstructError("IMAGE_UNAVAILABLE", "Could not open image picker")
        }
    }
    override fun onPostResume() {
        super.onPostResume()
        if (captureReturned && !ending) {
            captureReturned = false; capturingPhoto = false
            val done = captureCompletion; captureCompletion = null
            if (captureClosed) { finishSession(); return }
            webView?.setMenuPaused(false)
            done?.invoke(captureSaved)
        }
        if (pickerReturned && !ending) {
            pickerReturned = false; pickingImage = false
            val uri = pickedUri; pickedUri = null
            val done = imageCompletion; imageCompletion = null
            webView?.setMenuPaused(false)
            done?.invoke(uri)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Never resurrect a stopped runtime after process death. Rotation is handled in-place.
        if (savedInstanceState != null) { finishSession(); return }
        store = ModuleStore.shared(this)
        setContent { ConstructTheme { Session() } }
        worker.execute {
            try {
                val module = store.inventory().modules.firstOrNull {
                    it.manifest.id == intent.getStringExtra("module") &&
                        it.digest == intent.getStringExtra("digest") && it.enabled
                }
                checkRule(module != null, "RUN_STALE", "Module changed or is disabled; reopen it from Installed")
                CapabilityLifecycle.requireRunnable(module!!.manifest)
                runOnUiThread { if (!ending && !isDestroyed) {
                    val colour = android.graphics.Color.parseColor(module!!.manifest.themeColor ?: "#141218")
                    val dark = androidx.core.graphics.ColorUtils.calculateLuminance(colour) < .5
                    val style = if (dark) SystemBarStyle.dark(android.graphics.Color.TRANSPARENT)
                        else SystemBarStyle.light(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT)
                    enableEdgeToEdge(statusBarStyle = style, navigationBarStyle = style)
                    if (module.manifest.capabilities.any { it.id == "image.read" })
                        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
                    selected = module
                } }
            } catch (error: Exception) {
                runOnUiThread { finishSession(error = (error as? ConstructError)?.code ?: "OPEN_FAILED") }
            }
        }
    }

    private fun finishSession(action: String = "close", error: String? = null) {
        if (ending) return
        ending = true
        imageCompletion = null; pickedUri = null; captureCompletion = null; photoConfirmation = null
        webView?.destroy(); webView = null
        setResult(RESULT_OK, Intent().putExtra("action", action)
            .putExtra("module", intent.getStringExtra("module"))
            .putExtra("digest", intent.getStringExtra("digest")).putExtra("error", error))
        finish()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        if (selected?.manifest?.api in setOf("0.9.0", "0.10.0", "0.11.0", "0.12.0"))
            webView?.settings?.textZoom = (newConfig.fontScale * 100).toInt().coerceIn(50, 300)
    }

    override fun onStop() { if (!pickingImage && !capturingPhoto) finishSession(); super.onStop() }
    override fun onDestroy() {
        webView?.destroy(); webView = null
        worker.shutdown()
        super.onDestroy()
    }

    private fun openMenu() { webView?.setMenuPaused(true); menu = true }
    private fun dismissMenu() { menu = false; webView?.setMenuPaused(false) }
    private fun openDiagnostics() {
        diagnosticsOpen = true; menu = false; diagnosticText = null
        worker.execute {
            val text = runCatching { store.diagnosticReport() }.getOrDefault("Diagnostics unavailable. Close and retry.")
            runOnUiThread { if (!ending && diagnosticsOpen) diagnosticText = text }
        }
    }
    private fun closeDiagnostics() { diagnosticText = null; diagnosticsOpen = false; menu = true }

    @Composable private fun Session() {
        BackHandler {
            when { diagnosticsOpen -> closeDiagnostics(); menu -> dismissMenu(); else -> openMenu() }
        }
        val active = selected
        val landscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE
        val background = active?.manifest?.themeColor?.let { Color(android.graphics.Color.parseColor(it)) }
            ?: MaterialTheme.colorScheme.background
        Surface(Modifier.fillMaxSize(), color = background) {
            if (active == null) Text("Opening module…", Modifier.safeDrawingPadding().padding(16.dp))
            else Box(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
                val legacy = !ModuleLayout.cornerAware(active.manifest.api)
                AndroidView(modifier = Modifier.fillMaxSize().absolutePadding(
                    top = if (legacy && !landscape) ModuleLayout.MENU_RECT.dp else 0.dp,
                    right = if (legacy && landscape) ModuleLayout.MENU_RECT.dp else 0.dp),
                    factory = { context ->
                        try {
                            moduleWebView(context, store, active, pickImage = ::pickImage, capturePhoto = ::capturePhoto, confirmPhoto = ::confirmPhoto) { failedView, code ->
                                if (webView === failedView) finishSession(error = code)
                            }.also { webView = it }
                        } catch (error: Exception) {
                            android.widget.TextView(context).apply {
                                val code = (error as? ConstructError)?.code ?: "OPEN_FAILED"
                                text = "[$code] Module could not open."
                                runCatching { store.runtimeFailed(active, code) }
                                post { finishSession(error = code) }
                            }
                        }
                    }, onReset = null, onRelease = { view -> if (view is ModuleSessionView) view.destroy() })
                if (menu || diagnosticsOpen) Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = .28f))
                    .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null) {
                        if (menu) dismissMenu()
                    }.clearAndSetSemantics { })
                Box(Modifier.align(AbsoluteAlignment.TopRight).padding(4.dp)) {
                    IconButton(modifier = Modifier.size(ModuleLayout.MENU_TARGET.dp)
                        .background(Color.Black.copy(alpha = .35f), CircleShape)
                        .semantics { contentDescription = "Construct menu" },
                        onClick = { if (menu) dismissMenu() else openMenu() }) {
                        Icon(Icons.Filled.Menu, contentDescription = null, tint = Color.White)
                    }
                    DropdownMenu(expanded = menu, onDismissRequest = { dismissMenu() },
                        modifier = Modifier.widthIn(min = 250.dp, max = 320.dp)) {
                        Text(active.manifest.name + " · " + active.manifest.version + if (active.confirmed) "" else " · Trial",
                            Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                            style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        DropdownMenuItem(text = { Text("Return to module", color = MaterialTheme.colorScheme.primary) },
                            leadingIcon = { Icon(Icons.Filled.PlayArrow, null) }, onClick = { dismissMenu() })
                        DropdownMenuItem(text = { Text("Module access") }, leadingIcon = { Icon(Icons.Filled.Settings, null) },
                            onClick = { finishSession("access") })
                        DropdownMenuItem(text = { Text("Diagnostics") }, leadingIcon = { Icon(Icons.Filled.Info, null) },
                            onClick = { openDiagnostics() })
                        if (!active.confirmed) DropdownMenuItem(text = { Text("Mark working") },
                            leadingIcon = { Icon(Icons.Filled.Check, null) }, enabled = webView != null,
                            onClick = { finishSession("confirm") })
                        HorizontalDivider()
                        DropdownMenuItem(text = { Text("Close module", color = MaterialTheme.colorScheme.error) },
                            leadingIcon = { Icon(Icons.Filled.Close, null, tint = MaterialTheme.colorScheme.error) },
                            onClick = { finishSession() })
                    }
                }
            }
        }
        photoConfirmation?.let { confirmation -> AlertDialog(
            onDismissRequest = { finishPhotoConfirmation(false) },
            title = { Text(if (confirmation.op == "delete") "Delete this private photo?" else "Save this photo to phone gallery?") },
            text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Construct confirmation · ${active?.manifest?.name ?: "Module"}")
                androidx.compose.foundation.Image(confirmation.image.asImageBitmap(), "Selected private photo",
                    Modifier.fillMaxWidth().heightIn(max = 220.dp), contentScale = androidx.compose.ui.layout.ContentScale.Fit)
                Text(if (confirmation.op == "delete") "This removes the private original. Existing gallery copies are not deleted."
                    else "Other gallery apps can access the exported copy. The private original is kept.")
            } },
            confirmButton = { TextButton(onClick = { finishPhotoConfirmation(true) }) { Text(if (confirmation.op == "delete") "Delete photo" else "Save copy") } },
            dismissButton = { TextButton(onClick = { finishPhotoConfirmation(false) }) { Text("Cancel") } }
        ) }
        if (diagnosticsOpen) AlertDialog(onDismissRequest = { closeDiagnostics() },
            title = { Text("Diagnostics") },
            text = { Column(Modifier.heightIn(max = 400.dp).verticalScroll(rememberScrollState())) {
                Text("Local technical report. Review before sharing; module messages may contain data.", style = MaterialTheme.typography.bodySmall)
                Text(diagnosticText ?: "Loading diagnostics…", style = MaterialTheme.typography.bodySmall)
            } },
            confirmButton = { TextButton(onClick = { closeDiagnostics() }) { Text("Back to menu") } },
            dismissButton = { TextButton(enabled = diagnosticText != null, onClick = {
                (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager)
                    .setPrimaryClip(ClipData.newPlainText("Construct diagnostics", diagnosticText))
            }) { Text("Copy diagnostics") } })
    }
}
