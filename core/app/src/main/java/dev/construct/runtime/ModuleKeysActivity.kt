package dev.construct.runtime

import android.os.Bundle
import android.view.View
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import java.util.concurrent.Executors

/**
 * Settings › Module keys: the secure native screen for content keys of encrypted modules
 * (docs/encrypted-packages.md, "Native key UX and storage"). Screen capture and autofill are off,
 * the key field is masked and never echoed, the clipboard is only read by the person's own paste,
 * and every input is cleared on save, cancel and when the screen leaves the foreground. QR import
 * is not offered.
 */
class ModuleKeysActivity : ComponentActivity() {
    private val worker = Executors.newSingleThreadExecutor()
    private lateinit var store: ModuleStore

    private var moduleId by mutableStateOf("")
    private var keyId by mutableStateOf("")
    private var keyText by mutableStateOf("")
    private var label by mutableStateOf("")
    /** The parsed binding awaiting confirmation; its key bytes are cleared on save or cancel. */
    private var pending by mutableStateOf<Triple<String, String, ByteArray>?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        window.decorView.importantForAutofill = View.IMPORTANT_FOR_AUTOFILL_NO_EXCLUDE_DESCENDANTS
        store = ModuleStore.shared(this)
        setContent { ConstructTheme { Screen() } }
    }

    override fun onStop() { clearInput(); super.onStop() }
    override fun onDestroy() { worker.shutdown(); super.onDestroy() }

    private fun clearInput() {
        pending?.third?.fill(0)
        pending = null; moduleId = ""; keyId = ""; keyText = ""; label = ""
    }

    @Composable private fun Screen() {
        var records by remember { mutableStateOf(emptyList<ModuleKeyRecord>()) }
        var status by remember { mutableStateOf("Keys unlock encrypted modules on this phone only.") }
        var busy by remember { mutableStateOf(false) }
        var forgetTarget by remember { mutableStateOf<ModuleKeyRecord?>(null) }
        fun work(task: () -> String) {
            if (busy) return
            busy = true
            worker.execute {
                val (message, list) = try { task() to store.keys.list() } catch (error: Exception) {
                    val code = (error as? ConstructError)?.code ?: "OPERATION_FAILED"
                    runCatching { store.log("host", code, message = "Module keys: $code") }
                    "[$code] " + ((error as? ConstructError)?.message ?: "Operation failed") to runCatching { store.keys.list() }.getOrDefault(records)
                }
                runOnUiThread { if (!isDestroyed) { status = message; records = list; busy = false } }
            }
        }
        LaunchedEffect(Unit) { work { status } }
        val hexOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false,
            keyboardType = KeyboardType.Password, imeAction = ImeAction.Next)

        Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
            Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                TextButton(onClick = { finish() }) { Text("Back to Settings") }
                Text("Module keys", style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
                WorkshopStatus(WorkshopMessage(status, if (status.startsWith("[")) WorkshopTone.ERROR else WorkshopTone.NEUTRAL))
                Text("A key comes privately from the module's publisher. Construct stores it wrapped by this phone's keystore, never shows or exports it, and does not back it up. Keys are for this publisher only: " +
                    store.keys.publisher.take(16) + "…", style = MaterialTheme.typography.bodySmall)

                Text("Stored keys · ${records.size} of ${ModuleKeys.MAX_RECORDS}", style = MaterialTheme.typography.titleMedium)
                if (records.isEmpty()) Text("No keys yet.")
                records.forEach { record ->
                    WorkshopCard(WorkshopCardModel("key:${record.id}:${record.keyId}", record.label.ifBlank { "Locked module" },
                        message = WorkshopMessage("Module ${record.id}\nKey ID ${record.keyId}"),
                        primary = WorkshopAction(WorkshopActionId.REMOVE, "Forget key", !busy, true)),
                        onAction = { forgetTarget = record })
                }

                Text("Add a key", style = MaterialTheme.typography.titleMedium)
                OutlinedTextField(value = moduleId, onValueChange = { moduleId = it.take(64) }, enabled = !busy && pending == null, singleLine = true,
                    label = { Text("Module ID (sealed.a…)") }, keyboardOptions = hexOptions.copy(keyboardType = KeyboardType.Ascii), modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = keyId, onValueChange = { keyId = it.take(64) }, enabled = !busy && pending == null, singleLine = true,
                    label = { Text("Key ID (32 hex digits)") }, keyboardOptions = hexOptions.copy(keyboardType = KeyboardType.Ascii), modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = keyText, onValueChange = { keyText = it.take(ModuleKeys.MAX_IMPORT) }, enabled = !busy && pending == null,
                    label = { Text("Key (64 hex digits, spaces allowed)") }, visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = hexOptions, supportingText = { Text("${keyText.count { !it.isWhitespace() }} of 64 digits") },
                    modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = label, onValueChange = { label = it.take(40) }, enabled = !busy && pending == null, singleLine = true,
                    label = { Text("Label on this phone (optional)") }, keyboardOptions = KeyboardOptions(autoCorrectEnabled = false, imeAction = ImeAction.Done),
                    modifier = Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(enabled = !busy && pending == null && keyText.isNotBlank(), onClick = {
                        try { pending = store.keys.parse(moduleId, keyId, keyText); keyText = "" }
                        catch (error: ConstructError) { keyText = ""; status = "[${error.code}] ${error.message}" }
                    }) { Text("Check key") }
                    TextButton(enabled = !busy, onClick = { clearInput(); status = "Cancelled. Nothing was saved." }) { Text("Cancel") }
                }
                Text("Forgetting a key locks its module and removes the unlocked code. The module's saved data stays on this phone.", style = MaterialTheme.typography.bodySmall)
            }
        }
        pending?.let { (id, kid, _) ->
            AlertDialog(onDismissRequest = { clearInput(); status = "Cancelled. Nothing was saved." }, title = { Text("Save this key?") },
                text = { Text("Publisher ${store.keys.publisher.take(16)}…\nModule $id\nKey ID $kid" + if (label.isNotBlank()) "\nLabel ${label.trim()}" else "") },
                confirmButton = { TextButton(enabled = !busy, onClick = {
                    val binding = pending!!; val name = label.trim(); pending = null; clearInput()
                    work { store.addKey(binding.first, binding.second, binding.third, name); "Key saved. Locked versions of this module can now be unlocked." }
                }) { Text("Save key") } },
                dismissButton = { TextButton(onClick = { clearInput(); status = "Cancelled. Nothing was saved." }) { Text("Cancel") } })
        }
        forgetTarget?.let { record ->
            AlertDialog(onDismissRequest = { forgetTarget = null }, title = { Text("Forget this key?") },
                text = { Text("Versions that need it are locked and their unlocked code is removed. The module's saved data and access choices are kept for a later re-import. Forgetting cannot undo copies already made by the module.") },
                confirmButton = { TextButton(enabled = !busy, onClick = {
                    forgetTarget = null
                    work { store.forgetKey(record.id, record.keyId); "Key forgotten. Saved data kept." }
                }) { Text("Forget key") } },
                dismissButton = { TextButton(onClick = { forgetTarget = null }) { Text("Keep key") } })
        }
    }
}
