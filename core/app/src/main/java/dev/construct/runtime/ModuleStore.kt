package dev.construct.runtime

import android.content.Context
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.net.URI
import javax.net.ssl.HttpsURLConnection

data class Installed(val manifest: ModuleManifest, val digest: String, val previous: String?,
    val confirmed: Boolean, val enabled: Boolean, val failureCode: String? = null, val granted: Set<String> = emptySet())
data class DamagedModule(val id: String, val code: String, val previousVersion: String?)
data class Inventory(val modules: List<Installed>, val damaged: List<DamagedModule>, val indexError: String? = null)

// A deployment supplies the initial choice, never a replacement for a saved choice.
internal fun initialRegistry(saved: String?, configured: String): String =
    saved ?: configured.takeIf { it.isNotBlank() } ?: "demo"

class ModuleStore(private val context: Context) {
    companion object {
        @Volatile private var instance: ModuleStore? = null
        fun shared(context: Context): ModuleStore = instance ?: synchronized(this) {
            instance ?: ModuleStore(context.applicationContext).also { instance = it }
        }
    }
    private val root = File(context.filesDir, "modules").apply { mkdirs() }
    private val stateFile = AtomicFile(File(context.filesDir, "module-state.json"))
    private val logsFile = AtomicFile(File(context.filesDir, "diagnostics.jsonl"))
    private val moduleLogsFile = AtomicFile(File(context.filesDir, "diagnostics-modules.jsonl"))
    private val logWindows = mutableMapOf<String, Pair<Long, Int>>()
    private val failedRuns = mutableSetOf<Pair<String, String>>()
    private val preferences = context.getSharedPreferences("construct", Context.MODE_PRIVATE)
    val publicKey: ByteArray = context.assets.open("registry-public.der").use { it.readBytes() }

    var registry: String
        get() = initialRegistry(preferences.getString("registry", null),
            context.getString(R.string.configured_registry))
        set(value) {
            if (value != "demo") validateRegistry(value)
            preferences.edit().putString("registry", value).apply()
        }

    private fun validateRegistry(source: String): URI {
        val uri = URI(source)
        checkRule(uri.scheme == "https" && !uri.host.isNullOrEmpty() && uri.rawUserInfo == null && uri.rawQuery == null && uri.rawFragment == null && uri.path.endsWith("/index.json"),
            "REGISTRY_URL", "Use an HTTPS URL ending in /index.json, without credentials or query parameters")
        return uri
    }

    private fun fetch(source: String, artifact: String?, limit: Int): ByteArray {
        if (source == "demo") return context.assets.open("demo/${artifact ?: "index.json"}").use { it.readBytesBounded(limit) }
        val base = validateRegistry(source)
        if (artifact != null) checkRule(Packages.safePath(artifact), "ARTIFACT_PATH", "Invalid artifact path")
        val target = if (artifact == null) base else base.resolve(artifact)
        val connection = target.toURL().openConnection() as HttpsURLConnection
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 10000
        connection.readTimeout = 15000
        try {
            checkRule(connection.responseCode == 200, "REGISTRY_HTTP", "Registry did not return a successful response")
            checkRule(connection.contentLengthLong <= limit, "SIZE_LIMIT", "Download exceeds size limit")
            return connection.inputStream.use { it.readBytesBounded(limit) }
        } catch (_: javax.net.ssl.SSLException) {
            throw ConstructError("REGISTRY_TLS", "Registry certificate could not be verified. Check the endpoint and host app version.")
        } catch (_: java.net.SocketTimeoutException) {
            throw ConstructError("REGISTRY_TIMEOUT", "Registry timed out. Installed modules are still available offline.")
        } catch (_: java.io.IOException) {
            throw ConstructError("REGISTRY_NETWORK", "Registry is unreachable. Check Wi-Fi; installed modules are still available offline.")
        } finally { connection.disconnect() }
    }

    fun catalog(source: String): List<CatalogVersion> {
        val result = Packages.catalog(fetch(source, null, 512 * 1024))
        log("catalog", "CATALOG_READY", message = "${result.size} versions available (${if (source == "demo") "bundled" else "HTTPS"})")
        return result
    }

    fun prepare(source: String, version: CatalogVersion): VerifiedPackage =
        Packages.verify(fetch(source, version.artifact, Packages.MAX_ZIP), version, publicKey)

    private fun readState(): JSONObject = if (stateFile.baseFile.exists() || File(stateFile.baseFile.path + ".bak").exists())
        JSONObject(stateFile.openRead().use { it.readBytesBounded(512 * 1024).toString(Charsets.UTF_8) }) else JSONObject()

    private fun syncDirectory(directory: File) {
        java.nio.channels.FileChannel.open(directory.toPath(), java.nio.file.StandardOpenOption.READ).use { it.force(true) }
    }

    private fun writeAtomic(target: AtomicFile, text: String) {
        val stream = target.startWrite()
        try { stream.write(text.toByteArray()); target.finishWrite(stream) }
        catch (error: Exception) { target.failWrite(stream); throw error }
        syncDirectory(target.baseFile.parentFile!!)
    }

    fun directory(digest: String): File {
        checkRule(Regex("[a-f0-9]{64}").matches(digest), "STATE_INVALID", "Invalid installed package reference")
        return File(root, digest)
    }

    private fun hash(bytes: ByteArray) = java.security.MessageDigest.getInstance("SHA-256")
        .digest(bytes).joinToString("") { "%02x".format(it) }

    private fun fileHashes(files: Map<String, ByteArray>) = JSONObject().apply {
        files.forEach { (path, bytes) -> put(path, hash(bytes)) }
    }

    private fun verifiedInstalled(id: String, digest: String): ModuleManifest {
        val dir = directory(digest)
        checkRule(dir.isDirectory, "PACKAGE_MISSING", "Installed package is missing")
        val index = File(dir, ".files.json")
        val expected = if (index.isFile) {
            JSONObject(index.inputStream().use { it.readBytesBounded(32768).toString(Charsets.UTF_8) })
        } else {
            // Alpha 1 had no per-file integrity record. Only migrate by comparison
            // with an independently verified bundled artifact, never by trusting disk bytes.
            val version = Packages.catalog(context.assets.open("demo/index.json").use { it.readBytes() })
                .firstOrNull { it.id == id && it.sha256 == digest }
                ?: throw ConstructError("INTEGRITY_MISSING", "Installed integrity record is missing; remove and reinstall")
            fileHashes(prepare("demo", version).files)
        }
        val names = expected.keys().asSequence().toSet()
        checkRule(names.size in 1..128 && names.all { Packages.safePath(it) }, "PACKAGE_CORRUPT", "Invalid installed file index")
        val actual = dir.walkTopDown().filter { it.isFile }.map { it.relativeTo(dir).invariantSeparatorsPath }
            .filter { it != ".files.json" }.toSet()
        checkRule(actual == names, "PACKAGE_CORRUPT", "Installed package files are missing or unexpected")
        var total = 0
        for (name in names) {
            val file = File(dir, name)
            checkRule(file.canonicalPath.startsWith(dir.canonicalPath + File.separator), "PACKAGE_CORRUPT", "Invalid installed path")
            val bytes = file.inputStream().use { it.readBytesBounded(Packages.MAX_FILE) }
            total += bytes.size
            checkRule(total <= Packages.MAX_EXPANDED && hash(bytes) == expected.getString(name), "PACKAGE_CORRUPT", "Installed file integrity check failed")
        }
        val m = Packages.manifest(File(dir, "manifest.json").readBytes())
        checkRule(m.id == id && File(dir, m.entry).isFile, "PACKAGE_CORRUPT", "Installed identity or entry is inconsistent")
        return m
    }

    private fun retainedHttpOrigins(record: JSONObject?, manifest: ModuleManifest?): Set<String> {
        val declared = manifest?.capabilities?.firstOrNull { it.id == "net.http" }?.origins.orEmpty().toSet()
        val raw = record?.optJSONArray("httpOrigins") ?: return emptySet()
        return (0 until raw.length()).mapNotNull { raw.opt(it) as? String }.filter { it in declared }.toSet()
    }

    private fun grants(record: JSONObject, manifest: ModuleManifest): JSONObject {
        val result = if (record.has("grants")) record.getJSONObject("grants") else JSONObject().apply {
            manifest.capabilities.forEach { put(it.id, !it.explicitOptIn) }
        }
        for (key in result.keys()) checkRule(key in Packages.supported && result.get(key) is Boolean,
            "STATE_INVALID", "Invalid capability grants")
        if (!HttpPolicy.approved(manifest, retainedHttpOrigins(record, manifest))) result.put("net.http", false)
        return result
    }

    @Synchronized fun setCapability(id: String, capability: String, allowed: Boolean) {
        val state = readState()
        val record = state.getJSONObject(id)
        val manifest = verifiedInstalled(id, record.getString("active"))
        checkRule(manifest.capabilities.any { it.id == capability }, "CAPABILITY_DENIED", "Capability is not declared")
        record.put("grants", grants(record, manifest).put(capability, allowed))
        if (capability == "net.http" && allowed) record.put("httpOrigins", org.json.JSONArray(manifest.capabilities.first { it.id == capability }.origins))
        writeAtomic(stateFile, state.toString())
        log("access", if (allowed) "CAPABILITY_GRANTED" else "CAPABILITY_REVOKED", manifest, capability)
    }

    @Synchronized fun <T> withCapability(module: Installed, capability: String, action: () -> T): T {
        val record = readState().optJSONObject(module.manifest.id)
        checkRule(record != null && record.optString("active") == module.digest && record.optBoolean("enabled") &&
            record.optString("failureCode").isEmpty() && (module.manifest.id to module.digest) !in failedRuns,
            "RUN_STALE", "Module is no longer running; reopen it")
        checkRule(module.manifest.capabilities.any { it.id == capability } && grants(record!!, module.manifest).optBoolean(capability),
            "CAPABILITY_DENIED", "Access is off. Enable it in Module access.")
        return action()
    }

    @Synchronized fun inventory(): Inventory {
        val state = try { readState() } catch (_: Exception) { return Inventory(emptyList(), emptyList(), "STATE_UNREADABLE") }
        val modules = mutableListOf<Installed>()
        val damaged = mutableListOf<DamagedModule>()
        for (id in state.keys().asSequence().toList().sorted()) {
            try {
                val record = state.getJSONObject(id)
                val digest = record.getString("active")
                val m = verifiedInstalled(id, digest)
                val previous = record.optString("previous").takeIf { Regex("[a-f0-9]{64}").matches(it) }
                modules.add(Installed(m, digest, previous, record.getBoolean("confirmed"), record.getBoolean("enabled"),
                    record.optString("failureCode").takeIf { it.isNotEmpty() },
                    m.capabilities.map { it.id }.filter { grants(record, m).optBoolean(it) }.toSet()))
            } catch (error: Exception) {
                val record = state.optJSONObject(id)
                val previous = record?.optString("previous")?.let { runCatching { verifiedInstalled(id, it).version }.getOrNull() }
                damaged.add(DamagedModule(id, (error as? ConstructError)?.code ?: "STATE_INVALID", previous))
            }
        }
        return Inventory(modules, damaged)
    }

    @Synchronized fun installed(): List<Installed> = inventory().modules

    @Synchronized fun install(candidate: VerifiedPackage, consentChanges: Map<String, Boolean> = emptyMap()) {
        checkRule(consentChanges.keys.all { id -> candidate.manifest.capabilities.any { it.id == id } },
            "CAPABILITY_DENIED", "Consent may only change declared capabilities")
        val state = readState()
        val id = candidate.manifest.id
        val old = state.optJSONObject(id)
        checkRule(!state.has(id) || inventory().damaged.none { it.id == id }, "NEEDS_REPAIR", "Restore or remove this damaged module before reinstalling")
        checkRule(old == null || old.getBoolean("confirmed"), "TRIAL_PENDING", "Keep or roll back the current trial before another update")
        checkRule(old?.getString("active") != candidate.digest, "ALREADY_INSTALLED", "This exact package is already installed")
        val destination = directory(candidate.digest)
        if (!destination.exists()) {
            val staging = File(root, "staging-${java.util.UUID.randomUUID()}")
            staging.mkdirs()
            try {
                for ((path, bytes) in candidate.files) {
                    val file = File(staging, path)
                    file.parentFile!!.mkdirs()
                    java.io.FileOutputStream(file).use { stream -> stream.write(bytes); stream.fd.sync() }
                }
                val index = File(staging, ".files.json")
                java.io.FileOutputStream(index).use { stream -> stream.write(fileHashes(candidate.files).toString().toByteArray()); stream.fd.sync() }
                staging.walkBottomUp().filter { it.isDirectory }.forEach { syncDirectory(it) }
                checkRule(staging.renameTo(destination), "INSTALL_IO", "Could not stage module package")
                syncDirectory(root)
            } finally { if (staging.exists()) staging.deleteRecursively() }
        }
        verifiedInstalled(id, candidate.digest)
        val oldManifest = old?.let { verifiedInstalled(id, it.getString("active")) }
        val approved = if (old == null) JSONObject() else grants(old, oldManifest!!)
        candidate.manifest.capabilities.forEach { if (!approved.has(it.id)) approved.put(it.id, !it.explicitOptIn) }
        // Older hosts could retain origins absent from the active manifest.
        val previousOrigins = retainedHttpOrigins(old, oldManifest)
        if (!HttpPolicy.approved(candidate.manifest, previousOrigins)) approved.put("net.http", false)
        consentChanges.forEach { (capability, allowed) -> approved.put(capability, allowed) }
        val http = candidate.manifest.capabilities.firstOrNull { it.id == "net.http" }
        val httpOrigins = when {
            http == null -> emptyList()
            consentChanges["net.http"] == true -> http.origins
            else -> http.origins.filter { it in previousOrigins }
        }
        state.put(id, JSONObject().put("httpOrigins", org.json.JSONArray(httpOrigins)).put("grants", approved).put("active", candidate.digest)
            .put("previous", old?.getString("active") ?: JSONObject.NULL)
            .put("confirmed", false).put("enabled", true))
        writeAtomic(stateFile, state.toString())
        log("install", "INSTALLED_TRIAL", candidate.manifest, "Installed; waiting for you to mark it working")
        collectUnused(state)
    }

    @Synchronized fun confirm(id: String) {
        val state = readState()
        val record = state.getJSONObject(id)
        checkRule((id to record.getString("active")) !in failedRuns, "RUNTIME_FAILED", "This run failed; retry before marking it working")
        checkRule(record.optString("failureCode").isEmpty(), "RUNTIME_FAILED", "This run failed; retry successfully or restore the previous version")
        verifiedInstalled(id, record.getString("active"))
        state.getJSONObject(id).put("confirmed", true)
        writeAtomic(stateFile, state.toString())
        log("confirm", "VERSION_KEPT", installed().first { it.manifest.id == id }.manifest)
    }

    @Synchronized fun rollback(id: String) {
        val state = readState()
        val record = state.getJSONObject(id)
        checkRule(!record.isNull("previous"), "NO_ROLLBACK", "There is no previous working version yet")
        val previous = record.getString("previous")
        val m = verifiedInstalled(id, previous)
        val current = runCatching { verifiedInstalled(id, record.getString("active")) }.getOrNull()
        // Rollback may retain or narrow consent, never resurrect removed origins.
        // An unverifiable active declaration fails closed without blocking repair.
        val previousOrigins = retainedHttpOrigins(record, current)
        val restoredOrigins = m.capabilities.firstOrNull { it.id == "net.http" }?.origins.orEmpty()
        record.put("httpOrigins", org.json.JSONArray(restoredOrigins.filter { it in previousOrigins }))
        record.put("grants", grants(record, m))
        record.put("active", previous).put("previous", JSONObject.NULL).put("confirmed", true).put("enabled", true)
        record.remove("failureCode")
        writeAtomic(stateFile, state.toString())
        log("rollback", "ROLLED_BACK", m, "Code restored; module data retained")
        collectUnused(state)
    }

    @Synchronized fun enable(id: String, enabled: Boolean) {
        val state = readState()
        state.getJSONObject(id).put("enabled", enabled)
        writeAtomic(stateFile, state.toString())
    }

    @Synchronized fun beginRun(module: Installed) {
        val state = readState()
        val record = state.getJSONObject(module.manifest.id)
        checkRule(record.getString("active") == module.digest && record.getBoolean("enabled"), "RUN_STALE", "Module changed or is disabled; reopen it from Installed")
        verifiedInstalled(module.manifest.id, module.digest)
        record.remove("failureCode")
        writeAtomic(stateFile, state.toString())
        failedRuns.remove(module.manifest.id to module.digest)
    }

    @Synchronized fun runtimeFailed(module: Installed, code: String) {
        failedRuns.add(module.manifest.id to module.digest)
        val state = readState()
        val record = state.optJSONObject(module.manifest.id) ?: return
        if (record.optString("active") != module.digest) return
        record.put("failureCode", code).put("confirmed", false)
        writeAtomic(stateFile, state.toString())
        log("runtime", code, module.manifest, "Module stopped; retry, restore previous code, or remove")
    }

    @Synchronized fun remove(id: String) {
        val state = readState()
        checkRule(state.has(id), "NOT_INSTALLED", "Module is not installed")
        state.remove(id)
        writeAtomic(stateFile, state.toString())
        log("remove", "MODULE_REMOVED", message = "Module registration/code removed; stored module data retained")
        collectUnused(state)
    }

    @Synchronized fun resetUnreadableIndex() {
        checkRule(inventory().indexError != null, "INDEX_READABLE", "The index is readable; remove individual modules instead")
        val recovery = File(context.filesDir, "state-recovery-${java.util.UUID.randomUUID()}.json")
        stateFile.openRead().use { input -> java.io.FileOutputStream(recovery).use { output -> input.copyTo(output); output.fd.sync() } }
        syncDirectory(context.filesDir)
        writeAtomic(stateFile, "{}")
        // The confirmed reset forgets installed code, including corrupt orphan
        // directories that would otherwise prevent reinstalling the same digest.
        // KV lives outside root and is deliberately retained.
        collectUnused(JSONObject())
        log("repair", "INDEX_RESET", message = "Unreadable index archived; reinstall modules. Module data retained.")
    }

    @Synchronized fun discardFirstTrial(id: String) {
        val state = readState()
        val record = state.getJSONObject(id)
        checkRule(!record.getBoolean("confirmed") && record.isNull("previous"), "NOT_FIRST_TRIAL", "Use rollback for an update trial")
        state.remove(id)
        writeAtomic(stateFile, state.toString())
        log("discard", "FIRST_TRIAL_DISCARDED", message = "Unverified module code removed; stored data retained")
        collectUnused(state)
    }

    private fun collectUnused(state: JSONObject) {
        val retained = mutableSetOf<String>()
        for (id in state.keys()) {
            // A malformed record has unknown references. Do not garbage-collect
            // anything until the user explicitly removes that record.
            val record = state.optJSONObject(id) ?: return
            if (record.opt("active") !is String) return
            retained.add(record.getString("active"))
            if (!record.isNull("previous")) {
                if (record.opt("previous") !is String) return
                retained.add(record.getString("previous"))
            }
        }
        root.listFiles()?.filter { it.name !in retained }?.forEach { it.deleteRecursively() }
    }

    @Synchronized fun storage(id: String, params: JSONObject): Any {
        val file = AtomicFile(File(context.filesDir, "kv-$id.json"))
        val state = if (file.baseFile.exists() || File(file.baseFile.path + ".bak").exists()) JSONObject(file.openRead().use { it.readBytes().toString(Charsets.UTF_8) }) else JSONObject()
        val key = params.getString("key")
        checkRule(Regex("[A-Za-z0-9_.-]{1,80}").matches(key), "STORAGE_KEY", "Invalid storage key")
        return when (params.getString("op")) {
            "get" -> state.opt(key) ?: JSONObject.NULL
            "set" -> {
                state.put(key, params.get("value"))
                val serialized = state.toString()
                checkRule(serialized.toByteArray().size <= 64 * 1024 && state.length() <= 100, "STORAGE_QUOTA", "Module storage quota reached")
                writeAtomic(file, serialized)
                JSONObject.NULL
            }
            else -> throw ConstructError("STORAGE_OP", "Unsupported storage operation")
        }
    }

    @Synchronized fun log(phase: String, code: String, module: ModuleManifest? = null, message: String = "") {
        // Diagnostics must not turn a successfully committed install into a reported failure.
        runCatching {
        val moduleWritten = phase == "module"
        if (moduleWritten) {
            val key = module?.id ?: "unknown"
            val now = android.os.SystemClock.elapsedRealtime()
            val old = logWindows[key]
            val window = if (old == null || now - old.first >= 5000) now to 0 else old
            if (window.second >= 10) return
            logWindows[key] = window.first to window.second + 1
        }
        val artifact = runCatching { readState().optJSONObject(module?.id ?: "") }.getOrNull()
        val record = JSONObject().put("time", java.time.Instant.now().toString())
            .put("hostVersion", BuildConfig.VERSION_NAME).put("phase", phase).put("code", code)
            .put("moduleId", module?.id ?: JSONObject.NULL).put("moduleVersion", module?.version ?: JSONObject.NULL)
            .put("message", message.take(500))
            .put("source", if (moduleWritten) "module" else "host")
            .put("packageDigest", artifact?.opt("active") ?: JSONObject.NULL)
            .put("previousDigest", artifact?.opt("previous") ?: JSONObject.NULL)
        val target = if (moduleWritten) moduleLogsFile else logsFile
        val lines = (readLog(target).lineSequence().filter { it.isNotBlank() }.toList() + record.toString()).takeLast(120)
        // A bounded, local ring. Never automatically uploaded.
        writeAtomic(target, lines.joinToString("\n", postfix = "\n"))
        }
    }

    private fun readLog(file: AtomicFile): String = if (file.baseFile.exists() || File(file.baseFile.path + ".bak").exists())
        file.openRead().bufferedReader().use { it.readText() } else ""

    /** Export-only metadata, separate from stored runtime events and human observations. */
    fun diagnosticReport(): String {
        val apkHash = runCatching {
            val digest = java.security.MessageDigest.getInstance("SHA-256")
            File(context.applicationInfo.sourceDir).inputStream().use { input ->
                val buffer = ByteArray(8192)
                while (true) { val count = input.read(buffer); if (count < 0) break; digest.update(buffer, 0, count) }
            }
            digest.digest().joinToString("") { "%02x".format(it) }
        }.getOrNull()
        val webview = runCatching { android.webkit.WebView.getCurrentWebViewPackage() }.getOrNull()
        val environment = JSONObject().put("time", java.time.Instant.now().toString())
            .put("source", "host").put("phase", "report").put("code", "ENVIRONMENT")
            .put("hostVersion", BuildConfig.VERSION_NAME).put("versionCode", BuildConfig.VERSION_CODE)
            .put("apkSha256", apkHash ?: JSONObject.NULL)
            .put("deviceModel", android.os.Build.MODEL).put("manufacturer", android.os.Build.MANUFACTURER)
            .put("androidVersion", android.os.Build.VERSION.RELEASE).put("sdk", android.os.Build.VERSION.SDK_INT)
            .put("webviewPackage", webview?.packageName ?: JSONObject.NULL)
            .put("webviewVersion", webview?.versionName ?: JSONObject.NULL)
            .put("message", "Environment metadata only; physical audibility requires a human observation")
        return diagnostics() + environment.toString() + "\n"
    }

    @Synchronized fun diagnostics(): String = listOf(readLog(logsFile), readLog(moduleLogsFile))
        .flatMap { it.lineSequence().filter { line -> line.isNotBlank() }.toList() }
        .sortedBy { runCatching { JSONObject(it).optString("time") }.getOrDefault("") }.joinToString("\n", postfix = "\n")
}
