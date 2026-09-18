package dev.construct.runtime

import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.Signature
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import java.util.zip.ZipInputStream

class ConstructError(val code: String, message: String) : Exception(message)
fun checkRule(ok: Boolean, code: String, message: String) {
    if (!ok) throw ConstructError(code, message)
}

data class Capability(val id: String, val reason: String, val optional: Boolean = false, val origins: List<String> = emptyList()) {
    val explicitOptIn: Boolean get() = id in CapabilityLifecycle.retired || id in setOf("device.tone", "contacts.read", "camera.capture", "net.http", "location.read", "image.read", "image.markers")
    val label: String get() = when (id) {
        "net.http" -> "Allow approved internet sources"
        "image.read" -> "Allow selected image pixels"
        "image.markers" -> "Allow local marker detection"
        "location.read" -> "Allow reading phone location"
        "camera.capture" -> "Allow camera workspace"
        "contacts.read" -> "Allow reading contacts"
        "device.tone" -> "Allow short tones"
        "device.toast" -> "Allow pop-up messages"
        "storage.kv" -> "Allow saving data on this phone"
        "log.write" -> "Allow diagnostics"
        else -> id
    }
}
data class ModuleManifest(val id: String, val name: String, val version: String,
    val entry: String, val capabilities: List<Capability>, val api: String = "0.1.0", val themeColor: String? = null)
data class VerifiedPackage(val manifest: ModuleManifest, val files: Map<String, ByteArray>, val digest: String)

object Packages {
    const val MAX_ZIP = 4 * 1024 * 1024
    const val MAX_EXPANDED = 12 * 1024 * 1024
    const val MAX_FILE = 2 * 1024 * 1024
    val supported = setOf("device.toast", "log.write", "storage.kv", "device.tone", "contacts.read", "camera.capture", "net.http", "location.read", "image.read", "image.markers")
    val recognized = supported + CapabilityLifecycle.retired
    private val idPattern = Regex("[a-z][a-z0-9]*(\\.[a-z][a-z0-9-]*)+")
    private val versionPattern = Regex("(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)")
    private val filePattern = Regex("[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*(?:/[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*)*")
    private val extensions = setOf("html", "js", "css", "json", "png", "jpg", "jpeg", "webp", "txt", "woff2")

    private fun keys(value: JSONObject, allowed: Set<String>, required: Set<String> = emptySet()) {
        val actual = value.keys().asSequence().toSet()
        checkRule(actual.all { it in allowed } && actual.containsAll(required), "MANIFEST_SCHEMA", "Unexpected or missing manifest fields")
    }
    private fun string(value: JSONObject, key: String, max: Int): String {
        val result = value.get(key)
        checkRule(result is String && result.isNotBlank() && result.length <= max, "MANIFEST_SCHEMA", "Invalid $key")
        return result as String
    }
    fun safePath(path: String) = path.length <= 180 && filePattern.matches(path)
    fun manifest(bytes: ByteArray): ModuleManifest {
        checkRule(bytes.size <= 32768, "MANIFEST_SIZE", "Manifest is too large")
        val m = JSONObject(bytes.toString(Charsets.UTF_8))
        keys(m, setOf("schemaVersion", "id", "name", "version", "description", "constructApi", "runtime", "entry", "capabilities", "author", "homepage", "themeColor"),
            setOf("schemaVersion", "id", "name", "version", "constructApi", "runtime", "entry", "capabilities"))
        checkRule(m.get("schemaVersion") == 1, "MANIFEST_SCHEMA", "Unsupported manifest schema")
        val id = string(m, "id", 120)
        val version = string(m, "version", 50)
        checkRule(idPattern.matches(id) && versionPattern.matches(version), "MANIFEST_SCHEMA", "Invalid module identity or version")
        val api = m.getJSONObject("constructApi")
        keys(api, setOf("min", "target"), setOf("min", "target"))
        checkRule(api.get("min") in setOf("0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0", "0.6.0", "0.7.0", "0.8.0", "0.9.0", "0.10.0") && api.get("target") == api.get("min"), "API_INCOMPATIBLE", "This module needs a different Construct API")
        val runtime = m.getJSONObject("runtime")
        keys(runtime, setOf("kind"), setOf("kind"))
        checkRule(runtime.get("kind") == "webview-js", "RUNTIME_UNSUPPORTED", "Only WebView modules are supported")
        val entry = string(m, "entry", 180)
        checkRule(safePath(entry) && entry.endsWith(".html"), "ENTRY_INVALID", "Module entry must be a local HTML file")
        val rawCaps = m.getJSONArray("capabilities")
        checkRule(rawCaps.length() <= recognized.size, "CAPABILITY_DENIED", "Too many requested capabilities")
        val caps = (0 until rawCaps.length()).map { index ->
            val cap = rawCaps.getJSONObject(index)
            keys(cap, setOf("id", "reason", "optional", "origins"), setOf("id", "reason"))
            if (cap.has("optional")) checkRule(cap.get("optional") is Boolean, "MANIFEST_SCHEMA", "Invalid optional flag")
            val capId = string(cap, "id", 80)
            checkRule(capId in recognized, "CAPABILITY_DENIED", "Unsupported capability: $capId")
            val origins = if (capId == "net.http") {
                checkRule(api.get("min") in setOf("0.9.0", "0.10.0"), "API_INCOMPATIBLE", "HTTP requires Construct API 0.9.0")
                val list = cap.optJSONArray("origins") ?: throw ConstructError("MANIFEST_SCHEMA", "HTTP sources are required")
                checkRule(list.length() in 1..8, "MANIFEST_SCHEMA", "Declare 1–8 HTTP sources")
                (0 until list.length()).map { n -> HttpPolicy.origin(list.opt(n)) }.also {
                    checkRule(it.distinct().size == it.size, "MANIFEST_SCHEMA", "Duplicate HTTP source")
                }
            } else {
                checkRule(!cap.has("origins"), "MANIFEST_SCHEMA", "Sources apply only to HTTP")
                emptyList()
            }
            checkRule(capId != "location.read" || api.get("min") in setOf("0.9.0", "0.10.0"), "API_INCOMPATIBLE", "Location requires Construct API 0.9.0")
            checkRule(capId !in setOf("image.read", "image.markers") || api.get("min") == "0.10.0", "API_INCOMPATIBLE", "Images require Construct API 0.10.0")
            Capability(capId, string(cap, "reason", 240), cap.optBoolean("optional", false), origins)
        }
        checkRule(caps.none { it.id == "device.tone" } || api.get("min") in setOf("0.2.0", "0.3.0", "0.4.0", "0.5.0", "0.6.0", "0.7.0", "0.8.0", "0.9.0", "0.10.0"), "API_INCOMPATIBLE", "Tone requires Construct API 0.2.0")
        checkRule(caps.none { it.id == "contacts.read" } || api.get("min") in setOf("0.3.0", "0.4.0", "0.5.0", "0.6.0", "0.7.0", "0.8.0", "0.9.0", "0.10.0"), "API_INCOMPATIBLE", "Contacts require Construct API 0.3.0")
        checkRule(caps.none { it.id == "camera.capture" } || api.get("min") in setOf("0.4.0", "0.5.0", "0.6.0", "0.7.0", "0.8.0", "0.9.0", "0.10.0"), "API_INCOMPATIBLE", "Camera requires Construct API 0.4.0")
        CapabilityLifecycle.validateHistoricalApi(caps, api.getString("min"))
        checkRule(caps.map { it.id }.distinct().size == caps.size, "MANIFEST_SCHEMA", "Duplicate capabilities")
        checkRule(caps.none { it.id == "image.markers" } || caps.any { it.id == "image.read" },
            "MANIFEST_SCHEMA", "image.markers requires image.read")
        for ((field, max) in listOf("description" to 500, "author" to 120, "homepage" to 500)) {
            if (m.has(field)) checkRule(m.get(field) is String && m.getString(field).length <= max, "MANIFEST_SCHEMA", "Invalid $field")
        }
        val themeColor = if (m.has("themeColor")) string(m, "themeColor", 7) else null
        checkRule(themeColor == null || Regex("#[0-9a-fA-F]{6}").matches(themeColor), "MANIFEST_SCHEMA", "themeColor must be #RRGGBB")
        checkRule(themeColor == null || api.get("min") in setOf("0.6.0", "0.7.0", "0.8.0", "0.9.0", "0.10.0"), "API_INCOMPATIBLE", "Theme colour requires Construct API 0.6.0")
        return ModuleManifest(id, string(m, "name", 80), version, entry, caps, api.getString("min"), themeColor)
    }

    fun catalog(bytes: ByteArray): List<CatalogVersion> {
        val root = JSONObject(bytes.toString(Charsets.UTF_8))
        checkRule(root.get("schemaVersion") == 1, "CATALOG_SCHEMA", "Unsupported catalog schema")
        val modules = root.getJSONArray("modules")
        checkRule(modules.length() <= 100, "CATALOG_SIZE", "Catalog is too large")
        val results = mutableListOf<CatalogVersion>()
        for (i in 0 until modules.length()) {
            val module = modules.getJSONObject(i)
            val id = module.getString("id")
            val versions = module.getJSONArray("versions")
            checkRule(idPattern.matches(id) && id.length <= 120 && versions.length() <= 50, "CATALOG_SCHEMA", "Invalid catalog module")
            for (j in 0 until versions.length()) {
                val v = versions.getJSONObject(j)
                val version = v.getString("version")
                val artifact = v.getString("artifact")
                val hash = v.getString("sha256")
                checkRule(versionPattern.matches(version) && version.length <= 50 && safePath(artifact) && artifact.endsWith(".zip") && Regex("[a-f0-9]{64}").matches(hash), "CATALOG_SCHEMA", "Invalid catalog artifact")
                val signature = v.getString("signature")
                checkRule(signature.length <= 1024, "CATALOG_SCHEMA", "Invalid signature size")
                results.add(CatalogVersion(id, module.optString("name", id).take(80), version, artifact, hash, signature, v.optBoolean("testFixture", false)))
            }
        }
        checkRule(results.map { "${it.id}@${it.version}" }.distinct().size == results.size, "CATALOG_SCHEMA", "Duplicate catalog versions")
        return results
    }

    fun verify(blob: ByteArray, expected: CatalogVersion, publicKey: ByteArray): VerifiedPackage {
        checkRule(blob.size <= MAX_ZIP, "PACKAGE_SIZE", "Package is too large")
        val hash = MessageDigest.getInstance("SHA-256").digest(blob).joinToString("") { "%02x".format(it) }
        checkRule(hash == expected.sha256, "CHECKSUM_FAILED", "Package download is damaged or changed")
        val verifier = Signature.getInstance("SHA256withRSA")
        verifier.initVerify(KeyFactory.getInstance("RSA").generatePublic(X509EncodedKeySpec(publicKey)))
        verifier.update(blob)
        checkRule(verifier.verify(Base64.getDecoder().decode(expected.signature)), "SIGNATURE_FAILED", "Package is not signed by the trusted publisher")
        val files = linkedMapOf<String, ByteArray>()
        var expanded = 0
        ZipInputStream(ByteArrayInputStream(blob)).use { zip ->
            while (true) {
                val entry = zip.nextEntry ?: break
                checkRule(!entry.isDirectory && safePath(entry.name) && entry.name.substringAfterLast('.') in extensions, "ZIP_PATH", "Unsupported package path")
                checkRule(!files.containsKey(entry.name) && files.size < 128, "ZIP_ENTRIES", "Duplicate or excessive package entries")
                val content = zip.readBytesBounded(MAX_FILE)
                expanded += content.size
                checkRule(expanded <= MAX_EXPANDED, "ZIP_EXPANDED_SIZE", "Expanded package is too large")
                files[entry.name] = content
            }
        }
        val m = manifest(files["manifest.json"] ?: throw ConstructError("MANIFEST_MISSING", "Package has no manifest"))
        checkRule(m.id == expected.id && m.version == expected.version, "IDENTITY_MISMATCH", "Signed package does not match catalog identity")
        checkRule(files.containsKey(m.entry), "ENTRY_MISSING", "Module entry file is missing")
        // Every extraction path is a regular file. Reject file/directory collisions before writing.
        checkRule(files.keys.none { name -> files.keys.any { other -> other.startsWith("$name/") } }, "ZIP_PATH", "Conflicting package paths")
        return VerifiedPackage(m, files, hash)
    }
}

fun java.io.InputStream.readBytesBounded(limit: Int): ByteArray {
    val output = java.io.ByteArrayOutputStream()
    val buffer = ByteArray(8192)
    while (true) {
        val count = read(buffer)
        if (count < 0) break
        checkRule(output.size() + count <= limit, "SIZE_LIMIT", "Input exceeds size limit")
        output.write(buffer, 0, count)
    }
    return output.toByteArray()
}
