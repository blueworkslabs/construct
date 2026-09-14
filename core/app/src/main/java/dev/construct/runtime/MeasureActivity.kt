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
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.asImageBitmap
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
    private val editor = MeasureEditor()
    private var gestureRevision by mutableStateOf(0)
    private var editorVersion by mutableStateOf(0)
    private var expanded by mutableStateOf(true)
    private var error by mutableStateOf<String?>(null)
    private var selectedEndpoint by mutableStateOf<MeasureEndpoint?>(null)
    private var sizeText by mutableStateOf("")

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
        // Rotation is handled in place. Process recreation never restores sensitive photos.
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
        photo = null; corners = emptyList(); editor.reset(); editorVersion++; busy = false; error = null
        super.onStop()
        // Only the explicit system-picker handoff may return to this workspace.
        if (!choosingPhoto || isChangingConfigurations) finish()
    }
    override fun onDestroy() { generation.invalidate(); launched.set(false); super.onDestroy() }
    private fun checkAccess() = store.withCapability(installed,"photo.measure") { }
    private fun refreshEditor() { editorVersion++ }
    private fun edit(reportError: Boolean = true, action: () -> EditResult): EditResult {
        if (!live || isFinishing || busy) return EditResult.Rejected("Workspace is not available.")
        return try {
            checkAccess()
            val result = action()
            if (reportError) { error = (result as? EditResult.Rejected)?.reason; if (error != null) expanded = true }
            refreshEditor(); result
        } catch (e: Exception) { failed(e); EditResult.Rejected(error ?: "Measurement is unavailable.") }
    }
    private fun ownerAction(action: () -> Unit) { gestureRevision++; edit { action(); EditResult.Accepted } }
    private fun nudge(endpoint: MeasureEndpoint, dx: Int, dy: Int) {
        val image = photo ?: return
        val m = editor.measurement ?: return
        val p = m.point(endpoint) ?: return
        val token = editor.revision
        val start = MoveRequest(token,m.id,endpoint,DragPhase.BEGIN,null)
        if (edit { editor.move(start) } !is EditResult.Accepted) return
        val next = MeasurePoint(p.x+dx.toDouble()/image.width,p.y+dy.toDouble()/image.height)
        val result = edit { editor.move(start.copy(phase=DragPhase.COMMIT,point=next)) }
        if (result !is EditResult.Accepted) { editor.cancelDrag(); refreshEditor() }
    }
    private fun failed(e: Throwable) {
        val known = e as? ConstructError
        error = "[${known?.code ?: "MEASURE_UNAVAILABLE"}] ${known?.message ?: "Could not read this photo. Try a smaller JPEG or PNG saved on this phone."}"
        expanded = true
        // No provider URI, image data, marker size, endpoints or measurement details in logs.
        runCatching { store.log("measure",known?.code ?: "MEASURE_UNAVAILABLE",installed.manifest,"Native measurement action failed; photo and result details omitted") }
        if (known?.code == "CAPABILITY_DENIED") { photo = null; corners = emptyList(); editor.reset(); refreshEditor() }
    }
    private fun choose() {
        try {
            checkAccess(); generation.invalidate(); photo = null; corners = emptyList(); editor.reset(); refreshEditor()
            error = null; expanded = true
            choosingPhoto = true
            picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
        } catch (e: Exception) { choosingPhoto = false; failed(e) }
    }
    private fun load(uri: Uri) {
        try {
            checkAccess()
            checkRule(workerBusy.compareAndSet(false,true),"MEASURE_BUSY","Previous photo is still finishing. Try again shortly.")
        } catch (e: Exception) { failed(e); return }
        busy = true; error = null; status = "Reading photo and finding reference marker…"
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
                        try { checkAccess(); photo = result; corners = found; expanded = true; status = "Reference found. Enter its measured outer black-square side in millimetres." }
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
            editor.calibrate(corners,size); refreshEditor(); selectedEndpoint = null
            error = null; expanded = false
            status = "Tap the two ends of a length in the photo."
        } catch (e: Exception) { failed(e) }
    }
    @Composable private fun Screen() {
        editorVersion // Read the owner mutation version for Compose invalidation.
        val model = editor.measurement
        val calibrated = editor.sideMm != null
        val instruction = when {
            !calibrated -> status
            model == null -> "Tap the two ends of a length in the photo."
            model.b == null -> "First endpoint set. Tap the other end."
            else -> "Drag an endpoint to adjust, or Clear for another length."
        }
        BackHandler {
            if (editor.isDragging) { gestureRevision++; editor.cancelDrag(); refreshEditor() }
            else if (expanded) expanded = false else finish()
        }
        Surface(Modifier.fillMaxSize()) {
            BoxWithConstraints(Modifier.fillMaxSize().systemBarsPadding().displayCutoutPadding()) {
                val image = photo
                if (image != null) MeasureOverlay(
                    photo = image.asImageBitmap(), photoRevision = editor.revision, gestureRevision = gestureRevision,
                    enabled = live && calibrated && !busy, corners = corners,
                    measurements = listOfNotNull(model), selectedId = model?.id,
                    onPlace = { token,point -> edit { editor.place(token,point) } },
                    onMove = { request -> edit(reportError=request.phase == DragPhase.BEGIN || request.phase == DragPhase.PREVIEW) { editor.move(request) } },
                    onSelect = { token,_ -> if (token == editor.revision) selectedEndpoint = null },
                    modifier = Modifier.fillMaxSize())
                MeasureSheet(
                    state = MeasureSheetState(instruction=instruction,result=model?.label,error=error,
                        setupVisible=corners.isNotEmpty() && !calibrated,sizeText=sizeText,
                        calibrationChip=editor.sideMm?.let { "Marker ${String.format(Locale.ROOT,"%.2f",it).trimEnd('0').trimEnd('.')} mm ✓" },
                        measurement=model,selectedEndpoint=selectedEndpoint,canUndo=editor.canUndo,
                        busy=busy,enabled=calibrated && !busy),
                    actions = MeasureSheetActions(
                        onSizeChange={ sizeText=it.take(8); editor.reset(); refreshEditor(); error=null },
                        onConfirmSize={ confirmSize() },
                        onReopenSetup={ ownerAction { editor.reset(); refreshEditor(); expanded=true } },
                        onSelectEndpoint={ selectedEndpoint=it },onNudge={ e,x,y -> nudge(e,x,y) },
                        onUndo={ ownerAction { editor.undo() } },onClear={ ownerAction { editor.clear() } },
                        onChoosePhoto={ choose() },onClose={ finish() }),
                    expanded=expanded,onExpandedChange={ expanded=it },
                    modifier=Modifier.align(Alignment.BottomCenter).imePadding().heightIn(max=maxHeight * 0.55f))
            }
        }
    }
}
