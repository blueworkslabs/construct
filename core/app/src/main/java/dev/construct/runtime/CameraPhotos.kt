package dev.construct.runtime

import android.content.Context
import android.graphics.BitmapFactory
import java.io.File
import java.io.FileOutputStream
import java.util.UUID

/** Private per-module originals; native-only paths, bounded by acquisition and library APIs. */
internal class CameraPhotos(context: Context, moduleId: String,
    private val identityBarrier: ((File) -> Unit)? = null) {
    companion object {
        const val MAX_PHOTOS = 8
        const val MAX_FILE = 4L * 1024 * 1024
        const val MAX_MODULE = 20L * 1024 * 1024
        const val MAX_TOTAL = 64L * 1024 * 1024
        private val lock = Any()
        private val name = Regex("[a-f0-9-]{36}\\.jpg")
        private const val IDENTITY_KEY = ".identity-key"
        private const val IDENTITY_INITIALIZED = ".identity-initialized"
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
    /**
     * API 0.12 stable identities: HMAC of the host-allocated random filename under a
     * durable per-module key. Filenames are never renamed or reused, so an ID survives
     * refresh/restart/module update and retires with its original. The key is written
     * atomically before any ID is returned; a damaged key fails instead of re-keying.
     */
    fun listIdentified(): List<Pair<File, String>> = synchronized(lock) {
        val all = entries()
        if (all.isEmpty()) return@synchronized emptyList()
        val mac = javax.crypto.Mac.getInstance("HmacSHA256")
        mac.init(javax.crypto.spec.SecretKeySpec(identityKey(), "HmacSHA256"))
        val encoder = java.util.Base64.getUrlEncoder().withoutPadding()
        all.map { it to "p" + encoder.encodeToString(mac.doFinal(it.name.toByteArray(Charsets.US_ASCII)).copyOf(18)) }
    }
    private fun identityKey(): ByteArray {
        val key = File(folder, IDENTITY_KEY)
        val initialized = File(folder, IDENTITY_INITIALIZED)
        val magic = "CPI1".toByteArray(Charsets.US_ASCII)
        fun digest(bytes: ByteArray) = java.security.MessageDigest.getInstance("SHA-256").digest(bytes)
        fun read(file: File, size: Int): ByteArray {
            checkRule(file.isFile && file.canonicalFile == file.absoluteFile && file.length() == size.toLong(),
                "PHOTO_FAILED", "Private photo identities are unavailable")
            return file.readBytes().also { checkRule(it.size == size, "PHOTO_FAILED", "Private photo identities are unavailable") }
        }
        fun barrier() { identityBarrier?.invoke(folder) ?: sync(folder) }
        fun write(file: File, bytes: ByteArray) {
            val stage = File(folder, ".pending-${UUID.randomUUID()}")
            try {
                FileOutputStream(stage).use { it.write(bytes); it.fd.sync() }
                checkRule(stage.renameTo(file), "PHOTO_FAILED", "Could not keep private photo identities")
                barrier()
            } finally { stage.delete() }
        }
        try {
            // A durable marker distinguishes legacy backfill from loss of an established key.
            // The versioned checksum detects accidental same-size corruption, not hostile root edits.
            if (!key.exists()) {
                checkRule(!initialized.exists(), "PHOTO_FAILED", "Private photo identities are unavailable")
                val payload = magic + ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }
                write(key, payload + digest(payload))
            }
            val record = read(key, 68)
            val payload = record.copyOfRange(0, 36)
            checkRule(payload.copyOfRange(0, 4).contentEquals(magic) &&
                java.security.MessageDigest.isEqual(digest(payload), record.copyOfRange(36, 68)),
                "PHOTO_FAILED", "Private photo identities are unavailable")
            val fingerprint = digest(record)
            if (initialized.exists()) {
                checkRule(java.security.MessageDigest.isEqual(read(initialized, 32), fingerprint),
                    "PHOTO_FAILED", "Private photo identities are unavailable")
            } else {
                // Retry the key's directory durability barrier before committing the marker.
                barrier()
                write(initialized, fingerprint)
            }
            // A previous rename may have succeeded while its directory sync failed. A retry
            // must complete that barrier before publishing, even when both files now exist.
            barrier()
            return payload.copyOfRange(4, 36)
        } catch (error: ConstructError) { throw error }
        catch (error: Exception) { throw ConstructError("PHOTO_FAILED", "Could not keep private photo identities") }
    }
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
