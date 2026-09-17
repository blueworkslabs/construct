package dev.construct.runtime

import android.content.Context
import okhttp3.Cache
import okhttp3.Call
import okhttp3.Callback
import okhttp3.CookieJar
import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.net.Proxy
import java.net.UnknownHostException
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/** Bounded, origin-scoped GETs. Data interpretation belongs to module code. */
internal class ModuleHttp(context: Context, private val module: ModuleManifest, private val authorize: () -> Unit) {
    private val closed = AtomicBoolean(false)
    private val calls = ConcurrentHashMap.newKeySet<Call>()
    private val origins = module.capabilities.firstOrNull { it.id == "net.http" }?.origins.orEmpty()
    private val prefs = context.getSharedPreferences("module-http-budget", Context.MODE_PRIVATE)
    private val client = OkHttpClient.Builder()
        .dns(object : Dns {
            override fun lookup(name: String): List<java.net.InetAddress> = Dns.SYSTEM.lookup(name).also { addresses ->
                if (addresses.isEmpty() || addresses.any { !HttpPolicy.publicAddress(it) })
                    throw UnknownHostException("Non-public destination")
            }
        }).proxy(Proxy.NO_PROXY).cookieJar(CookieJar.NO_COOKIES)
        .followRedirects(false).followSslRedirects(false).retryOnConnectionFailure(false)
        .connectTimeout(8, TimeUnit.SECONDS).readTimeout(8, TimeUnit.SECONDS).callTimeout(15, TimeUnit.SECONDS)
        .cache(Cache(cacheDirectory(context, module.id), 12L * 1024 * 1024)).build()
    private fun check() { checkRule(!closed.get(), "RUN_STALE", "Module request session closed"); authorize() }
    fun cancel() { calls.forEach { it.cancel() } }
    fun close() { closed.set(true); cancel(); client.connectionPool.evictAll(); client.dispatcher.executorService.shutdown(); runCatching { client.cache?.close() } }
    fun get(params: JSONObject, done: (JSONObject?, ConstructError?) -> Unit) {
        check()
        checkRule(params.keys().asSequence().toSet() == setOf("op", "url", "format") && params.opt("op") == "get",
            "HTTP_PARAMS", "Expected op, url and format")
        val url = HttpPolicy.url(params.opt("url"), origins)
        val format = params.opt("format")
        checkRule(format == "json" || format == "image", "HTTP_PARAMS", "Expected json or image format")
        val request = Request.Builder().url(url).get()
            .header("User-Agent", "Construct-Module/0.9 (+https://github.com/blueworkslabs/construct)")
            .header("Accept", if (format == "json") "application/json" else "image/png,image/jpeg,image/webp")
            .apply { if (format == "json") header("Cache-Control", "no-store") }.build()
        val call = client.newCall(request)
        synchronized(budgetLock) {
            check(); checkRule(calls.size < 4, "HTTP_BUSY", "Four requests are already running")
            val now = System.currentTimeMillis(); val start = prefs.getLong("${module.id}:start", 0)
            val count = if (now - start in 0 until 60000) prefs.getInt("${module.id}:count", 0) else 0
            checkRule(count < 180, "HTTP_RATE", "Internet request budget reached; wait a minute")
            prefs.edit().putLong("${module.id}:start", if (count == 0) now else start).putInt("${module.id}:count", count + 1).commit()
            calls.add(call)
        }
        fun finish(result: JSONObject?, error: ConstructError?) {
            calls.remove(call)
            val denied = try { check(); error } catch (e: ConstructError) { e }
            done(if (denied == null) result else null, denied)
        }
        call.enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) = finish(null, ConstructError("HTTP_UNAVAILABLE", "Request unavailable or cancelled"))
            override fun onResponse(call: Call, response: Response) {
                try {
                    val result = readResponse(response, format as String, ::check)
                    finish(result, null)
                } catch (e: Exception) { finish(null, (e as? ConstructError) ?: ConstructError("HTTP_UNAVAILABLE", "Request unavailable")) }
            }
        })
    }
    companion object {
        private val budgetLock = Any()
        private fun cacheDirectory(context: Context, id: String): File {
            val root = File(context.cacheDir, "module-http").apply { mkdirs() }
            val current = File(root, id)
            val others = root.listFiles().orEmpty().filter { it != current }.sortedBy { it.lastModified() }
            fun bytes(file: File) = file.walkTopDown().filter { it.isFile }.sumOf { it.length() }
            var total = others.sumOf { bytes(it) }
            for (folder in others) {
                if (total <= 50L * 1024 * 1024) break
                val size = bytes(folder)
                if (folder.deleteRecursively()) total -= size
            }
            return current
        }
        internal fun readResponse(response: Response, format: String, authorize: () -> Unit): JSONObject {
            val limit = if (format == "json") 2 * 1024 * 1024 else 256 * 1024
            return response.use { r ->
                authorize()
                val out = JSONObject().put("status", r.code)
                val headers = JSONObject()
                for (name in listOf("cache-control", "expires", "age", "retry-after", "x-rate-limit-retry-after-seconds", "x-rate-limit-remaining"))
                    r.header(name)?.take(512)?.let { headers.put(name, it) }
                out.put("headers", headers)
                if (r.code != 200) return@use out // No redirect following or error-page contents.
                val body = r.body ?: throw ConstructError("HTTP_DATA", "Missing response")
                val mime = body.contentType()?.let { "${it.type}/${it.subtype}" }
                checkRule(if (format == "json") mime == "application/json" else mime in setOf("image/png", "image/jpeg", "image/webp"),
                    "HTTP_DATA", "Unexpected response format")
                checkRule(body.contentLength() <= limit, "HTTP_SIZE", "Response is too large")
                val bytes = body.byteStream().use { it.readBytesBounded(limit) }; authorize()
                if (format == "json") out.put("text", bytes.toString(Charsets.UTF_8))
                else {
                    checkRule(HttpPolicy.raster(bytes, mime), "HTTP_DATA", "Invalid raster response")
                    val dimensions = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size, dimensions)
                    checkRule(dimensions.outWidth in 1..4096 && dimensions.outHeight in 1..4096 &&
                        dimensions.outWidth.toLong() * dimensions.outHeight <= 4_194_304,
                        "HTTP_SIZE", "Raster dimensions exceed bounds")
                    out.put("dataUrl", "data:$mime;base64," + Base64.getEncoder().encodeToString(bytes))
                }
                out
            }
        }
    }
}
