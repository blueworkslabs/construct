package dev.construct.runtime

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** Opaque, per-run lookup table; never accepts a filename or cross-module path. */
internal class PhotoReferences {
    private var files = emptyMap<String, File>()
    @Synchronized fun replace(values: List<File>): List<String> {
        checkRule(values.size <= CameraPhotos.MAX_PHOTOS, "PHOTO_QUOTA", "Private photo list exceeds bounds")
        files = values.associateBy { UUID.randomUUID().toString() }
        return files.keys.toList()
    }
    @Synchronized fun get(ref: String): File = files[ref] ?: throw ConstructError("PHOTO_STALE", "Refresh the private photo list")
    @Synchronized fun clear() { files = emptyMap() }
}

internal class ModulePhotoLibrary(
    private val context: Context,
    moduleId: String,
    private val images: ModuleImageSession,
    private val authorize: (String) -> Unit,
    private val commit: ((() -> Unit) -> Unit),
    private val confirm: (String, Bitmap, (Boolean) -> Unit) -> Unit,
) {
    private val photos = CameraPhotos(context, moduleId)
    private val refs = PhotoReferences()
    private val handler = Handler(Looper.getMainLooper())
    private val lock = Any()
    private var generation = 0L
    private var closed = false
    private var pending: ((JSONObject?, ConstructError?) -> Unit)? = null
    private var deadline: Runnable? = null
    private fun check() { checkRule(!closed, "RUN_STALE", "Photo session closed"); authorize("photos.library"); authorize("image.read") }
    private fun valid(token: Long) { check(); checkRule(token == generation, "PHOTO_CANCELLED", "Photo request was interrupted") }
    fun cancel() = synchronized(lock) {
        generation++; deadline?.let(handler::removeCallbacks); deadline = null
        val done = pending; pending = null
        done?.invoke(null, ConstructError("PHOTO_CANCELLED", "Photo request interrupted"))
    }
    fun close() = synchronized(lock) { closed = true; cancel(); refs.clear() }
    private fun deliver(token: Long, value: JSONObject?, error: ConstructError?) = synchronized(lock) {
        if (closed || token != generation) return@synchronized
        deadline?.let(handler::removeCallbacks); deadline = null
        val done = pending; pending = null
        val denied = try { check(); error } catch (e: ConstructError) { e }
        done?.invoke(if (denied == null) value else null, denied)
    }
    private fun work(token: Long, operation: () -> (() -> Unit)) {
        if (!workerBusy.compareAndSet(false, true)) {
            deliver(token, null, ConstructError("PHOTO_BUSY", "Previous photo operation is finishing")); return
        }
        deadline = Runnable { synchronized(lock) {
            if (token == generation && pending != null) {
                deliver(token, null, ConstructError("PHOTO_TIMEOUT", "Photo operation took too long")); generation++
            }
        } }.also { handler.postDelayed(it, 15000) }
        worker.execute {
            try {
                synchronized(lock) { valid(token) }
                val next = operation()
                handler.post { synchronized(lock) {
                    if (!closed && token == generation) {
                        deadline?.let(handler::removeCallbacks); deadline = null
                        try { valid(token); next() } catch (e: Exception) { deliver(token, null, safe(e)) }
                    }
                } }
            } catch (e: Exception) { handler.post { deliver(token, null, safe(e)) } }
            finally { workerBusy.set(false) }
        }
    }
    private fun safe(e: Exception) = e as? ConstructError ?: ConstructError("PHOTO_FAILED", "Could not complete private photo operation")
    fun request(args: JSONObject, done: (JSONObject?, ConstructError?) -> Unit) {
        synchronized(lock) {
            check()
            val op = args.optString("op")
            checkRule(op in setOf("list", "open", "delete", "export"), "PHOTO_PARAMS", "Unknown photo operation")
            checkRule(args.keys().asSequence().toSet() == if (op == "list") setOf("op") else setOf("op", "ref"), "PHOTO_PARAMS", "Unexpected photo parameters")
            checkRule(pending == null, "PHOTO_BUSY", "A photo request is already running")
            val file = if (op == "list") null else refs.get(args.getString("ref"))
            val token = ++generation; pending = done
            if (op == "open") {
                try { images.openPhoto({ photos.readSelected(file!!) { input, _ -> input.readBytesBounded(CameraPhotos.MAX_FILE.toInt()) } }) { value, error -> deliver(token, value, error) } }
                catch (e: Exception) { deliver(token, null, safe(e)) }
                return
            }
            work(token) {
                if (op == "list") {
                    val files = photos.list()
                    val next: () -> Unit = {
                        val list = JSONArray(); refs.replace(files).forEach { list.put(JSONObject().put("ref", it)) }
                        deliver(token, JSONObject().put("photos", list).put("limit", CameraPhotos.MAX_PHOTOS), null)
                    }
                    next
                } else {
                    checkRule(op != "export" || android.os.Build.VERSION.SDK_INT >= 29, "PHOTO_EXPORT_UNAVAILABLE", "Gallery copy needs Android 10 or later")
                    val bytes = photos.readSelected(file!!) { input, _ -> input.readBytesBounded(CameraPhotos.MAX_FILE.toInt()) }
                    val preview = ImageDecoder.decodeBitmap(ImageDecoder.createSource(ByteBuffer.wrap(bytes))) { decoder, info, _ ->
                        val scale = minOf(1.0, 320.0 / maxOf(info.size.width, info.size.height))
                        decoder.setTargetSize(maxOf(1, (info.size.width * scale).toInt()), maxOf(1, (info.size.height * scale).toInt()))
                        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
                    }
                    val next: () -> Unit = { confirm(op, preview) { accepted -> synchronized(lock) {
                        if (!closed && token == generation) {
                            if (!accepted) deliver(token, JSONObject().put("completed", false), null)
                            else work(token) {
                                val publish: (() -> Unit) -> Unit = { action -> synchronized(lock) { valid(token); commit(action) } }
                                if (op == "delete") photos.delete(file, publish)
                                else {
                                    if (android.os.Build.VERSION.SDK_INT < 29) throw ConstructError("PHOTO_EXPORT_UNAVAILABLE", "Gallery copy needs Android 10 or later")
                                    photos.readSelected(file) { input, size ->
                                        GalleryExport.copy(input, size, MediaStorePhoto(context.contentResolver), publish)
                                    }
                                }
                                val finished: () -> Unit = {
                                    if (op == "delete") { images.clearPhoto(); refs.clear() }
                                    deliver(token, JSONObject().put("completed", true), null)
                                }
                                finished
                            }
                        }
                    } } }
                    next
                }
            }
        }
    }
    companion object {
        private val worker = Executors.newSingleThreadExecutor()
        private val workerBusy = AtomicBoolean(false)
    }
}
