package dev.construct.runtime

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * Display-only workshop components. They render exactly the actions the activity supplies,
 * honour `enabled`, and call back with typed IDs. No IO, store, navigation or authorization here.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun WorkshopCard(
    model: WorkshopCardModel,
    onAction: (WorkshopActionId) -> Unit,
    modifier: Modifier = Modifier,
) {
    // Local state may only control overflow visibility, keyed by the model's ID.
    var overflow by rememberSaveable(model.id) { mutableStateOf(false) }
    val versions = model.secondary.firstOrNull { it.id == WorkshopActionId.VERSIONS }
    val overflowActions = model.secondary.filter { it.id != WorkshopActionId.VERSIONS }
    val accessibleTitle = model.version?.let { "${model.title}, version $it" } ?: model.title

    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = ConstructColors.surface, contentColor = ConstructColors.text),
        border = BorderStroke(1.dp, ConstructColors.border),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(model.title, style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.semantics { heading(); contentDescription = accessibleTitle })
            model.subtitle?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = ConstructColors.muted) }
            if (model.badges.isNotEmpty() || model.version != null) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    model.badges.forEach { WorkshopBadgeChip(it) }
                    model.version?.let { Text(it, style = ConstructMono, color = ConstructColors.muted, modifier = Modifier.align(Alignment.CenterVertically)) }
                }
            }
            model.message?.let { WorkshopStatus(it) }
            if (model.primary != null || versions != null || overflowActions.isNotEmpty()) {
                FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    model.primary?.let { action ->
                        Button(onClick = { onAction(action.id) }, enabled = action.enabled,
                            colors = ButtonDefaults.buttonColors(containerColor = ConstructColors.jade, contentColor = ConstructColors.jadeInk,
                                disabledContainerColor = ConstructColors.surface2, disabledContentColor = ConstructColors.disabled)) { Text(action.label) }
                    }
                    versions?.let { action ->
                        FilledTonalButton(onClick = { onAction(action.id) }, enabled = action.enabled,
                            colors = ButtonDefaults.filledTonalButtonColors(containerColor = ConstructColors.surface2, contentColor = ConstructColors.text,
                                disabledContainerColor = ConstructColors.surface2, disabledContentColor = ConstructColors.disabled),
                            border = BorderStroke(1.dp, if (action.enabled) ConstructColors.controlBorder else ConstructColors.disabled)) { Text(action.label) }
                    }
                    if (overflowActions.isNotEmpty()) {
                        Box {
                            IconButton(onClick = { overflow = true }, modifier = Modifier.size(48.dp)
                                .semantics { contentDescription = "More actions for ${model.title}" }) {
                                Icon(Icons.Filled.MoreVert, contentDescription = null, tint = ConstructColors.text)
                            }
                            DropdownMenu(expanded = overflow, onDismissRequest = { overflow = false }) {
                                overflowActions.forEach { action ->
                                    DropdownMenuItem(
                                        text = { Text(action.label, color = if (action.destructive) ConstructColors.error else ConstructColors.text) },
                                        enabled = action.enabled,
                                        onClick = { overflow = false; onAction(action.id) })
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

/** Worded badge; tone colours the border and text, the word carries the meaning. */
@Composable
internal fun WorkshopBadgeChip(badge: WorkshopBadge, modifier: Modifier = Modifier) {
    val colour = ConstructColors.tone(badge.tone)
    Surface(modifier, shape = CircleShape, color = ConstructColors.surface2, border = BorderStroke(1.dp, colour)) {
        Text(badge.text, style = MaterialTheme.typography.labelSmall, color = colour,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp))
    }
}

/**
 * Problem or next action, always visible and wrapping. Optional technical details expand in
 * place as selectable text. The tone word is spoken and shown, never colour alone.
 */
@Composable
internal fun WorkshopStatus(message: WorkshopMessage, modifier: Modifier = Modifier) {
    var expanded by rememberSaveable(message.text, message.details) { mutableStateOf(false) }
    val colour = ConstructColors.tone(message.tone)
    val prefix = when (message.tone) {
        WorkshopTone.NEUTRAL -> null
        WorkshopTone.ATTENTION -> "Attention"
        WorkshopTone.ERROR -> "Problem"
    }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        prefix?.let { Text(it, style = MaterialTheme.typography.labelMedium, color = colour, modifier = Modifier.semantics { heading() }) }
        Text(message.text, style = MaterialTheme.typography.bodySmall, color = if (message.tone == WorkshopTone.NEUTRAL) ConstructColors.muted else colour)
        message.details?.let { details ->
            TextButton(onClick = { expanded = !expanded }, contentPadding = ButtonDefaults.TextButtonContentPadding,
                colors = ButtonDefaults.textButtonColors(contentColor = ConstructColors.jade)) {
                Text(if (expanded) "Hide details" else "Details")
            }
            if (expanded) SelectionContainer { Text(details, style = ConstructMono, color = ConstructColors.muted) }
        }
    }
}
