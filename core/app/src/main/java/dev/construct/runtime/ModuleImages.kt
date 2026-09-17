package dev.construct.runtime

import android.graphics.BitmapFactory
import java.util.Base64

/** Local raster bytes only: never a URL fetch or active SVG/HTML document. */
internal object ModuleImages {
    private const val MAX_BYTES = 256 * 1024
    private const val MAX_URL = 350000
    fun validate(bytes: ByteArray, mime: String?) {
        checkRule(bytes.size <= MAX_BYTES, "HTTP_SIZE", "Raster exceeds byte limit")
        checkRule(HttpPolicy.raster(bytes, mime), "HTTP_DATA", "Invalid raster response")
        val size = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, size)
        checkRule(size.outWidth in 1..4096 && size.outHeight in 1..4096 &&
            size.outWidth.toLong() * size.outHeight <= 4_194_304,
            "HTTP_SIZE", "Raster dimensions exceed bounds")
    }
    fun dataUrl(raw: String): Pair<String, ByteArray> {
        checkRule(raw.length <= MAX_URL, "HTTP_SIZE", "Raster URL exceeds limit")
        val prefix = raw.substringBefore(',')
        val mime = when (prefix) {
            "data:image/png;base64" -> "image/png"
            "data:image/jpeg;base64" -> "image/jpeg"
            "data:image/webp;base64" -> "image/webp"
            else -> throw ConstructError("HTTP_DATA", "Only base64 raster images are local resources")
        }
        val bytes = try { Base64.getDecoder().decode(raw.substringAfter(',', "")) }
            catch (_: IllegalArgumentException) { throw ConstructError("HTTP_DATA", "Invalid raster encoding") }
        validate(bytes, mime)
        return mime to bytes
    }
}
