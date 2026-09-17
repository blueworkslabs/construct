package dev.construct.runtime

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

internal object ImageMarkerNative {
    init { System.loadLibrary("construct_measure") }
    external fun detect(pixels: IntArray, width: Int, height: Int): DoubleArray
}

/** Run-private selected raster; domain interpretation is deliberately absent. */
internal class ModuleImageSession(
    private val context: Context,
    private val origin: String,
    private val authorize: (String) -> Unit,
    private val picker: ((Uri?) -> Unit) -> Unit,
) {
    private data class Image(val handle: String, val bitmap: Bitmap, val png: ByteArray)
    private val generation = AtomicLong()
    private val handler = Handler(Looper.getMainLooper())
    @Volatile private var closed = false
    @Volatile private var current: Image? = null
    private var pending: ((JSONObject?, ConstructError?) -> Unit)? = null
    private var deadline: Runnable? = null
    private var lastWork = -1000L

    private fun check(method: String = "image.read") {
        checkRule(!closed, "RUN_STALE", "Image session closed")
        authorize("image.read")
        if (method != "image.read") authorize(method)
    }
    private fun params(value: JSONObject, expected: Set<String>) {
        checkRule(value.keys().asSequence().toSet() == expected, "IMAGE_PARAMS", "Unexpected or missing image parameters")
    }
    private fun image(handle: String): Image {
        check("image.read")
        return current?.takeIf { it.handle == handle }
            ?: throw ConstructError("IMAGE_STALE", "Image is no longer available; choose it again")
    }
    fun resource(path: String): ByteArray {
        check("image.read")
        val image = current ?: throw ConstructError("IMAGE_STALE", "Image is no longer available")
        checkRule(path == "construct-images/${image.handle}.png", "IMAGE_STALE", "Image is no longer available")
        return image.png
    }
    fun cancel() {
        generation.incrementAndGet()
        deadline?.let(handler::removeCallbacks); deadline = null
        val done = pending; pending = null
        done?.invoke(null, ConstructError("IMAGE_CANCELLED", "Image request interrupted; try again"))
    }
    fun close() { closed = true; cancel(); current = null }
    private fun deliver(token: Long, value: JSONObject?, error: ConstructError?) {
        if (closed || token != generation.get()) return
        deadline?.let(handler::removeCallbacks); deadline = null
        val done = pending; pending = null
        done?.invoke(value, error)
    }
    private fun work(token: Long, method: String, operation: () -> Pair<JSONObject, Image?>) {
        if (closed || token != generation.get()) return
        try {
            check(method)
            val now = android.os.SystemClock.elapsedRealtime()
            checkRule(method != "image.markers" || now - lastWork >= 1000, "IMAGE_RATE", "Wait a moment before processing another image")
            checkRule(workerBusy.compareAndSet(false, true), "IMAGE_BUSY", "Previous image processing is still finishing")
            if (method == "image.markers") lastWork = now
        } catch (e: ConstructError) { deliver(token, null, e); return }
        deadline = Runnable {
            if (token == generation.get()) {
                deliver(token, null, ConstructError("IMAGE_TIMEOUT", "Image processing took too long"))
                generation.incrementAndGet()
            }
        }.also { handler.postDelayed(it, 15000) }
        worker.execute {
            try {
                check(method)
                checkRule(token == generation.get(), "IMAGE_CANCELLED", "Image request interrupted")
                val (value, replacement) = operation()
                handler.post {
                    if (!closed && token == generation.get()) {
                        try {
                            check(method)
                            if (replacement != null) current = replacement
                            deliver(token, value, null)
                        } catch (e: ConstructError) { deliver(token, null, e) }
                    }
                }
            } catch (e: Exception) {
                val safe = e as? ConstructError ?: ConstructError("IMAGE_INVALID", "Could not process this image; try a smaller saved JPEG or PNG")
                handler.post { deliver(token, null, safe) }
            } finally { workerBusy.set(false) }
        }
    }
    fun request(method: String, args: JSONObject, done: (JSONObject?, ConstructError?) -> Unit) {
        check(method)
        val op = args.optString("op")
        if (method == "image.read" && op == "release") {
            params(args, setOf("op", "handle")); image(args.getString("handle"))
            cancel(); current = null; done(JSONObject().put("released", true), null); return
        }
        if (method == "image.read") {
            params(args, setOf("op")); checkRule(op == "pick", "IMAGE_PARAMS", "Expected op:pick or op:release")
        } else {
            params(args, setOf("op", "handle", "dictionary"))
            checkRule(method == "image.markers" && op == "detect" && args.optString("dictionary") == "DICT_4X4_50",
                "IMAGE_PARAMS", "Expected detect with DICT_4X4_50")
            image(args.getString("handle"))
        }
        checkRule(pending == null, "IMAGE_BUSY", "An image request is already running")
        val token = generation.incrementAndGet(); pending = done
        if (method == "image.read") {
            current = null
            try {
                picker { uri ->
                    if (uri == null) deliver(token, null, ConstructError("IMAGE_CANCELLED", "No photo selected"))
                    else work(token, method) {
                        val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytesBounded(20 * 1024 * 1024) }
                            ?: throw ConstructError("IMAGE_INVALID", "Could not read selected image")
                        val bitmap = ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(bytes))) { decoder, info, _ ->
                            checkRule(info.size.width in 1..12000 && info.size.height in 1..12000,
                                "IMAGE_SIZE", "Source image dimensions exceed bounds")
                            val scale = minOf(1.0, 1600.0 / maxOf(info.size.width, info.size.height))
                            decoder.setTargetSize(maxOf(1, (info.size.width * scale).toInt()), maxOf(1, (info.size.height * scale).toInt()))
                            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                            decoder.setOnPartialImageListener { false }
                        }
                        val out = ByteArrayOutputStream()
                        checkRule(bitmap.compress(Bitmap.CompressFormat.PNG, 100, out), "IMAGE_INVALID", "Could not prepare image")
                        val png = out.toByteArray()
                        checkRule(png.size <= 12 * 1024 * 1024, "IMAGE_SIZE", "Working image exceeds byte bound")
                        val selected = Image(UUID.randomUUID().toString(), bitmap, png)
                        JSONObject().put("handle", selected.handle).put("url", "$origin/construct-images/${selected.handle}.png")
                            .put("width", bitmap.width).put("height", bitmap.height).put("mime", "image/png") to selected
                    }
                }
            } catch (e: Exception) { deliver(token, null, e as? ConstructError ?: ConstructError("IMAGE_UNAVAILABLE", "Could not open image picker")) }
        } else {
            val selected = image(args.getString("handle"))
            work(token, method) {
                val bitmap = selected.bitmap
                val pixels = IntArray(bitmap.width * bitmap.height)
                bitmap.getPixels(pixels, 0, bitmap.width, 0, 0, bitmap.width, bitmap.height)
                val values = ImageMarkerNative.detect(pixels, bitmap.width, bitmap.height)
                checkRule(values.size % 9 == 0 && values.size <= 64 * 9, "IMAGE_DATA", "Marker output exceeds bounds")
                val markers = JSONArray()
                for (offset in values.indices step 9) {
                    val corners = JSONArray()
                    for (i in 0..3) {
                        val x = values[offset + 1 + i * 2]; val y = values[offset + 2 + i * 2]
                        checkRule(x.isFinite() && y.isFinite() && x in 0.0..1.0 && y in 0.0..1.0, "IMAGE_DATA", "Invalid marker coordinates")
                        corners.put(JSONObject().put("x", x).put("y", y))
                    }
                    checkRule(values[offset] in 0.0..49.0 && values[offset] == values[offset].toInt().toDouble(), "IMAGE_DATA", "Invalid marker identifier")
                    markers.put(JSONObject().put("id", values[offset].toInt()).put("corners", corners))
                }
                JSONObject().put("dictionary", "DICT_4X4_50").put("markers", markers) to null
            }
        }
    }
    companion object {
        private val worker = Executors.newSingleThreadExecutor()
        private val workerBusy = AtomicBoolean(false)
    }
}
