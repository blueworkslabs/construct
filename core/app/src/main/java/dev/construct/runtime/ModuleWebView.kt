package dev.construct.runtime

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.webkit.ConsoleMessage
import android.webkit.PermissionRequest
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File

internal fun moduleChromeClient(onError: (Int) -> Unit, onPopup: () -> Unit) = object : WebChromeClient() {
    override fun onPermissionRequest(request: PermissionRequest) { request.deny() }
    override fun onCreateWindow(view: WebView?, isDialog: Boolean, isUserGesture: Boolean, resultMsg: android.os.Message?): Boolean {
        onPopup(); return false
    }
    override fun onConsoleMessage(message: ConsoleMessage): Boolean {
        // Conservative alpha policy: ERROR-level console events also fail the run.
        // This covers uncaught startup exceptions and avoids marking half-rendered UI healthy.
        if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) onError(message.lineNumber())
        return true
    }
}

@SuppressLint("SetJavaScriptEnabled")
internal fun moduleWebView(context: Context, store: ModuleStore, installed: Installed,
    pickImage: ((Uri?) -> Unit) -> Unit = { throw ConstructError("IMAGE_UNAVAILABLE", "Image picker unavailable") },
    onFailure: (WebView, String) -> Unit): ModuleSessionView {
    if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
        throw ConstructError("WEBVIEW_UNSUPPORTED", "Update Android System WebView or Chrome before opening modules")
    }
    val module = installed.manifest
    CapabilityLifecycle.requireRunnable(module)
    val root = store.directory(installed.digest)
    val origin = "https://${module.id}.construct.invalid"
    val entry = "$origin/${module.entry}"
    val active = java.util.concurrent.atomic.AtomicBoolean(true)
    val tone = TonePlayer(context) { code -> store.log("audio", code, module, "Fixed short tone; submission is not proof of audibility") }
    lateinit var contacts: ContactsReader
    var http: ModuleHttp? = null
    var location: ModuleLocation? = null
    var images: ModuleImageSession? = null
    val view = object : ModuleSessionView(context) {
        override fun releaseSession() { active.set(false); contacts.close(); tone.close(); http?.close(); location?.close(); images?.close() }
    }
    contacts = ContactsReader(context) {
        view.gate.authorize("contacts.read")
        store.withCapability(installed, "contacts.read") { }
    }
    fun authorizeCapability(capability: String) {
        checkRule(active.get(), "RUN_STALE", "Module session closed")
        view.gate.authorize(capability); store.withCapability(installed, capability) { }
    }
    if (module.capabilities.any { it.id == "net.http" }) http = ModuleHttp(context, module) { authorizeCapability("net.http") }
    if (module.capabilities.any { it.id == "location.read" }) location = ModuleLocation(context) { authorizeCapability("location.read") }
    if (module.capabilities.any { it.id == "image.read" }) images = ModuleImageSession(context, origin, ::authorizeCapability, pickImage)
    view.stopImageEffects = { images?.cancel() }
    view.stopEffects = { tone.pause(); http?.cancel(); location?.cancel() }
    val reportedBlocks = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()
    var calls = 0
    var window = android.os.SystemClock.elapsedRealtime()
    var lastToast = -2000L
    fun blocked() = WebResourceResponse("text/plain", "UTF-8", 403, "Blocked", emptyMap(), ByteArrayInputStream(ByteArray(0)))
    fun local(uri: Uri): Boolean = uri.scheme == "https" && uri.host == "${module.id}.construct.invalid" && uri.port == -1 && uri.userInfo == null
    fun fail(code: String) {
        if (!active.compareAndSet(true, false)) return
        // Persist failure before posting the UI transition, so a queued Mark working
        // action cannot confirm a failed run even if the view has not closed yet.
        runCatching { store.runtimeFailed(installed, code) }
        view.post { contacts.close(); tone.close(); http?.close(); location?.close(); images?.close(); onFailure(view, code) }
    }
    fun auditBlock(code: String, category: String = "policy") {
        if (active.get() && reportedBlocks.add("$code:$category"))
            store.log("runtime", code, module, "Blocked category=$category; URL/payload omitted")
    }
    with(view.settings) {
        if (module.api in setOf("0.9.0", "0.10.0")) textZoom = (context.resources.configuration.fontScale * 100).toInt().coerceIn(50, 300)
        javaScriptEnabled = true
        domStorageEnabled = false
        allowFileAccess = false
        allowContentAccess = false
        blockNetworkLoads = true
        mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
        javaScriptCanOpenWindowsAutomatically = false
        setSupportMultipleWindows(true) // onCreateWindow defaults to rejecting every popup.
        mediaPlaybackRequiresUserGesture = true
        cacheMode = WebSettings.LOAD_NO_CACHE
        setGeolocationEnabled(false)
    }
    android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(view, false)
    view.setDownloadListener { _, _, _, _, _ -> store.log("runtime", "DOWNLOAD_BLOCKED", module) }
    view.webViewClient = object : WebViewClient() {
        override fun shouldOverrideUrlLoading(webView: WebView, request: WebResourceRequest): Boolean {
            val deny = !request.isForMainFrame || request.url.toString() != entry
            if (deny) auditBlock("NAVIGATION_BLOCKED")
            return deny
        }

        override fun shouldInterceptRequest(webView: WebView, request: WebResourceRequest): WebResourceResponse {
            if (!active.get()) return blocked()
            fun reject(category: String): WebResourceResponse {
                auditBlock("REQUEST_BLOCKED", category)
                return blocked()
            }
            // Android intercepts data: resources too. Keep this local raster path
            // bounded; returning null here would bypass our byte/format policy.
            if (request.url.scheme == "data") {
                if (module.api !in setOf("0.9.0", "0.10.0") || request.isForMainFrame || request.method != "GET") return reject("inline-image-context")
                val raster = runCatching { ModuleImages.dataUrl(request.url.toString()) }.getOrNull()
                    ?: return reject("inline-image-format")
                return WebResourceResponse(raster.first, null, 200, "OK",
                    mapOf("X-Content-Type-Options" to "nosniff", "Cache-Control" to "no-store"), ByteArrayInputStream(raster.second))
            }
            if (!local(request.url)) return reject("external-origin")
            if (request.method != "GET") return reject("method")
            val path = request.url.path?.removePrefix("/") ?: return reject("path")
            if (path.startsWith("construct-images/")) {
                if (request.isForMainFrame || request.url.query != null) return reject("image-context")
                val bytes = runCatching { images?.resource(path) }.getOrNull() ?: return reject("image-authority")
                val stream = object : ByteArrayInputStream(bytes) {
                    private fun checkStream() {
                        try { checkRule(images?.resource(path) != null, "IMAGE_STALE", "Image expired") }
                        catch (_: Exception) { throw java.io.IOException("Image unavailable") }
                    }
                    override fun read(): Int { checkStream(); return super.read() }
                    override fun read(buffer: ByteArray, offset: Int, count: Int): Int {
                        checkStream(); return super.read(buffer, offset, count)
                    }
                }
                return WebResourceResponse("image/png", null, 200, "OK", mapOf(
                    "X-Content-Type-Options" to "nosniff", "Cache-Control" to "no-store"), stream)
            }
            if (!Packages.safePath(path)) return reject("path")
            if (module.api in setOf("0.6.0", "0.7.0", "0.8.0", "0.9.0", "0.10.0") && path == "construct-host.css") {
                return WebResourceResponse("text/css", "UTF-8", 200, "OK",
                    mapOf("X-Content-Type-Options" to "nosniff", "Cache-Control" to "no-store"),
                    ByteArrayInputStream(ModuleLayout.css.toByteArray()))
            }
            val file = File(root, path)
            if (!file.canonicalPath.startsWith(root.canonicalPath + File.separator)) return reject("path")
            if (!file.isFile) return reject("missing-resource")
            val type = when (file.extension) {
                "html" -> "text/html"
                "js" -> "application/javascript"
                "css" -> "text/css"
                "json" -> "application/json"
                "png" -> "image/png"
                "jpg", "jpeg" -> "image/jpeg"
                "webp" -> "image/webp"
                "woff2" -> "font/woff2"
                else -> "text/plain"
            }
            val headers = mapOf(
                "Content-Security-Policy" to "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
                "X-Content-Type-Options" to "nosniff", "Cache-Control" to "no-store",
                "Referrer-Policy" to "no-referrer")
            return WebResourceResponse(type, "UTF-8", 200, "OK", headers, file.inputStream())
        }

        override fun onPageStarted(webView: WebView, url: String?, favicon: Bitmap?) {
            if (url != entry) { webView.stopLoading(); fail("NAVIGATION_BLOCKED") }
        }
        override fun onReceivedError(webView: WebView, request: WebResourceRequest, error: android.webkit.WebResourceError) {
            if (request.isForMainFrame) fail("PAGE_LOAD_FAILED")
        }
        override fun onRenderProcessGone(webView: WebView, detail: RenderProcessGoneDetail): Boolean {
            fail("RENDERER_STOPPED")
            return true
        }
    }
    view.webChromeClient = moduleChromeClient({ fail("JAVASCRIPT_ERROR") }, { auditBlock("POPUP_BLOCKED") })
    WebViewCompat.addWebMessageListener(view, "construct", setOf(origin)) { _, message, sourceOrigin, isMainFrame, reply ->
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return@addWebMessageListener
        if (!active.get() || !isMainFrame || sourceOrigin.toString() != origin) return@addWebMessageListener
        var requestId = ""
        try {
            val now = android.os.SystemClock.elapsedRealtime()
            if (now - window >= 1000) { window = now; calls = 0 }
            // Drop excess traffic instead of generating another unbounded reply/log stream.
            if (++calls > 30) return@addWebMessageListener
            val raw = message.data ?: ""
            checkRule(raw.length <= 8192, "BRIDGE_SIZE", "Bridge request is too large")
            val request = JSONObject(raw)
            requestId = request.getString("id")
            checkRule(Regex("[A-Za-z0-9_-]{1,64}").matches(requestId), "BRIDGE_ID", "Invalid request identifier")
            val method = request.getString("method")
            val params = request.getJSONObject("params")
            view.gate.authorize(method)
            if (method == "net.http" || method == "location.read") {
                authorizeCapability(method)
                val id = requestId; val generation = view.gate.generation.get()
                val complete: (JSONObject?, ConstructError?) -> Unit = { value, error ->
                    view.post {
                        if (active.get()) {
                            val response = JSONObject().put("id", id)
                            val denied = try { view.gate.authorizeReply(generation); authorizeCapability(method); error } catch (e: ConstructError) { e }
                            if (denied == null) response.put("result", value)
                            else response.put("error", JSONObject().put("code", denied.code).put("message", denied.message))
                            reply.postMessage(response.toString())
                        }
                    }
                }
                if (method == "net.http") http!!.get(params, complete) else location!!.get(params, complete)
                return@addWebMessageListener
            }
            if (method == "image.read" || method == "image.markers") {
                authorizeCapability(method)
                val id = requestId; val generation = view.gate.generation.get()
                val picking = method == "image.read" && params.optString("op") == "pick"
                val session = images ?: throw ConstructError("CAPABILITY_DENIED", "Declare image.read before using images")
                session.request(method, params) { value, error ->
                    val deliveredGeneration = view.gate.generation.get()
                    view.post {
                        if (active.get()) {
                            val response = JSONObject().put("id", id)
                            val denied = try {
                                // Only the tracked system-picker handoff may cross a pause;
                                // its session token, current digest and grant are rechecked.
                                view.gate.authorizeReply(if (picking) deliveredGeneration else generation)
                                authorizeCapability(method); authorizeCapability("image.read"); error
                            } catch (e: ConstructError) { e }
                            if (denied == null) response.put("result", value)
                            else response.put("error", JSONObject().put("code", denied.code).put("message", denied.message))
                            reply.postMessage(response.toString())
                        }
                    }
                }
                return@addWebMessageListener
            }
            if (method == "contacts.read") {
                val id = requestId
                val generation = view.gate.generation.get()
                contacts.request(params) { value, error ->
                    if (active.get()) {
                        val response = JSONObject().put("id", id)
                        val denied = try { view.gate.authorizeReply(generation); error } catch (e: ConstructError) { e }
                        if (denied == null) response.put("result", value)
                        else response.put("error", JSONObject().put("code", denied.code).put("message", denied.message))
                        reply.postMessage(response.toString())
                    }
                }
                return@addWebMessageListener
            }
            val result: Any = store.withCapability(installed, method) { when (method) {
                "device.toast" -> {
                    checkRule(now - lastToast >= 1500, "RATE_LIMIT", "Please wait before showing another toast")
                    val text = params.getString("message")
                    checkRule(text.length in 1..200, "INVALID_PARAMS", "Toast must contain 1–200 characters")
                    Toast.makeText(context, text, Toast.LENGTH_SHORT).show()
                    lastToast = now
                    JSONObject.NULL
                }
                "log.write" -> {
                    val level = params.getString("level")
                    checkRule(level in setOf("info", "warn", "error"), "INVALID_PARAMS", "Invalid log level")
                    store.log("module", "MODULE_${level.uppercase()}", module, params.getString("message"))
                    JSONObject.NULL
                }
                "storage.kv" -> store.storage(module.id, params)
                "device.tone" -> tone.play(params)
                "camera.capture" -> { CameraActivity.open(context, store, installed, params); JSONObject().put("opened", true) }
                else -> throw ConstructError("CAPABILITY_DENIED", "Unsupported capability")
            }
            }
            reply.postMessage(JSONObject().put("id", requestId).put("result", result).toString())
        } catch (error: Exception) {
            val code = (error as? ConstructError)?.code ?: "INVALID_REQUEST"
            val description = (error as? ConstructError)?.message ?: "Invalid capability request"
            reply.postMessage(JSONObject().put("id", requestId).put("error", JSONObject()
                .put("code", code).put("message", description)).toString())
        }
    }
    view.loadUrl(entry)
    store.log("runtime", "MODULE_OPENED", module)
    return view
}
