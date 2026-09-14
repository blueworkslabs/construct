package dev.construct.runtime

/** Pure owner state. Preview edits are transactional; only a commit enters bounded Undo history. */
internal class MeasureEditor {
    var revision = 0L; private set
    var measurement: Measurement? = null; private set
    var sideMm: Double? = null; private set
    private var plane: MeasurePlane? = null
    private val history = mutableListOf<Measurement?>()
    private data class Drag(val id: Int, val endpoint: MeasureEndpoint, val before: Measurement)
    private var drag: Drag? = null
    val isDragging get() = drag != null
    val canUndo get() = history.isNotEmpty()
    fun reset() { revision++; measurement = null; sideMm = null; plane = null; history.clear(); drag = null }
    fun calibrate(corners: List<MeasurePoint>, side: Double) {
        checkRule(side.isFinite() && side in 10.0..300.0, "SIZE_INVALID", "Enter a marker side from 10 to 300 mm.")
        val next = MeasurePlane(corners)
        reset(); plane = next; sideMm = side
    }
    private fun remember(value: Measurement?) { if (history.size == 10) history.removeAt(0); history.add(value) }
    private fun labelled(a: MeasurePoint, b: MeasurePoint?): Measurement {
        val p = plane ?: throw ConstructError("SIZE_INVALID", "Confirm the marker size first.")
        p.project(a)
        return Measurement(1, a, b, b?.let { java.lang.String.format(java.util.Locale.ROOT,"Length: %.1f cm",p.lengthMm(a,it,sideMm!!)/10) })
    }
    private inline fun edit(token: Long, block: () -> Unit): EditResult {
        if (token != revision) return EditResult.Rejected("This photo or calibration has changed.")
        if (plane == null) return EditResult.Rejected("Confirm the marker size first.")
        return try { block(); EditResult.Accepted } catch (e: ConstructError) { EditResult.Rejected(e.message ?: "Choose another point.") }
    }
    fun place(token: Long, point: MeasurePoint): EditResult = edit(token) {
        checkRule(drag == null,"POINT_INVALID","Finish the current adjustment first.")
        val previous = measurement
        checkRule(previous?.b == null,"POINT_INVALID","Drag an endpoint to adjust, or Clear to measure another length.")
        val next = if (previous == null) labelled(point,null) else labelled(previous.a,point)
        remember(previous); measurement = next
    }
    fun move(request: MoveRequest): EditResult = edit(request.photoRevision) {
        val current = measurement ?: throw ConstructError("POINT_INVALID","Place an endpoint first.")
        checkRule(current.id == request.id && current.point(request.endpoint) != null,"POINT_INVALID","Endpoint is no longer available.")
        if (request.phase == DragPhase.BEGIN) {
            checkRule(drag == null,"POINT_INVALID","Finish the current adjustment first.")
            drag = Drag(request.id,request.endpoint,current)
        } else {
            val active = drag ?: throw ConstructError("POINT_INVALID","Adjustment is no longer active.")
            checkRule(active.id == request.id && active.endpoint == request.endpoint,"POINT_INVALID","Endpoint changed during adjustment.")
            when (request.phase) {
                DragPhase.CANCEL -> { measurement = active.before; drag = null }
                DragPhase.PREVIEW, DragPhase.COMMIT -> {
                    val point = request.point ?: throw ConstructError("POINT_INVALID","Missing endpoint.")
                    val next = if (request.endpoint == MeasureEndpoint.A) labelled(point,current.b) else labelled(current.a,point)
                    measurement = next
                    if (request.phase == DragPhase.COMMIT) { if (next != active.before) remember(active.before); drag = null }
                }
                else -> Unit
            }
        }
    }
    fun cancelDrag() { drag?.let { measurement = it.before }; drag = null }
    fun undo() { cancelDrag(); if (history.isNotEmpty()) measurement = history.removeAt(history.lastIndex) }
    fun clear() { cancelDrag(); if (measurement != null) { remember(measurement); measurement = null } }
}
