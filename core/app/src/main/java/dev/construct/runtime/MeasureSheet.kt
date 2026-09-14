package dev.construct.runtime

import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

/**
 * Everything the owner wants the sheet to show and do. The sheet holds no measurement
 * state of its own; every action is an owner callback so Undo history stays authoritative.
 */
data class MeasureSheetState(
    val instruction: String,                 // one line: next step or current result
    val result: String? = null,              // owner-formatted length, shown large when present
    val error: String? = null,               // persistent, selectable; null hides it
    val setupVisible: Boolean = false,       // marker size entry until confirmed
    val sizeText: String = "",
    val sizeHint: String? = null,            // e.g. "Last used 95 mm · still needs Confirm"
    val calibrationChip: String? = null,     // e.g. "◼ Marker 95 mm ✓" once confirmed
    val measurement: Measurement? = null,    // slice 1: the single editable pair, for nudge controls
    val selectedEndpoint: MeasureEndpoint? = null,
    val canUndo: Boolean = false,
    val busy: Boolean = false,
    val enabled: Boolean = true,             // false while loading or before calibration
)

data class MeasureSheetActions(
    val onSizeChange: (String) -> Unit,
    val onConfirmSize: () -> Unit,
    val onReopenSetup: () -> Unit,
    val onSelectEndpoint: (MeasureEndpoint?) -> Unit,
    val onNudge: (MeasureEndpoint, dx: Int, dy: Int) -> Unit,   // owner converts photo pixels to a begin/preview/commit move
    val onUndo: () -> Unit,
    val onClear: () -> Unit,
    val onChoosePhoto: () -> Unit,
    val onClose: () -> Unit,
)

/**
 * Bottom sheet content. Collapsed: drag handle plus one instruction/result row. Expanded: setup,
 * endpoint controls and actions, scrolling internally so the photo above never resizes.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun MeasureSheet(state: MeasureSheetState, actions: MeasureSheetActions, expanded: Boolean, onExpandedChange: (Boolean) -> Unit, modifier: Modifier = Modifier) {
    val focus = LocalFocusManager.current
    Surface(modifier.fillMaxWidth().semantics { contentDescription = "Measurement controls" }, tonalElevation = 3.dp, shadowElevation = 8.dp) {
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 8.dp)) {
            TextButton(onClick = { onExpandedChange(!expanded) }, modifier = Modifier.fillMaxWidth()
                .semantics { contentDescription = if (expanded) "Collapse controls" else "Expand controls" }) {
                Text(if (expanded) "▾" else "▴")
            }
            if (expanded) state.calibrationChip?.let { chip ->
                FilterChip(selected = true, onClick = actions.onReopenSetup, label = { Text(chip) })
            }
            Text(state.result ?: state.instruction,
                style = if (state.result != null) MaterialTheme.typography.headlineSmall else MaterialTheme.typography.bodyMedium,
                maxLines = if (expanded) Int.MAX_VALUE else 2, overflow = TextOverflow.Ellipsis)
            if (expanded && state.result != null) Text(state.instruction, style = MaterialTheme.typography.bodySmall)
            state.error?.let { error ->
                // Persistent and selectable, so long owner messages stay readable and copyable.
                SelectionContainer { Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall,
                    maxLines = if (expanded) Int.MAX_VALUE else 2, overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.padding(top = 4.dp).semantics { contentDescription = "Measurement error" }) }
            }
            if (expanded) Column(Modifier.padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (state.setupVisible) {
                    Text("Measure the reference card's outer black square with a ruler.", style = MaterialTheme.typography.bodySmall)
                    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(value = state.sizeText, onValueChange = actions.onSizeChange, label = { Text("Marker side (mm)") },
                            singleLine = true, enabled = !state.busy, modifier = Modifier.fillMaxWidth(),
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                        Button(onClick = { focus.clearFocus(); actions.onConfirmSize() }, enabled = !state.busy) { Text("Confirm size") }
                    }
                    state.sizeHint?.let { Text(it, style = MaterialTheme.typography.labelSmall) }
                    HorizontalDivider()
                }
                val measurement = state.measurement
                if (measurement != null && state.enabled) {
                    // Endpoint selection and nudging: fine adjustment without dragging.
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("Endpoint", style = MaterialTheme.typography.labelMedium)
                        for (endpoint in MeasureEndpoint.values()) {
                            if (measurement.point(endpoint) == null) continue
                            FilterChip(selected = state.selectedEndpoint == endpoint,
                                onClick = { actions.onSelectEndpoint(if (state.selectedEndpoint == endpoint) null else endpoint) },
                                label = { Text(endpoint.name) },
                                modifier = Modifier.semantics { contentDescription = "Select endpoint ${endpoint.name}" })
                        }
                    }
                    state.selectedEndpoint?.let { endpoint ->
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            for ((label, dx, dy, description) in listOf(
                                Nudge("◀", -1, 0, "left"), Nudge("▲", 0, -1, "up"), Nudge("▼", 0, 1, "down"), Nudge("▶", 1, 0, "right"))) {
                                OutlinedButton(onClick = { actions.onNudge(endpoint, dx, dy) }, enabled = !state.busy,
                                    modifier = Modifier.semantics { contentDescription = "Nudge ${endpoint.name} $description" }) { Text(label) }
                            }
                        }
                        Text("One photo pixel per tap. Drag the handle on the photo for larger moves.", style = MaterialTheme.typography.labelSmall)
                    }
                }
                FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = actions.onUndo, enabled = state.canUndo && !state.busy) { Text("Undo") }
                    OutlinedButton(onClick = actions.onClear, enabled = state.measurement != null && !state.busy) { Text("Clear") }
                    OutlinedButton(onClick = actions.onChoosePhoto, enabled = !state.busy) { Text("Choose photo") }
                }
                TextButton(onClick = actions.onClose) { Text("Close measure") }
                Text("Estimate only • Flat surface, marker beside item • No photo or result saved", style = MaterialTheme.typography.labelSmall)
                Spacer(Modifier.height(4.dp))
            }
        }
    }
}

private data class Nudge(val label: String, val dx: Int, val dy: Int, val description: String)
