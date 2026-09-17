package dev.construct.runtime

/** Display-only contract. The activity owns all decisions, effects and confirmations. */
internal enum class WorkshopTone { NEUTRAL, ATTENTION, ERROR }
internal enum class WorkshopActionId {
    BROWSE_UPDATES, OPEN, ENABLE, DISABLE, ROLLBACK, MODULE_ACCESS, REMOVE, DISCARD_TRIAL,
    REVIEW_INSTALL, VERSIONS, REPAIR_INDEX
}
internal data class WorkshopAction(
    val id: WorkshopActionId,
    val label: String,
    val enabled: Boolean = true,
    val destructive: Boolean = false
)
internal data class WorkshopBadge(val text: String, val tone: WorkshopTone = WorkshopTone.NEUTRAL)
internal data class WorkshopMessage(
    val text: String,
    val tone: WorkshopTone = WorkshopTone.NEUTRAL,
    val details: String? = null
)
internal data class WorkshopCardModel(
    val id: String,
    val title: String,
    val subtitle: String? = null,
    val version: String? = null,
    val badges: List<WorkshopBadge> = emptyList(),
    val primary: WorkshopAction? = null,
    val secondary: List<WorkshopAction> = emptyList(),
    val message: WorkshopMessage? = null
)
