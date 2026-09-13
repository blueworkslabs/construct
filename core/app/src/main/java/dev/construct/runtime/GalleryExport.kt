package dev.construct.runtime

import android.content.ContentResolver
import android.content.ContentValues
import android.net.Uri
import android.os.Environment
import android.provider.MediaStore
import androidx.annotation.RequiresApi
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID

/** A transaction owned by the native UI, never exposed through the module bridge. */
internal interface GalleryDestination {
    fun open(): OutputStream
    fun publish()
    fun discard()
}

internal object GalleryExport {
    fun copy(source: InputStream, expectedBytes: Long, destination: GalleryDestination,
             publishAuthorized: ((() -> Unit) -> Unit)) {
        try {
            checkRule(expectedBytes in 1..CameraPhotos.MAX_FILE, "PHOTO_EXPORT", "Saved photo is incomplete or too large.")
            destination.open().use { output ->
                val buffer = ByteArray(32 * 1024)
                var copied = 0L
                while (true) {
                    val count = source.read(buffer)
                    if (count < 0) break
                    copied += count
                    checkRule(copied <= expectedBytes, "PHOTO_EXPORT", "Saved photo changed during export.")
                    output.write(buffer, 0, count)
                }
                checkRule(copied == expectedBytes, "PHOTO_EXPORT", "Saved photo is incomplete.")
                output.flush()
            }
            // Close the stream before making the row visible. Recheck session and grants here.
            publishAuthorized { destination.publish() }
        } catch (error: Exception) {
            try { destination.discard() } catch (_: Exception) {
                throw ConstructError("PHOTO_EXPORT_CLEANUP", "Export failed and its pending copy could not be removed. Android will expire the hidden pending item.")
            }
            throw error
        }
    }
}

@RequiresApi(29)
internal class MediaStorePhoto(private val resolver: ContentResolver) : GalleryDestination {
    private val uri: Uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, ContentValues().apply {
        put(MediaStore.Images.Media.DISPLAY_NAME, "Construct-${UUID.randomUUID()}.jpg")
        put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
        put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Construct")
        put(MediaStore.Images.Media.IS_PENDING, 1)
    }) ?: throw ConstructError("PHOTO_EXPORT", "Phone gallery could not create a pending photo.")

    override fun open(): OutputStream = resolver.openOutputStream(uri, "w")
        ?: throw ConstructError("PHOTO_EXPORT", "Phone gallery could not open the photo.")
    override fun publish() {
        checkRule(resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null) == 1,
            "PHOTO_EXPORT", "Phone gallery could not finish saving the photo.")
    }
    override fun discard() {
        checkRule(resolver.delete(uri, null, null) == 1, "PHOTO_EXPORT_CLEANUP", "Pending photo could not be removed.")
    }
}
