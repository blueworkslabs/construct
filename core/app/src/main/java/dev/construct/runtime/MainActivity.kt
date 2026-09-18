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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.ui.semantics.heading
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
        setContent { ConstructTheme { ConstructApp() } }
    }

    override fun onDestroy() { worker.shutdown(); super.onDestroy() }

    @OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
    @Composable private fun ConstructApp() {
        var modules by remember { mutableStateOf(emptyList<Installed>()) }
        var damaged by remember { mutableStateOf(emptyList<DamagedModule>()) }
        var indexError by remember { mutableStateOf<String?>(null) }
        var catalog by remember { mutableStateOf(emptyList<CatalogVersion>()) }
        var catalogSource by remember { mutableStateOf("demo") }
        var source by remember { mutableStateOf(store.registry) }
        var status by remember { mutableStateOf("Installed tools are available offline.") }
        var busy by remember { mutableStateOf(false) }
        var page by rememberSaveable { mutableStateOf("library") }
        var menuOpen by remember { mutableStateOf(false) }
        var versionsId by remember { mutableStateOf<String?>(null) }
        val libraryScroll = rememberScrollState()
        val browseScroll = rememberScrollState()
        val settingsScroll = rememberScrollState()
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
        var androidCamera by remember { mutableStateOf(PhotoCaptureActivity.hasPermission(this)) }
        val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { allowed ->
            androidCamera = allowed
            status = if (allowed) "Android camera access allowed. Module grants are separate." else "Android camera access denied. Retry or use Android app settings."
        }
        var androidLocation by remember { mutableStateOf(ModuleLocation.hasPermission(this)) }
        val locationPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
            androidLocation = ModuleLocation.hasPermission(this)
            status = if (androidLocation) "Android location access allowed. Module grants are separate." else "Android location access denied. Manual areas remain available."
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
                        code != null -> "[$code] Module stopped. Retry, remove, or restore previous code from Library."
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
                    androidCamera = PhotoCaptureActivity.hasPermission(this@MainActivity)
                    androidLocation = ModuleLocation.hasPermission(this@MainActivity)
                }
            }
            lifecycle.addObserver(observer)
            onDispose { lifecycle.removeObserver(observer) }
        }
        // Launch is local-only. Catalog IO is an explicit Browse/Settings action.
        LaunchedEffect(Unit) { work { { } } }
        BackHandler(showLogs || accessModuleId != null || page !in listOf("library")) {
            if (showLogs || accessModuleId != null) { showLogs = false; accessModuleId = null }
            else page = "library"
        }
        fun refreshCatalog(selected: String) {
            work {
                val result = store.catalog(selected)
                store.registry = selected
                { catalog = result; catalogSource = selected; source = selected; page = "browse"; status = "Catalog refreshed." }
            }
        }
        fun choice(version: CatalogVersion, explicit: Boolean = false): CatalogInstallChoice {
            val current = modules.firstOrNull { it.manifest.id == version.id }
            return CatalogInstallPresentation.choice(version,
                current?.let { CatalogInstalledState(it.manifest.version, it.digest, it.confirmed, CapabilityLifecycle.needsUpdate(it.manifest)) },
                busy, indexError != null, damaged.any { it.id == version.id }, explicit)
        }
        fun review(version: CatalogVersion, explicit: Boolean = false) {
            if (!choice(version, explicit).enabled) return
            val selectedSource = catalogSource
            versionsId = null
            work { val verified = store.prepare(selectedSource, version);
                CapabilityLifecycle.requireRunnable(verified.manifest);
                { candidate = verified; status = "Signature verified. Review access before installing." }
            }
        }
        val cards = remember(catalog) { CatalogPresentation.cards(catalog) }
        @Composable fun ReleaseCard(version: CatalogVersion, explicit: Boolean = false) {
            val action = choice(version, explicit)
            WorkshopCard(WorkshopCardModel(id = "${version.id}@${version.version}", title = version.name,
                version = version.version,
                badges = if (version.testFixture) listOf(WorkshopBadge("Test fixture", WorkshopTone.ERROR)) else emptyList(),
                message = when {
                    version.testFixture -> WorkshopMessage("May deliberately fail. Follow its test instructions.", WorkshopTone.ATTENTION)
                    action.explanation != null -> WorkshopMessage(action.explanation)
                    else -> null
                },
                primary = WorkshopAction(WorkshopActionId.REVIEW_INSTALL, action.label, action.enabled),
                secondary = if (explicit) emptyList() else listOf(WorkshopAction(WorkshopActionId.VERSIONS, "Versions", !busy))
            ), onAction = { id -> if (id == WorkshopActionId.VERSIONS) versionsId = version.id else review(version, explicit) })
        }

        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(if (showLogs) "Diagnostics" else if (accessModuleId != null) "Module access" else when(page) {
                            "browse" -> "Browse"; "settings" -> "Settings"; "about" -> "About"; else -> "Construct"
                        }, style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
                        if (!showLogs && accessModuleId == null && page == "library")
                            Text("Library · ${modules.size} tools", style = MaterialTheme.typography.bodySmall)
                    }
                    Box {
                        IconButton(onClick = { menuOpen = true }, modifier = Modifier.size(48.dp)) { Icon(Icons.Default.Menu, contentDescription = "Construct menu") }
                        DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                            DropdownMenuItem(text = { Text("Settings") }, onClick = { menuOpen = false; showLogs = false; accessModuleId = null; page = "settings" })
                            DropdownMenuItem(text = { Text("Diagnostics") }, enabled = !busy, onClick = {
                                menuOpen = false; work(refresh = false) { val result = store.diagnosticReport(); { logs = result; showLogs = true; accessModuleId = null } }
                            })
                            DropdownMenuItem(text = { Text("About") }, onClick = { menuOpen = false; showLogs = false; accessModuleId = null; page = "about" })
                        }
                    }
                }
                if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                if (accessModuleId != null) {
                    Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 16.dp)) {
                        TextButton(enabled = !busy, onClick = { accessModuleId = null }) { Text("Back") }
                        WorkshopStatus(WorkshopMessage(status, if (status.startsWith("[")) WorkshopTone.ERROR else WorkshopTone.NEUTRAL))
                        Text("The module is stopped. Changes apply immediately and survive updates and rollback.")
                        modules.firstOrNull { it.manifest.id == accessModuleId }?.let { module ->
                            Text(module.manifest.name)
                            for (cap in module.manifest.capabilities) {
                                val label = cap.label
                                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                                    Text(label, Modifier.weight(1f))
                                    Switch(checked = cap.id in module.granted, enabled = !busy && cap.id !in CapabilityLifecycle.retired,
                                        modifier = Modifier.semantics { contentDescription = label },
                                        onCheckedChange = { allowed ->
                                            if (!allowed && !cap.optional) revokeTarget = module.manifest.id to cap
                                            else work {
                                                store.setCapability(module.manifest.id, cap.id, allowed);
                                                { status = if (allowed) "$label: on." else "$label: off." }
                                            }
                                        })
                                }
                                Text(if (cap.id in CapabilityLifecycle.retired) "Retired · update this module" else if (cap.optional) "Optional" else "Required for this module", style = MaterialTheme.typography.labelMedium)
                                Text(cap.id, style = MaterialTheme.typography.bodySmall)
                                Text(cap.reason, style = MaterialTheme.typography.bodySmall)
                                cap.origins.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
                            }
                            if (module.manifest.capabilities.any { it.id == "photos.library" }) Text("Private-photo access exposes all photos previously captured for this module, including older versions, as bounded pixels. Delete and gallery-copy requests need your confirmation in Construct. Other granted storage or internet access may retain or send delivered pixels. Revocation cannot erase delivered copies.")
                            if (module.manifest.capabilities.any { it.id == "image.analyze" }) Text("Local analysis returns face regions or estimated object labels, boxes and scores to module code. No face identity or emotion detection; results can be wrong. Models run on this phone.")
                            if (module.manifest.capabilities.any { it.id == "image.read" }) Text("Selected image pixels reach this module. Other granted storage or diagnostics may retain copies; approved internet sources may receive them. Revocation cannot erase copies already delivered. You choose external images in Android’s picker. A separately granted private-photo library also permits this module to read its own saved photos; no broad phone-gallery access.")
                            if (module.manifest.capabilities.any { it.id == "location.read" }) {
                                Text("Android location access: " + if (androidLocation) "allowed" else "not allowed")
                                Text("This permits an allowed module to receive foreground coordinates and accuracy. Approximate location works. With internet access the module can send that data to its approved sources; stored copies are not erased by revocation.")
                                Button(enabled = !busy && !androidLocation, onClick = { locationPermission.launch(arrayOf(android.Manifest.permission.ACCESS_FINE_LOCATION, android.Manifest.permission.ACCESS_COARSE_LOCATION)) }) { Text("Allow Android location access") }
                                TextButton(onClick = { startActivity(android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:$packageName"))) }) { Text("Android app settings") }
                            }
                            if (module.manifest.capabilities.any { it.id == "net.http" }) Text("Internet requests go only to the signed sources listed above. Those services receive requested data and your IP address. Raster responses may be cached on this phone; JSON responses are not cached by the host. Revocation blocks new requests, not copies already received by a module or service.")
                            if (module.manifest.capabilities.any { it.id == "contacts.read" }) {
                                Text("Android contacts access: " + if (androidContacts) "allowed" else "not allowed")
                                Text("Android permission is app-wide. Only modules you separately allow can use the host contacts API. Reading exposes names, phone numbers and email addresses; no editing.")
                                Button(enabled = !busy && !androidContacts, onClick = { contactsPermission.launch(android.Manifest.permission.READ_CONTACTS) }) { Text("Allow Android contacts access") }
                                TextButton(onClick = { startActivity(android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:$packageName"))) }) { Text("Android app settings") }
                            }
                            if (module.manifest.capabilities.any { it.id == "camera.photo" }) {
                                Text("Android camera access: " + if (androidCamera) "allowed" else "not allowed")
                                Text("Opens a visible native camera. Only you can press the shutter. Photos stay in this module's private storage; No live frames reach JavaScript. Private album pixels require separate photo-library and image grants.")
                                Button(enabled = !busy && !androidCamera, onClick = { cameraPermission.launch(android.Manifest.permission.CAMERA) }) { Text("Allow Android camera access") }
                                TextButton(onClick = { startActivity(android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS, android.net.Uri.parse("package:$packageName"))) }) { Text("Android app settings") }
                            }
                            if (module.manifest.capabilities.any { it.id in setOf("camera.photo", "photos.library") } ||
                                runCatching { CameraPhotos(this@MainActivity, module.manifest.id).list().isNotEmpty() }.getOrDefault(false)) {
                                TextButton(enabled = !busy, onClick = { deletePhotosId = module.manifest.id }) { Text("Delete all saved photos") }
                                Text("Deleting saved photos works with access off or an update-required module. Removing a module keeps its photos; install a supported version to browse them again.")
                            }
                            Button(enabled = !busy && module.enabled && !CapabilityLifecycle.needsUpdate(module.manifest), onClick = { work {
                                store.beginRun(module);
                                { accessModuleId = null; moduleLauncher.launch(ModuleActivity.intent(this@MainActivity, module)); status = "Testing ${module.manifest.name} ${module.manifest.version}." }
                            } }) { Text("Reopen module") }
                            if (module.manifest.capabilities.any { it.id == "device.tone" }) Text("Tones are short, use media volume and stop when you leave the module. The tone capability does not access the microphone or internet.")
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
                    Column(Modifier.weight(1f).verticalScroll(when (page) { "library" -> libraryScroll; "browse" -> browseScroll; else -> settingsScroll }).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        WorkshopStatus(WorkshopMessage(status, if (status.startsWith("[")) WorkshopTone.ERROR else WorkshopTone.NEUTRAL))
                        when (page) {
                            "settings" -> {
                                TextButton(onClick = { page = "library" }) { Text("Back to Library") }
                                Text("Catalog source", style = MaterialTheme.typography.titleMedium)
                                Text("Changes apply when you choose Use catalog. Installed tools remain available if a source is offline.")
                                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    TextButton(enabled = !busy, onClick = { source = "demo" }) { Text("Use demo catalog") }
                                    if (getString(R.string.configured_registry).isNotBlank()) TextButton(enabled = !busy, onClick = { source = getString(R.string.configured_registry) }) { Text("Use configured registry") }
                                }
                                OutlinedTextField(value = source, onValueChange = { source = it }, enabled = !busy,
                                    label = { Text("Catalog: demo or HTTPS index URL") }, modifier = Modifier.fillMaxWidth())
                                Button(enabled = !busy, onClick = { refreshCatalog(source.trim()) }) { Text("Use catalog") }
                                Text("Removing a tool keeps its saved data. Uninstalling Construct deletes private app data.", style = MaterialTheme.typography.bodySmall)
                            }
                            "about" -> {
                                TextButton(onClick = { page = "library" }) { Text("Back to Library") }
                                Text("Construct", style = MaterialTheme.typography.headlineSmall)
                                Text(BuildConfig.VERSION_NAME, style = ConstructMono)
                                Text("Small tools on your phone. Signed modules run inside a restricted WebView; device access is managed by the native host.")
                            }
                            "browse" -> {
                                Text(if (catalog.isEmpty()) "Choose a catalog in Settings, then refresh to browse tools." else
                                    "${if (catalogSource == "demo") "Bundled demo" else "Remote catalog"} · ${cards.size} tools",
                                    style = MaterialTheme.typography.bodySmall)
                                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Button(enabled = !busy, onClick = { refreshCatalog(store.registry) }) { Text("Refresh catalog") }
                                    TextButton(enabled = !busy, onClick = { page = "settings" }) { Text("Choose a catalog") }
                                }
                                if (catalog.isNotEmpty()) Text("Showing the latest normal release per tool. Versions includes older code and labelled test releases.", style = MaterialTheme.typography.bodySmall)
                                cards.forEach { ReleaseCard(it.latest) }
                            }
                            else -> {
                                if (indexError != null) WorkshopCard(WorkshopCardModel("index-repair", "Module index cannot be read",
                                    message = WorkshopMessage("[$indexError] Saved module data is untouched. Repair archives the damaged index and removes installed code so tools can be reinstalled.", WorkshopTone.ERROR),
                                    primary = WorkshopAction(WorkshopActionId.REPAIR_INDEX, "Repair module index", !busy)),
                                    onAction = { resetIndex = true })
                                if (modules.isEmpty() && damaged.isEmpty() && indexError == null) {
                                    Text("Your tools will appear here", style = MaterialTheme.typography.titleMedium)
                                    Text("Choose a catalog to find and install your first tool.")
                                    Button(enabled = !busy, onClick = { page = "settings" }) { Text("Choose a catalog") }
                                }
                                damaged.forEach { broken ->
                                    WorkshopCard(WorkshopCardModel("damaged:${broken.id}", broken.id,
                                        badges = listOf(WorkshopBadge("Needs repair", WorkshopTone.ERROR)),
                                        message = WorkshopMessage("[${broken.code}] Other tools remain usable. Restore previous code or remove this tool; saved data is kept.", WorkshopTone.ERROR),
                                        primary = if (broken.previousVersion != null) WorkshopAction(WorkshopActionId.ROLLBACK, "Restore ${broken.previousVersion}", !busy)
                                            else WorkshopAction(WorkshopActionId.REMOVE, "Remove · keep data", !busy, true),
                                        secondary = if (broken.previousVersion != null) listOf(WorkshopAction(WorkshopActionId.REMOVE, "Remove · keep data", !busy, true)) else emptyList()),
                                        onAction = { if (it == WorkshopActionId.ROLLBACK) rollbackTarget = broken.id else removeTarget = broken.id })
                                }
                                modules.sortedWith(compareBy<Installed> { it.manifest.name.lowercase(java.util.Locale.ROOT) }.thenBy { it.manifest.id }).forEach { module ->
                                    val latest = cards.firstOrNull { it.latest.id == module.manifest.id }?.latest
                                    val needsUpdate = CapabilityLifecycle.needsUpdate(module.manifest)
                                    val hasUpdate = latest != null && !latest.testFixture && (module.confirmed || needsUpdate) &&
                                        CatalogPresentation.compareVersions(latest.version, module.manifest.version) > 0 && latest.sha256 != module.digest
                                    val badge = when {
                                        needsUpdate -> WorkshopBadge("Update required", WorkshopTone.ATTENTION)
                                        module.failureCode != null -> WorkshopBadge("Failed", WorkshopTone.ERROR)
                                        !module.enabled -> WorkshopBadge("Disabled")
                                        !module.confirmed -> WorkshopBadge("Trial", WorkshopTone.ATTENTION)
                                        else -> WorkshopBadge("Working")
                                    }
                                    val secondary = buildList {
                                        add(WorkshopAction(WorkshopActionId.MODULE_ACCESS, "Module access", !busy))
                                        add(WorkshopAction(if (module.enabled) WorkshopActionId.DISABLE else WorkshopActionId.ENABLE, if (module.enabled) "Disable" else "Enable", !busy))
                                        if (module.previous != null) add(WorkshopAction(WorkshopActionId.ROLLBACK, "Roll back", !busy))
                                        if (hasUpdate) add(WorkshopAction(WorkshopActionId.REVIEW_INSTALL, "Update to ${latest!!.version}", !busy))
                                        add(WorkshopAction(WorkshopActionId.REMOVE, "Remove · keep data", !busy, true))
                                        if (!module.confirmed && module.previous == null) add(WorkshopAction(WorkshopActionId.DISCARD_TRIAL, "Discard trial", !busy, true))
                                    }
                                    WorkshopCard(WorkshopCardModel(module.manifest.id, module.manifest.name,
                                        version = module.manifest.version,
                                        badges = listOf(badge) + if (hasUpdate) listOf(WorkshopBadge("Update available", WorkshopTone.ATTENTION)) else emptyList(),
                                        primary = if (needsUpdate) WorkshopAction(WorkshopActionId.BROWSE_UPDATES, "Find update", !busy) else WorkshopAction(if (module.enabled) WorkshopActionId.OPEN else WorkshopActionId.ENABLE,
                                            if (!module.enabled) "Enable" else if (module.failureCode != null) "Retry" else "Open", !busy),
                                        secondary = secondary,
                                        message = when {
                                            needsUpdate -> WorkshopMessage(CapabilityLifecycle.updateMessage, WorkshopTone.ATTENTION)
                                            module.failureCode != null -> WorkshopMessage("[${module.failureCode}] Retry, or use More actions to restore/remove this code.", WorkshopTone.ERROR)
                                            !module.confirmed -> WorkshopMessage("Open and test, then mark working in the module menu.", WorkshopTone.ATTENTION)
                                            else -> null
                                        }), onAction = { action -> when (action) {
                                            WorkshopActionId.BROWSE_UPDATES -> refreshCatalog(store.registry)
                                            WorkshopActionId.OPEN -> work { store.beginRun(module); { moduleLauncher.launch(ModuleActivity.intent(this@MainActivity, module)); status = "Opened ${module.manifest.name}." } }
                                            WorkshopActionId.ENABLE, WorkshopActionId.DISABLE -> work { store.enable(module.manifest.id, !module.enabled); { status = if (module.enabled) "Module disabled." else "Module enabled." } }
                                            WorkshopActionId.MODULE_ACCESS -> accessModuleId = module.manifest.id
                                            WorkshopActionId.ROLLBACK -> rollbackTarget = module.manifest.id
                                            WorkshopActionId.REMOVE -> removeTarget = module.manifest.id
                                            WorkshopActionId.DISCARD_TRIAL -> discardTarget = module
                                            WorkshopActionId.REVIEW_INSTALL -> latest?.let { review(it) }
                                            else -> Unit
                                        } })
                                }
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                    }
                    if (page in listOf("library", "browse")) Row(Modifier.fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        listOf("library" to "Library", "browse" to "Browse").forEach { (value, label) ->
                            FilledTonalButton(onClick = { page = value }, modifier = Modifier.weight(1f),
                                colors = ButtonDefaults.filledTonalButtonColors(contentColor = if (page == value) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)) { Text(label) }
                        }
                    }
                }
            }
        }
        versionsId?.let { id ->
            val group = cards.firstOrNull { it.latest.id == id }
            ModalBottomSheet(onDismissRequest = { versionsId = null }) {
                Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Versions · ${group?.latest?.name.orEmpty()}", style = MaterialTheme.typography.titleLarge)
                    Text("Reviewing a version still requires signature verification and install consent. Older code does not restore older saved data.")
                    group?.let { (listOf(it.latest) + it.otherVersions).forEach { version -> ReleaseCard(version, explicit = true) } }
                    TextButton(onClick = { versionsId = null }) { Text("Close versions") }
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
            text = { Text("Permanently deletes this module's private photos. Its grants and other data are unchanged.") },
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
                            val existing = modules.firstOrNull { it.manifest.id == verified.manifest.id }
                            val oldOrigins = existing?.manifest?.capabilities?.firstOrNull { it.id == "net.http" }?.origins.orEmpty()
                            val prior = existing?.granted?.contains(cap.id) == true && (cap.id != "net.http" || oldOrigins.containsAll(cap.origins))
                            Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                                Text(cap.label, Modifier.weight(1f))
                                Switch(checked = consentChanges[cap.id] ?: prior, enabled = cap.id !in CapabilityLifecycle.retired,
                                    modifier = Modifier.semantics { contentDescription = cap.label },
                                    onCheckedChange = { consentChanges = consentChanges + (cap.id to it) })
                            }
                        } else Text(cap.label)
                        Text(if (cap.optional) "Optional" else "Required for this module", style = MaterialTheme.typography.labelMedium)
                        Text(cap.id, style = MaterialTheme.typography.bodySmall)
                        Text(cap.reason)
                        cap.origins.forEach { Text(it, style = MaterialTheme.typography.bodySmall) }
                    }
                    Text("Existing access choices are kept unless you change them. New sensitive capabilities start off. You can change access later in Module access.")
                    if (verified.manifest.capabilities.any { it.id == "camera.photo" }) Text("Camera also needs Android permission through Module access. The visible native shutter saves privately. Separate photo-library and image grants are needed to read those photos in module code. No microphone or general file access.")
                    if (verified.manifest.capabilities.any { it.id == "contacts.read" }) Text("Contacts also need Android permission. After installing, open Module access to allow Android contacts access. This does not grant any module automatically.")
                    if (verified.manifest.capabilities.any { it.id == "contacts.read" } && verified.manifest.capabilities.any { it.id == "storage.kv" }) Text("This module can save contact data on this phone when both contacts and saved-data access are allowed. Revoking contacts access does not erase data it already saved.")
                    if (verified.manifest.capabilities.any { it.id == "net.http" }) Text("Approved internet access lets this module send data to the exact sources above, which see your IP address. New sources need new consent. Other granted data, including location or contacts, can be sent to those sources. Raster responses may be cached; revocation does not erase previously received data.")
                    else Text("No module network access.")
                    if (verified.manifest.capabilities.any { it.id == "photos.library" }) Text("Private-photo access exposes all photos previously captured for this module, including older versions, as bounded pixels. Delete and gallery-copy requests need your confirmation in Construct. Other granted storage or internet access may retain or send delivered pixels. Revocation cannot erase delivered copies.")
                    if (verified.manifest.capabilities.any { it.id == "image.analyze" }) Text("Local analysis returns face regions or estimated object labels, boxes and scores to module code. No face identity or emotion detection; results can be wrong. Models run on this phone.")
                    if (verified.manifest.capabilities.any { it.id == "image.read" }) Text("Selected image pixels reach this module's code. External images are selected with Android's picker. Separate private-photo library access also permits reading this module's saved photos. Other granted storage or diagnostics may retain copies, and approved internet sources may receive them. Revocation cannot erase copies already delivered. No broad photo-library access.")
                    if (verified.manifest.capabilities.any { it.id == "location.read" }) Text("The module can receive a foreground location fix only after both its location grant and Android permission are enabled. Allow Android location in Module access after installation. Approximate location works; no background tracking.")
                    Text("Installed code starts as a trial. Previous code is kept where available, but versions requiring retired capabilities cannot be restored.")
                } },
                confirmButton = { TextButton(onClick = { val choices = consentChanges; candidate = null; work { store.install(verified, choices); { status = "Installed. Open and test it, then mark it working." } } }) { Text("Allow & install") } },
                dismissButton = { TextButton(onClick = { candidate = null }) { Text("Cancel") } })
        }
        rollbackTarget?.let { id ->
            AlertDialog(onDismissRequest = { rollbackTarget = null }, title = { Text("Restore previous working version?") },
                text = { Text("This restores module code, not its stored data. A version requiring retired capabilities cannot be restored; in that case nothing changes. Otherwise the current code is removed and can be downloaded again.") },
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
                text = { Text("Remove $id from Library. Its saved data stays on this phone and will be reused if you reinstall it.") },
                confirmButton = { TextButton(onClick = { removeTarget = null; work { store.remove(id); { status = "Module removed. Saved data kept." } } }) { Text("Remove") } },
                dismissButton = { TextButton(onClick = { removeTarget = null }) { Text("Cancel") } })
        }
        if (resetIndex) AlertDialog(onDismissRequest = { resetIndex = false }, title = { Text("Repair unreadable module index?") },
            text = { Text("Archive the damaged index, remove installed code, and start an empty list. Reinstall modules afterward. Saved module data is kept.") },
            confirmButton = { TextButton(onClick = { resetIndex = false; work { store.resetUnreadableIndex(); { status = "Index repaired. Reinstall your modules; saved data is kept." } } }) { Text("Archive & reset index") } },
            dismissButton = { TextButton(onClick = { resetIndex = false }) { Text("Cancel") } })
    }
}
