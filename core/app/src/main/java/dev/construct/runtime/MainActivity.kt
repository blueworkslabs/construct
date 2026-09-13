package dev.construct.runtime

import android.content.ClipData
import android.content.ClipboardManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.contentDescription
import java.util.concurrent.Executors

class MainActivity : ComponentActivity() {
    private val worker = Executors.newSingleThreadExecutor()
    private lateinit var store: ModuleStore

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        android.webkit.CookieManager.getInstance().setAcceptCookie(false)
        store = ModuleStore.shared(this)
        setContent { MaterialTheme(colorScheme = darkColorScheme()) { ConstructApp() } }
    }

    override fun onDestroy() { worker.shutdown(); super.onDestroy() }

    @Composable private fun ConstructApp() {
        var modules by remember { mutableStateOf(emptyList<Installed>()) }
        var damaged by remember { mutableStateOf(emptyList<DamagedModule>()) }
        var indexError by remember { mutableStateOf<String?>(null) }
        var catalog by remember { mutableStateOf(emptyList<CatalogVersion>()) }
        var catalogSource by remember { mutableStateOf("demo") }
        var source by remember { mutableStateOf(store.registry) }
        var status by remember { mutableStateOf("Choose a catalog, then install a module.") }
        var busy by remember { mutableStateOf(false) }
        var candidate by remember { mutableStateOf<VerifiedPackage?>(null) }
        var revokeTarget by remember { mutableStateOf<Pair<String, Capability>?>(null) }
        var accessModuleId by remember { mutableStateOf<String?>(null) }
        var showLogs by remember { mutableStateOf(false) }
        var logs by remember { mutableStateOf("") }
        var rollbackTarget by remember { mutableStateOf<String?>(null) }
        var discardTarget by remember { mutableStateOf<Installed?>(null) }
        var removeTarget by remember { mutableStateOf<String?>(null) }
        var resetIndex by remember { mutableStateOf(false) }

        var deletePhotosId by remember { mutableStateOf<String?>(null) }
        var androidCamera by remember { mutableStateOf(CameraActivity.hasPermission(this)) }
        val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
            androidCamera = allowed
            status = if (allowed) "Android camera access allowed. Module grants are separate." else "Android camera access denied. Retry or use Android app settings."
        }
        var androidContacts by remember { mutableStateOf(ContactsReader.hasPermission(this)) }
        val contactsPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
            androidContacts = allowed
            status = if (allowed) "Android contacts access allowed. Module grants are separate." else "Android contacts access denied. You can retry or change it in Android app settings."
        }

        fun report(error: Exception) {
            val code = (error as? ConstructError)?.code ?: "OPERATION_FAILED"
            status = "[$code] " + ((error as? ConstructError)?.message ?: "Operation failed. Check connectivity and diagnostics, then retry.")
            runCatching { store.log("host", code, message = status) }
        }
        fun work(refresh: Boolean = true, task: () -> (() -> Unit)) {
            if (busy) return
            busy = true
            worker.execute {
                try {
                    val complete = task()
                    val refreshed = if (refresh) store.inventory() else null
                    runOnUiThread { if (!isDestroyed) {
                        if (refreshed != null) { modules = refreshed.modules; damaged = refreshed.damaged; indexError = refreshed.indexError }
                        complete(); busy = false
                    } }
                } catch (error: Exception) {
                    val refreshed = store.inventory()
                    runOnUiThread { if (!isDestroyed) {
                        modules = refreshed.modules; damaged = refreshed.damaged; indexError = refreshed.indexError
                        report(error); busy = false
                    } }
                }
            }
        }
        val moduleLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            val data = result.data
            val action = data?.getStringExtra("action") ?: "close"
            val id = data?.getStringExtra("module")
            val digest = data?.getStringExtra("digest")
            val code = data?.getStringExtra("error")
            work {
                if (action == "confirm") {
                    val current = store.inventory().modules.firstOrNull { it.manifest.id == id }
                    checkRule(current != null && current.digest == digest, "RUN_STALE", "Module changed; reopen it before marking working")
                    store.confirm(id!!)
                }
                val reportText = if (action == "diagnostics") store.diagnosticReport() else null;
                {
                    accessModuleId = if (action == "access") id else null
                    showLogs = reportText != null
                    if (reportText != null) logs = reportText
                    status = when {
                        code != null -> "[$code] Module stopped. Retry, remove, or restore previous code from Installed."
                        action == "confirm" -> "Marked working. You can now install an update."
                        else -> "Module stopped."
                    }
                }
            }
        }
        DisposableEffect(lifecycle) {
            val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
                if (event == androidx.lifecycle.Lifecycle.Event.ON_RESUME) {
                    androidContacts = ContactsReader.hasPermission(this@MainActivity)
                    androidCamera = CameraActivity.hasPermission(this@MainActivity)
                }
            }
            lifecycle.addObserver(observer)
            onDispose { lifecycle.removeObserver(observer) }
        }
        LaunchedEffect(Unit) { work { val result = store.catalog(source); { catalog = result; catalogSource = source; status = "Catalog ready. Choose a module below." } } }
        BackHandler(showLogs || accessModuleId != null) {
            showLogs = false; accessModuleId = null
        }

        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding().padding(16.dp)) {
                Text("Construct", style = MaterialTheme.typography.headlineLarge)
                Text("Your private module workshop · ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(12.dp))
                Text(status, color = MaterialTheme.colorScheme.primary)
                if (busy) LinearProgressIndicator(Modifier.fillMaxWidth().padding(vertical = 8.dp))
                if (accessModuleId != null) {
                    Column(Modifier.verticalScroll(rememberScrollState())) {
                        TextButton(enabled = !busy, onClick = { accessModuleId = null }) { Text("Back") }
                        Text("Module access", style = MaterialTheme.typography.titleLarge)
                        Text("The module is stopped. Changes apply immediately and survive updates and rollback.")
                        modules.firstOrNull { it.manifest.id == accessModuleId }?.let { module ->
                            Text(module.manifest.name)
                            for (cap in module.manifest.capabilities) {
                                val label = cap.label
                                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                                    Text(label, Modifier.weight(1f))
                                    Switch(checked = cap.id in module.granted, enabled = !busy,
                                        modifier = Modifier.semantics { contentDescription = label },
                                        onCheckedChange = { allowed ->
                                            if (!allowed && !cap.optional) revokeTarget = module.manifest.id to cap
                                            else work {
                                                store.setCapability(module.manifest.id, cap.id, allowed);
                                                { status = if (allowed) "$label: on." else "$label: off." }
                                            }
                                        })
                                }
                                Text(if (cap.optional) "Optional" else "Required for this module", style = MaterialTheme.typography.labelMedium)
                                Text(cap.id, style = MaterialTheme.typography.bodySmall)
                                Text(cap.reason, style = MaterialTheme.typography.bodySmall)
                            }
                            if (module.manifest.capabilities.any { it.id == "contacts.read" }) {
                                Text("Android contacts access: " + if (androidContacts) "allowed" else "not allowed")
                                Text("Android permission is app-wide. Only modules you separately allow can use the host contacts API. Reading exposes names, phone numbers and email addresses; no editing.")
                                Button(enabled = !busy && !androidContacts, onClick = { contactsPermission.launch(android.Manifest.permission.READ_CONTACTS) }) { Text("Allow Android contacts access") }
                                TextButton(onClick = { startActivity(android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:$packageName"))) }) { Text("Android app settings") }
                            }
                            if (module.manifest.capabilities.any { it.id == "camera.capture" }) {
                                Text("Android camera access: " + if (androidCamera) "allowed" else "not allowed")
                                Text("Opens a visible native camera. Only you can press the shutter. Photos stay in this module's private storage; JavaScript gets no frames or photo files.")
                                Button(enabled = !busy && !androidCamera, onClick = { cameraPermission.launch(android.Manifest.permission.CAMERA) }) { Text("Allow Android camera access") }
                                TextButton(onClick = { startActivity(android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:$packageName"))) }) { Text("Android app settings") }
                                TextButton(enabled = !busy, onClick = { deletePhotosId = module.manifest.id }) { Text("Delete all saved photos") }
                                Text("Deleting saved photos works even with camera access off. Remove keeps photos; reinstall to manage retained photos.")
                            }
                            Button(enabled = !busy && module.enabled, onClick = { work {
                                store.beginRun(module);
                                { accessModuleId = null; moduleLauncher.launch(ModuleActivity.intent(this@MainActivity, module)); status = "Testing ${module.manifest.name} ${module.manifest.version}." }
                            } }) { Text("Reopen module") }
                            Text("Tones are short, use media volume and stop when you leave the module. No microphone or network access.")
                        }
                    }
                } else if (showLogs) {
                    Row {
                        TextButton(onClick = { showLogs = false }) { Text("Back") }
                        TextButton(onClick = {
                            (getSystemService(CLIPBOARD_SERVICE) as ClipboardManager).setPrimaryClip(ClipData.newPlainText("Construct diagnostics", logs))
                            status = "Diagnostics copied. Review before sharing."
                        }) { Text("Copy diagnostics") }
                    }
                    Text("Local technical report (JSON lines), including device model, Android/WebView version and APK hash. Module-written messages may contain module data; review before sharing.")
                    Text(logs.ifBlank { "No diagnostics yet." }, modifier = Modifier.verticalScroll(rememberScrollState()).weight(1f), style = MaterialTheme.typography.bodySmall)
                } else {
                    Column(Modifier.verticalScroll(rememberScrollState())) {
                        Row {
                            TextButton(enabled = !busy, onClick = { work(refresh = false) { val result = store.diagnosticReport(); { logs = result; showLogs = true } } }) { Text("Diagnostics") }
                            TextButton(enabled = !busy, onClick = { source = "demo" }) { Text("Use demo catalog") }
                        }
                        if (getString(R.string.configured_registry).isNotBlank()) {
                            TextButton(enabled = !busy, onClick = { source = getString(R.string.configured_registry) }) { Text("Use configured registry") }
                        }
                        OutlinedTextField(value = source, onValueChange = { source = it }, enabled = !busy,
                            label = { Text("Catalog: demo or HTTPS index URL") }, singleLine = true, modifier = Modifier.fillMaxWidth())
                        Button(enabled = !busy, onClick = {
                            val selected = source.trim()
                            work {
                                store.registry = selected
                                val result = store.catalog(selected);
                                { catalog = result; catalogSource = selected; source = selected; status = "Catalog refreshed." }
                            }
                        }) { Text("Refresh catalog") }
                        Text("Installed", style = MaterialTheme.typography.titleLarge)
                        if (indexError != null) {
                            Text("[$indexError] The module index cannot be read. Saved module data is untouched.")
                            TextButton(enabled = !busy, onClick = { resetIndex = true }) { Text("Repair module index") }
                        }
                        if (modules.isEmpty() && damaged.isEmpty() && indexError == null) Text("Nothing installed yet. Choose a module below.")
                        for (broken in damaged) {
                            Card(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                                Column(Modifier.padding(12.dp)) {
                                    Text(broken.id, style = MaterialTheme.typography.titleMedium)
                                    Text("Needs repair [${broken.code}]. Other modules remain usable.")
                                    if (broken.previousVersion != null) TextButton(enabled = !busy, onClick = { rollbackTarget = broken.id }) { Text("Restore ${broken.previousVersion}") }
                                    TextButton(enabled = !busy, onClick = { removeTarget = broken.id }) { Text("Remove · keep data") }
                                }
                            }
                        }
                        for (module in modules) {
                            Card(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                                Column(Modifier.padding(12.dp)) {
                                    Text("${module.manifest.name} · ${module.manifest.version}", style = MaterialTheme.typography.titleMedium)
                                    Text(module.failureCode?.let { "Failed [$it] — retry or restore previous code" }
                                        ?: if (!module.enabled) "Disabled" else if (module.confirmed) "Marked working" else "Trial — not yet marked working")
                                    Row {
                                        Button(enabled = !busy && module.enabled, onClick = { work { store.beginRun(module); { moduleLauncher.launch(ModuleActivity.intent(this@MainActivity, module)); status = "Testing ${module.manifest.name} ${module.manifest.version}." } } }) { Text(if (module.failureCode == null) "Open" else "Retry") }
                                        TextButton(enabled = !busy, onClick = { work { store.enable(module.manifest.id, !module.enabled); { status = if (module.enabled) "Module disabled." else "Module enabled." } } }) { Text(if (module.enabled) "Disable" else "Enable") }
                                        if (module.previous != null) TextButton(enabled = !busy, onClick = { rollbackTarget = module.manifest.id }) { Text("Roll back") }
                                    }
                                    TextButton(enabled = !busy, onClick = { accessModuleId = module.manifest.id }) { Text("Module access") }
                                    TextButton(enabled = !busy, onClick = { removeTarget = module.manifest.id }) { Text("Remove · keep data") }
                                    if (!module.confirmed && module.previous == null) TextButton(enabled = !busy, onClick = { discardTarget = module }) { Text("Discard trial") }
                                }
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                        Text("Available · ${if (catalogSource == "demo") "bundled demo" else "remote catalog"}", style = MaterialTheme.typography.titleLarge)
                        Text(if (catalogSource == "demo") "Demo: start with Hello 0.1.0." else "Packages download over HTTPS. Installed modules remain available offline.")
                        for (version in catalog) {
                            val current = modules.firstOrNull { it.manifest.id == version.id }
                            Card(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
                                Column(Modifier.padding(12.dp)) {
                                    Text("${version.name} · ${version.version}")
                                    if (version.testFixture) Text("Test fixture — may deliberately fail. Follow its test instructions.", color = MaterialTheme.colorScheme.error)
                                    TextButton(enabled = !busy && indexError == null && damaged.none { it.id == version.id } && (current == null || current.confirmed) && current?.digest != version.sha256,
                                        onClick = { val selectedSource = catalogSource; work { val verified = store.prepare(selectedSource, version); { candidate = verified; status = "Signature verified. Review access before installing." } } }) {
                                        Text(if (current == null) "Review & install" else "Review version")
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        revokeTarget?.let { (id, cap) ->
            AlertDialog(onDismissRequest = { revokeTarget = null }, title = { Text("Turn off required access?") },
                text = { Text("${cap.label} is required by this module. Turning it off may stop features from working. Saved data will not be deleted.") },
                confirmButton = { TextButton(onClick = {
                    revokeTarget = null
                    work { store.setCapability(id, cap.id, false); { status = "${cap.label}: off." } }
                }) { Text("Turn off") } },
                dismissButton = { TextButton(onClick = { revokeTarget = null }) { Text("Keep access") } })
        }
        if (deletePhotosId != null) AlertDialog(onDismissRequest = { deletePhotosId = null },
            title = { Text("Delete all saved photos?") },
            text = { Text("Permanently deletes this module's private photos. Its camera grant and other data are unchanged.") },
            confirmButton = { TextButton(enabled = !busy, onClick = {
                val id = deletePhotosId!!; deletePhotosId = null
                work { CameraPhotos(this@MainActivity, id).deleteAll(); { status = "Saved photos deleted." } }
            }) { Text("Delete permanently") } },
            dismissButton = { TextButton(onClick = { deletePhotosId = null }) { Text("Keep photos") } })
        candidate?.let { verified ->
            var consentChanges by remember(verified.digest) { mutableStateOf(emptyMap<String, Boolean>()) }
            AlertDialog(onDismissRequest = { candidate = null }, title = { Text("Install ${verified.manifest.name} ${verified.manifest.version}?") },
                text = { Column(Modifier.verticalScroll(rememberScrollState())) {
                    Text("Publisher signature verified. Review module access:")
                    for (cap in verified.manifest.capabilities) {
                        if (cap.explicitOptIn) {
                            val prior = modules.firstOrNull { it.manifest.id == verified.manifest.id }?.granted?.contains(cap.id) == true
                            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                                Text(cap.label, Modifier.weight(1f))
                                Switch(checked = consentChanges[cap.id] ?: prior,
                                    modifier = Modifier.semantics { contentDescription = cap.label },
                                    onCheckedChange = { consentChanges = consentChanges + (cap.id to it) })
                            }
                        } else Text(cap.label)
                        Text(if (cap.optional) "Optional" else "Required for this module", style = MaterialTheme.typography.labelMedium)
                        Text(cap.id, style = MaterialTheme.typography.bodySmall)
                        Text(cap.reason)
                    }
                    Text("Existing access choices are kept unless you change them. New tone, contacts and camera access starts off. You can change access later in Module access.")
                    if (verified.manifest.capabilities.any { it.id == "camera.capture" }) Text("Camera also needs Android permission through Module access. Photos are saved privately by the native workspace, not shared with JavaScript. No microphone or general file access.")
                    if (verified.manifest.capabilities.any { it.id == "contacts.read" }) Text("Contacts also need Android permission. After installing, open Module access to allow Android contacts access. This does not grant any module automatically.")
                    if (verified.manifest.capabilities.any { it.id == "contacts.read" } && verified.manifest.capabilities.any { it.id == "storage.kv" }) Text("This module can save contact data on this phone when both contacts and saved-data access are allowed. Revoking contacts access does not erase data it already saved.")
                    Text("No module network access. Installed code starts as a trial; your previous working version is kept.")
                } },
                confirmButton = { TextButton(onClick = { val choices = consentChanges; candidate = null; work { store.install(verified, choices); { status = "Installed. Open and test it, then mark it working." } } }) { Text("Allow & install") } },
                dismissButton = { TextButton(onClick = { candidate = null }) { Text("Cancel") } })
        }
        rollbackTarget?.let { id ->
            AlertDialog(onDismissRequest = { rollbackTarget = null }, title = { Text("Restore previous working version?") },
                text = { Text("This restores module code, not its stored data. The current version will be removed; you can download it again.") },
                confirmButton = { TextButton(onClick = { rollbackTarget = null; work { store.rollback(id); { status = "Previous working code restored. Module data kept." } } }) { Text("Restore") } },
                dismissButton = { TextButton(onClick = { rollbackTarget = null }) { Text("Cancel") } })
        }
        discardTarget?.let { module ->
            AlertDialog(onDismissRequest = { discardTarget = null }, title = { Text("Discard this trial?") },
                text = { Text("Remove unverified module code so you can try another version. Stored module data is kept.") },
                confirmButton = { TextButton(onClick = { discardTarget = null; work { store.discardFirstTrial(module.manifest.id); { status = "Trial discarded. You can install another version." } } }) { Text("Discard") } },
                dismissButton = { TextButton(onClick = { discardTarget = null }) { Text("Cancel") } })
        }
        removeTarget?.let { id ->
            AlertDialog(onDismissRequest = { removeTarget = null }, title = { Text("Remove this module?") },
                text = { Text("Remove $id from Installed. Its saved data stays on this phone and will be reused if you reinstall it.") },
                confirmButton = { TextButton(onClick = { removeTarget = null; work { store.remove(id); { status = "Module removed. Saved data kept." } } }) { Text("Remove") } },
                dismissButton = { TextButton(onClick = { removeTarget = null }) { Text("Cancel") } })
        }
        if (resetIndex) AlertDialog(onDismissRequest = { resetIndex = false }, title = { Text("Repair unreadable module index?") },
            text = { Text("Archive the damaged index, remove installed code, and start an empty list. Reinstall modules afterward. Saved module data is kept.") },
            confirmButton = { TextButton(onClick = { resetIndex = false; work { store.resetUnreadableIndex(); { status = "Index repaired. Reinstall your modules; saved data is kept." } } }) { Text("Archive & reset index") } },
            dismissButton = { TextButton(onClick = { resetIndex = false }) { Text("Cancel") } })
    }
}
