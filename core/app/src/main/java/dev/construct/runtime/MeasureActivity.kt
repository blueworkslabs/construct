package dev.construct.runtime

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import java.nio.ByteBuffer
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Human-selected, transient photo workspace. No URI, pixels, endpoints or lengths go to JavaScript. */
class MeasureActivity : ComponentActivity() {
    companion object {
        private val launched = AtomicBoolean(false)
        private val workerBusy = AtomicBoolean(false)
        private val io = Executors.newSingleThreadExecutor()
        fun validate(params: JSONObject) {
            checkRule(params.keys().asSequence().toSet() == setOf("op") && params.optString("op") == "open",
                "INVALID_PARAMS", "Photo measurement supports opening its native workspace only")
        }
        fun open(context: Context, store: ModuleStore, installed: Installed, params: JSONObject) {
            validate(params); store.withCapability(installed, "photo.measure") { }
            checkRule(launched.compareAndSet(false,true), "MEASURE_BUSY", "Measurement workspace is already open.")
            try { context.startActivity(Intent(context,MeasureActivity::class.java)
                .putExtra("module",installed.manifest.id).putExtra("digest",installed.digest)) }
            catch (e: Exception) { launched.set(false); throw ConstructError("MEASURE_UNAVAILABLE","Could not open measurement workspace.") }
        }
    }
    private lateinit var store: ModuleStore
    private lateinit var installed: Installed
    private var live = false
    private var choosingPhoto = false
    private val generation = AnalysisGeneration()
    private var photo by mutableStateOf<Bitmap?>(null)
    private var corners by mutableStateOf(emptyList<MeasurePoint>())
    private var endpoints by mutableStateOf(emptyList<MeasurePoint>())
    private var sizeText by mutableStateOf("")
    private var sideMm by mutableStateOf<Double?>(null)
    private var lengthMm by mutableStateOf<Double?>(null)
    private var busy by mutableStateOf(false)
    private var status by mutableStateOf("Choose one saved photo with the reference card beside the item.")
    private val picker = registerForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        choosingPhoto = false
        if (live && !isFinishing && uri != null) load(uri)
        else if (live) status = "No photo selected. Choose photo to try again."
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        // Rotation or process recreation never restores sensitive photos or pending requests.
        if (savedInstanceState != null) { finish(); return }
        store = ModuleStore.shared(this)
        try {
            installed = store.inventory().modules.single { it.manifest.id == intent.getStringExtra("module") && it.digest == intent.getStringExtra("digest") }
            checkAccess()
        } catch (e: Exception) { finish(); return }
        setContent { MaterialTheme(colorScheme = darkColorScheme()) { Screen() } }
    }
    override fun onStart() { live = true; super.onStart() }
    override fun onStop() {
        live = false; generation.invalidate()
        photo = null; corners = emptyList(); clearMeasurement(); busy = false
        super.onStop()
        // Only the explicit system-picker handoff may return to this workspace.
        if (!choosingPhoto || isChangingConfigurations) finish()
    }
    override fun onDestroy() { generation.invalidate(); launched.set(false); super.onDestroy() }
    private fun checkAccess() = store.withCapability(installed,"photo.measure") { }
    private fun clearMeasurement() { endpoints = emptyList(); lengthMm = null }
    private fun failed(e: Throwable) {
        val known = e as? ConstructError
        status = "[${known?.code ?: "MEASURE_UNAVAILABLE"}] ${known?.message ?: "Could not read this photo. Try a smaller JPEG or PNG saved on this phone."}"
        // No provider URI, image data, marker size, endpoints or measurement details in logs.
        runCatching { store.log("measure",known?.code ?: "MEASURE_UNAVAILABLE",installed.manifest,"Native measurement action failed; photo and result details omitted") }
        if (known?.code == "CAPABILITY_DENIED") { photo = null; corners = emptyList(); clearMeasurement(); sideMm = null }
    }
    private fun choose() {
        try {
            checkAccess(); generation.invalidate(); photo = null; corners = emptyList(); clearMeasurement(); sideMm = null
            choosingPhoto = true
            picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
        } catch (e: Exception) { choosingPhoto = false; failed(e) }
    }
    private fun load(uri: Uri) {
        try {
            checkAccess()
            checkRule(workerBusy.compareAndSet(false,true),"MEASURE_BUSY","Previous photo is still finishing. Try again shortly.")
        } catch (e: Exception) { failed(e); return }
        busy = true; status = "Reading photo and finding reference marker…"
        val token = generation.invalidate()
        io.execute {
            var decoded: Bitmap? = null
            try {
                checkAccess()
                val bytes = contentResolver.openInputStream(uri)?.use { it.readBytesBounded(20*1024*1024) }
                    ?: throw ConstructError("PHOTO_INVALID","Could not read the selected photo.")
                decoded = ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(bytes))) { decoder, info, _ ->
                    checkRule(info.size.width in 1..12000 && info.size.height in 1..12000,"PHOTO_INVALID","Photo dimensions exceed the supported limit.")
                    val scale = minOf(1.0,1600.0/maxOf(info.size.width,info.size.height))
                    decoder.setTargetSize(maxOf(1,(info.size.width*scale).toInt()),maxOf(1,(info.size.height*scale).toInt()))
                    decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                    decoder.setOnPartialImageListener { false }
                }
                val found = MeasureDetector.detect(decoded!!)
                val result = decoded!!
                runOnUiThread {
                    if (live && generation.current(token) && !isFinishing) {
                        try { checkAccess(); photo = result; corners = found; status = "Reference found. Enter its measured outer black-square side in millimetres." }
                        catch (e: Exception) { result.recycle(); failed(e) }
                        busy = false
                    } else result.recycle()
                }
                decoded = null // Ownership passed to the main-thread completion.
            } catch (e: Throwable) {
                decoded?.recycle()
                runOnUiThread { if (live && generation.current(token) && !isFinishing) { busy = false; failed(e) } }
            } finally { workerBusy.set(false) }
        }
    }
    private fun confirmSize() {
        try {
            checkAccess(); val size = MeasureInput.sideMm(sizeText)
            checkRule(corners.size == 4,"MARKER_NOT_FOUND","Choose a photo containing the reference card first.")
            sideMm = size; clearMeasurement(); status = "Tap the two ends of a length in the photo. Keep both ends in the card’s plane."
        } catch (e: Exception) { failed(e) }
    }
    private fun tap(point: MeasurePoint) {
        try {
            checkAccess()
            val size = sideMm ?: return
            val plane = MeasurePlane(corners); plane.project(point)
            if (endpoints.size != 1) { endpoints = listOf(point); lengthMm = null; status = "First endpoint set. Tap the other end." }
            else { val length = plane.lengthMm(endpoints[0],point,size); endpoints = endpoints + point; lengthMm = length; status = "Approximate tabletop length. Tap again to start a new measurement." }
        } catch (e: Exception) { failed(e) }
    }
    @Composable private fun Screen() {
        val focus = LocalFocusManager.current
        val statusStyle = MaterialTheme.typography.bodySmall
        val statusHeight = with(LocalDensity.current) { statusStyle.lineHeight.toDp() * 3 }
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().safeDrawingPadding().padding(12.dp),verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Pocket Measure",style = MaterialTheme.typography.titleLarge)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { choose() },enabled = !busy) { Text("Choose photo") }
                    TextButton(onClick = { finish() }) { Text("Close measure") }
                }
                // Fixed for every message at this font scale/width. Long instructions remain
                // scrollable/readable without moving the photo between endpoint taps.
                Box(Modifier.fillMaxWidth().height(statusHeight)) {
                    key(status) {
                        Text(status,style = statusStyle,modifier = Modifier.fillMaxWidth()
                            .verticalScroll(rememberScrollState()))
                    }
                }
                if (corners.isNotEmpty()) {
                    Row(Modifier.fillMaxWidth(),horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(value = sizeText,onValueChange = { sizeText = it.take(8); sideMm = null; clearMeasurement() },
                            label = { Text("Marker side (mm)") },singleLine = true,modifier = Modifier.weight(1f),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                        Button(onClick = { focus.clearFocus(); confirmSize() }) { Text("Confirm size") }
                    }
                }
                // Reserve the result/control space so setting A or B never resizes the photograph.
                // The placeholder and numeric result must also occupy one stable line at
                // large fonts. Horizontal scrolling keeps the full value readable.
                key(lengthMm) {
                    Text(lengthMm?.let { String.format(Locale.ROOT,"Length: %.1f cm",it/10) } ?: "Approximate length",
                        style = MaterialTheme.typography.headlineSmall,maxLines = 1,
                        modifier = Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()))
                }
                TextButton(enabled = sideMm != null,onClick = { clearMeasurement(); status = "Tap the first endpoint." }) { Text("Clear endpoints") }
                val image = photo
                if (image != null) {
                    Box(Modifier.weight(1f).fillMaxWidth()) {
                        Image(image.asImageBitmap(),contentDescription = null,modifier = Modifier.fillMaxSize(),contentScale = ContentScale.Fit)
                        Canvas(Modifier.fillMaxSize().semantics { contentDescription = "Measurement photo: tap two endpoints" }
                            .pointerInput(image,sideMm,endpoints) { detectTapGestures { p ->
                                MeasureInput.fromTap(p.x,p.y,size.width.toFloat(),size.height.toFloat(),image.width,image.height)?.let { tap(it) }
                            } }) {
                            val fit = PhotoFit.fit(image.width,image.height,size.width,size.height)
                            fun screen(p: MeasurePoint) = Offset(fit.left+(p.x*fit.width).toFloat(),fit.top+(p.y*fit.height).toFloat())
                            corners.indices.forEach { i -> drawLine(Color.Cyan,screen(corners[i]),screen(corners[(i+1)%4]),3.dp.toPx()) }
                            if (endpoints.size == 2) drawLine(Color.Yellow,screen(endpoints[0]),screen(endpoints[1]),3.dp.toPx())
                            endpoints.forEach { p -> drawCircle(Color.Yellow,6.dp.toPx(),screen(p)) }
                        }
                    }
                } else Spacer(Modifier.weight(1f))
                Text("Estimate only • Flat surface, marker beside item • No photo or result saved",style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}
