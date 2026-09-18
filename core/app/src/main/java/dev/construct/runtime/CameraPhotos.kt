package dev.construct.runtime

import android.content.Context
import android.graphics.BitmapFactory
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

/** Private per-module originals; native-only paths, bounded by acquisition and library APIs. */
internal class CameraPhotos(context: Context, moduleId: String) {
    companion object {
        const val MAX_PHOTOS = 8
        const val MAX_FILE = 4L * 1024 * 1024
        const val MAX_MODULE = 20L * 1024 * 1024
        const val MAX_TOTAL = 64L * 1024 * 1024
        private val lock = Any()
        private val name = Regex("[a-f0-9-]{36}\\.jpg")
    }
    // Android may expose filesDir through its /data/user/0 -> /data/data alias.
    // Trust the platform-provided base, then reject symlinks beneath our own root.
    private val root = File(context.filesDir.canonicalFile, "camera-photos")
    private val folder: File
    init {
        checkRule(Regex("[a-z][a-z0-9]*(\\.[a-z][a-z0-9-]*)+").matches(moduleId) && moduleId.length <= 120,
            "CAMERA_STORAGE", "Invalid module photo storage")
        checkRule(root.canonicalFile == root.absoluteFile, "CAMERA_STORAGE", "Invalid photo root")
        folder = File(root, moduleId)
        checkRule(folder.canonicalFile == folder.absoluteFile, "CAMERA_STORAGE", "Invalid photo directory")
        synchronized(lock) {
            folder.listFiles()?.filter { it.name.startsWith(".pending-") && it.canonicalFile == it.absoluteFile }?.forEach { it.delete() }
        }
    }
    private fun sync(directory: File) {
        java.nio.channels.FileChannel.open(directory.toPath(), java.nio.file.StandardOpenOption.READ).use { it.force(true) }
    }
    private fun entries(): List<File> = folder.listFiles()?.filter {
        it.isFile && name.matches(it.name) && it.canonicalFile == it.absoluteFile
    }?.sortedWith(compareBy<File> { it.lastModified() }.thenBy { it.name }) ?: emptyList()
    fun list(): List<File> = synchronized(lock) { entries() }
    fun <T> readSelected(photo: File, read: (java.io.InputStream, Long) -> T): T = synchronized(lock) {
        checkRule(photo.parentFile == folder && name.matches(photo.name) && photo.canonicalFile == photo.absoluteFile && photo.isFile,
            "CAMERA_STORAGE", "Invalid saved photo")
        checkRule(photo.length() in 1..MAX_FILE, "CAMERA_IMAGE", "Saved photo is incomplete or too large.")
        photo.inputStream().use { read(it, photo.length()) }
    }
    private fun checkCapacity(extra: Long) {
        val all = entries()
        checkRule(all.size < MAX_PHOTOS && all.sumOf { it.length() } + extra <= MAX_MODULE,
            "CAMERA_QUOTA", "Photo space is full. Delete a saved photo before taking another.")
        val total = root.listFiles()?.filter { it.isDirectory && it.canonicalFile == it.absoluteFile }
            ?.sumOf { dir -> dir.listFiles()?.filter { it.isFile && it.canonicalFile == it.absoluteFile }?.sumOf { it.length() } ?: 0L } ?: 0L
        checkRule(total + extra <= MAX_TOTAL, "CAMERA_QUOTA", "Construct photo space is full. Delete saved photos first.")
    }
    fun reserve() = synchronized(lock) { checkCapacity(MAX_FILE) }
    fun commit(temp: File, publish: ((() -> File) -> File) = { it() }, authorize: () -> Unit): File = synchronized(lock) {
        checkRule(temp.isFile && temp.length() in 1..MAX_FILE, "CAMERA_IMAGE", "Photo is too large or incomplete. Try again.")
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(temp.path, bounds)
        checkRule(bounds.outMimeType == "image/jpeg" && bounds.outWidth in 1..4096 && bounds.outHeight in 1..4096,
            "CAMERA_IMAGE", "Camera returned an unsupported photo size or format.")
        checkCapacity(temp.length())
        checkRule(folder.mkdirs() || folder.isDirectory, "CAMERA_STORAGE", "Could not create photo storage")
        sync(root.parentFile!!); sync(root)
        val target = File(folder, UUID.randomUUID().toString() + ".jpg")
        // CameraX writes to cache first. Copy/sync privately before the final authority check.
        val stage = File(folder, ".pending-${UUID.randomUUID()}")
        try {
            FileOutputStream(stage).use { out -> temp.inputStream().use { it.copyTo(out) }; out.fd.sync() }
            publish {
                authorize()
                checkRule(stage.renameTo(target), "CAMERA_STORAGE", "Could not finish saving the photo")
                sync(folder)
                target
            }
        } catch (error: Exception) {
            target.delete()
            throw error
        } finally { stage.delete(); temp.delete() }
    }
    fun delete(photo: File, publish: ((() -> Unit) -> Unit) = { it() }) = synchronized(lock) {
        checkRule(photo.parentFile == folder && name.matches(photo.name) && photo.canonicalFile == photo.absoluteFile,
            "CAMERA_STORAGE", "Invalid saved photo")
        publish {
            checkRule(!photo.exists() || photo.delete(), "CAMERA_STORAGE", "Could not delete photo")
            if (folder.isDirectory) sync(folder)
        }
    }
    fun deleteAll() = synchronized(lock) { entries().forEach { delete(it) } }
}
