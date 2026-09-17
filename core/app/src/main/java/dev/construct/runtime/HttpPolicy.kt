package dev.construct.runtime

import java.net.InetAddress
import java.net.URI

/** Transport policy only. No application/provider names or domain parsing. */
internal object HttpPolicy {
    private val hostname = Regex("[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+")
    fun origin(value: Any?): String {
        checkRule(value is String && value.length <= 260, "MANIFEST_SCHEMA", "Invalid HTTP source")
        val text = value as String
        val host = text.removePrefix("https://")
        checkRule(text == "https://$host" && hostname.matches(host) && host.length <= 253 &&
            host.substringAfterLast('.').any { it in 'a'..'z' } &&
            listOf("localhost", "local", "internal", "invalid", "test", "onion").none { host == it || host.endsWith(".$it") },
            "MANIFEST_SCHEMA", "Sources must be exact public HTTPS origins")
        return text
    }
    fun url(value: Any?, origins: List<String>): String {
        checkRule(value is String && value.length in 1..2048, "HTTP_URL", "Invalid request URL")
        val text = value as String
        val uri = try { URI(text) } catch (_: Exception) { throw ConstructError("HTTP_URL", "Invalid request URL") }
        checkRule(uri.scheme == "https" && uri.host != null && uri.rawUserInfo == null && uri.port == -1 &&
            uri.rawFragment == null && "https://${uri.host}" in origins && uri.rawAuthority == uri.host &&
            text.none { it.isISOControl() || it == '\\' }, "HTTP_SOURCE", "Request is outside approved sources")
        return text
    }
    fun publicAddress(address: InetAddress): Boolean {
        if (address.isAnyLocalAddress || address.isLoopbackAddress || address.isLinkLocalAddress ||
            address.isSiteLocalAddress || address.isMulticastAddress) return false
        val b = address.address.map { it.toInt() and 255 }
        if (b.size == 4) {
            val (a, c) = b
            return a !in setOf(0, 10, 127) && a < 224 &&
                !(a == 100 && c in 64..127) && !(a == 169 && c == 254) && !(a == 172 && c in 16..31) &&
                !(a == 192 && c in setOf(0, 168)) && !(a == 198 && c in setOf(18, 19)) &&
                !(a == 198 && c == 51 && b[2] == 100) && !(a == 203 && c == 0 && b[2] == 113)
        }
        // Accept ordinary global-unicast IPv6, excluding transition/documentation blocks.
        return b.size == 16 && b[0] in 0x20..0x3f &&
            !(b[0] == 0x20 && b[1] == 0x02) &&
            !(b[0] == 0x20 && b[1] == 0x01 && (b[2] < 2 || (b[2] == 0x0d && b[3] == 0xb8)))
    }
    fun raster(bytes: ByteArray, mime: String?): Boolean {
        fun starts(vararg values: Int) = bytes.size >= values.size && values.indices.all { (bytes[it].toInt() and 255) == values[it] }
        return when (mime) {
            "image/png" -> starts(137, 80, 78, 71, 13, 10, 26, 10)
            "image/jpeg" -> starts(255, 216, 255)
            "image/webp" -> bytes.size >= 12 && bytes.copyOfRange(0, 4).toString(Charsets.US_ASCII) == "RIFF" &&
                bytes.copyOfRange(8, 12).toString(Charsets.US_ASCII) == "WEBP"
            else -> false
        }
    }
    fun approved(manifest: ModuleManifest, values: Set<String>): Boolean =
        manifest.capabilities.firstOrNull { it.id == "net.http" }?.origins?.all { it in values } ?: false
}
