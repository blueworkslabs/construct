package dev.construct.runtime

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.input.pointer.PointerInputChange
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalViewConfiguration
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.ui.layout.onSizeChanged
import kotlin.math.atan2
import kotlin.math.hypot

/** Transient gesture bookkeeping. Owner-accepted positions are the only ones drawn. */
private data class DragState(val revision: Long, val hit: HandleHit, val start: MeasurePoint, val finger: Offset, val accepted: MeasurePoint)

/**
 * Photo-space overlay: draws the photo, marker outline, the measurement and its handles,
 * and turns taps/drags/pinches into owner callbacks in normalised photo coordinates.
 * Zoom and pan are local display state; they never change photo coordinates.
 */
@Composable
fun MeasureOverlay(
    photo: ImageBitmap,
    photoRevision: Long,
    enabled: Boolean,
    corners: List<MeasurePoint>,
    measurements: List<Measurement>,
    selectedId: Int?,
    onPlace: (photoRevision: Long, MeasurePoint) -> EditResult,
    onMove: (MoveRequest) -> EditResult,
    onSelect: (photoRevision: Long, id: Int?) -> Unit,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current
    val touchSlop = LocalViewConfiguration.current.touchSlop
    val handleRadius = with(density) { 24.dp.toPx() }
    val loupeDiameter = with(density) { 96.dp.toPx() }
    val loupeLift = with(density) { 72.dp.toPx() }
    val textMeasurer = rememberTextMeasurer()

    var viewport by remember(photoRevision) { mutableStateOf<MeasureViewport?>(null) }
    var drag by remember(photoRevision) { mutableStateOf<DragState?>(null) }
    var lastTap by remember(photoRevision) { mutableStateOf(0L to Offset.Zero) }

    fun fitted(size: IntSize) = MeasureViewport.forView(photo.width, photo.height, size.width.toFloat(), size.height.toFloat())
    fun currentViewport(size: IntSize): MeasureViewport {
        val existing = viewport
        if (existing != null && existing.viewWidth == size.width.toFloat() && existing.viewHeight == size.height.toFloat()) return existing
        // Size changes (rotation, sheet) reset the fit but never the owner's photo-space points.
        return fitted(size).also { viewport = it }
    }

    Canvas(
        modifier
            .fillMaxSize()
            .onSizeChanged { size -> if (size.width > 0 && size.height > 0) currentViewport(size) }
            .semantics { contentDescription = "Measurement photo: tap to place an endpoint, drag a handle to adjust" }
            .pointerInput(photoRevision, enabled) {
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    val vp = currentViewport(size)
                    val revision = photoRevision
                    val startPosition = down.position
                    var pastSlop = false
                    var pinching = false
                    var previous = listOf(down.position)
                    var previousDistance = 0f

                    // A finger that lands on a handle starts a drag immediately; the owner records the pre-drag value.
                    val hit = if (enabled) vp.hitTest(measurements, selectedId, startPosition.x, startPosition.y, handleRadius) else null
                    val startPoint = hit?.let { h -> measurements.firstOrNull { it.id == h.id }?.point(h.endpoint) }
                    if (hit != null && startPoint != null) {
                        onSelect(revision, hit.id)
                        if (onMove(MoveRequest(revision, hit.id, hit.endpoint, DragPhase.BEGIN, null)) is EditResult.Accepted) {
                            drag = DragState(revision, hit, startPoint, startPosition, startPoint)
                        }
                    }
                    down.consume()

                    fun cancelDrag() {
                        val active = drag ?: return
                        onMove(MoveRequest(active.revision, active.hit.id, active.hit.endpoint, DragPhase.CANCEL, null))
                        drag = null
                    }

                    while (true) {
                        val event = awaitPointerEvent()
                        val pressed = event.changes.filter { it.pressed }
                        if (pressed.isEmpty()) {
                            val active = drag
                            when {
                                active != null -> {
                                    // Commit the last owner-accepted preview; a rejected final position is never committed.
                                    val result = onMove(MoveRequest(active.revision, active.hit.id, active.hit.endpoint, DragPhase.COMMIT, active.accepted))
                                    if (result !is EditResult.Accepted) cancelDrag()
                                    drag = null
                                }
                                !pastSlop && !pinching && hit == null -> {
                                    val now = System.currentTimeMillis()
                                    val (lastTime, lastPosition) = lastTap
                                    val doubleTap = now - lastTime < 300 && (lastPosition - startPosition).getDistance() < touchSlop * 2
                                    lastTap = now to startPosition
                                    if (doubleTap) {
                                        // Double tap toggles 1× / 3× around the tap; it never places a point.
                                        viewport = if (vp.scale > 1.01f) vp.reset() else vp.zoomedBy(3f / vp.scale, startPosition.x, startPosition.y)
                                        lastTap = 0L to Offset.Zero
                                    } else if (enabled) {
                                        val point = vp.toPhoto(startPosition.x, startPosition.y)
                                        if (point != null) onPlace(revision, point) else onSelect(revision, null)
                                    }
                                }
                            }
                            event.changes.forEach(PointerInputChange::consume)
                            break
                        }
                        if (pressed.size >= 2) {
                            // A second finger cancels any drag and never commits a placement.
                            if (drag != null) cancelDrag()
                            pinching = true; pastSlop = true
                            val a = pressed[0].position; val b = pressed[1].position
                            val distance = hypot(a.x - b.x, a.y - b.y)
                            val centroid = Offset((a.x + b.x) / 2, (a.y + b.y) / 2)
                            if (previous.size == 2 && previousDistance > 0f) {
                                val previousCentroid = Offset((previous[0].x + previous[1].x) / 2, (previous[0].y + previous[1].y) / 2)
                                val current = viewport ?: vp
                                viewport = current.zoomedBy(distance / previousDistance, centroid.x, centroid.y)
                                    .pannedBy(centroid.x - previousCentroid.x, centroid.y - previousCentroid.y)
                            }
                            previous = listOf(a, b); previousDistance = distance
                            event.changes.forEach(PointerInputChange::consume)
                            continue
                        }
                        val position = pressed[0].position
                        val active = drag
                        if (active != null) {
                            // Crossing the photo edge leaves the handle at the last accepted position; nothing is clamped.
                            val candidate = (viewport ?: vp).toPhoto(position.x, position.y)
                            var accepted = active.accepted
                            if (candidate != null) {
                                val result = onMove(MoveRequest(active.revision, active.hit.id, active.hit.endpoint, DragPhase.PREVIEW, candidate))
                                if (result is EditResult.Accepted) accepted = candidate
                            }
                            drag = active.copy(finger = position, accepted = accepted)
                        } else if (!pinching) {
                            if (!pastSlop && (position - startPosition).getDistance() > touchSlop) pastSlop = true
                            if (pastSlop && previous.size == 1) {
                                val current = viewport ?: vp
                                if (current.scale > 1f) viewport = current.pannedBy(position.x - previous[0].x, position.y - previous[0].y)
                            }
                        }
                        previous = listOf(position)
                        event.changes.forEach(PointerInputChange::consume)
                    }
                }
            }
    ) {
        // Never write state during draw: read the sized viewport, or a local fit before onSizeChanged has run.
        val drawSize = IntSize(size.width.toInt(), size.height.toInt())
        val vp = viewport?.takeIf { it.viewWidth == size.width && it.viewHeight == size.height } ?: fitted(drawSize)
        val stroke = 3.dp.toPx()
        val halo = 7.dp.toPx()
        fun screen(p: MeasurePoint) = Offset(vp.toScreenX(p.x), vp.toScreenY(p.y))

        drawImage(photo, dstOffset = IntOffset(vp.left.toInt(), vp.top.toInt()), dstSize = IntSize(vp.width.toInt(), vp.height.toInt()))

        if (corners.size == 4) {
            val path = Path().apply { corners.forEachIndexed { i, c -> if (i == 0) moveTo(screen(c).x, screen(c).y) else lineTo(screen(c).x, screen(c).y) }; close() }
            drawPath(path, Color.Black.copy(alpha = .6f), style = Stroke(halo))
            drawPath(path, Color.Cyan, style = Stroke(stroke))
            corners.forEach { drawCircle(Color.Cyan, 4.dp.toPx(), screen(it)) }
        }

        val activeDrag = drag
        for (measurement in measurements) {
            val selected = measurement.id == selectedId
            val colour = if (selected) Color(0xFFFFD84A) else Color(0xFF7AD0FF).copy(alpha = .8f)
            // Draw the owner's accepted positions; only the dragged endpoint follows the accepted preview.
            fun shown(endpoint: MeasureEndpoint): MeasurePoint? {
                val base = measurement.point(endpoint) ?: return null
                return if (activeDrag != null && activeDrag.hit.id == measurement.id && activeDrag.hit.endpoint == endpoint) activeDrag.accepted else base
            }
            val a = shown(MeasureEndpoint.A) ?: continue
            val b = shown(MeasureEndpoint.B)
            if (b != null) {
                drawLine(Color.Black.copy(alpha = .7f), screen(a), screen(b), halo)
                drawLine(colour, screen(a), screen(b), stroke)
                measurement.label?.let { label -> drawLabel(textMeasurer, label, screen(a), screen(b), colour) }
            }
            drawHandle(textMeasurer, screen(a), colour, "A", b?.let { screen(it) })
            if (b != null) drawHandle(textMeasurer, screen(b), colour, "B", screen(a))
        }

        activeDrag?.let { drawLoupe(photo, vp, it, loupeDiameter, loupeLift) }
    }
}

private fun DrawScope.drawHandle(textMeasurer: androidx.compose.ui.text.TextMeasurer, at: Offset, colour: Color, text: String, other: Offset?) {
    drawCircle(Color.Black.copy(alpha = .7f), 8.dp.toPx(), at)
    drawCircle(colour, 6.dp.toPx(), at)
    // Label sits away from the line and above the finger so it is never covered.
    val direction = other?.let { o -> val dx = at.x - o.x; val dy = at.y - o.y; val len = hypot(dx, dy); if (len > 0f) Offset(dx / len, dy / len) else null }
        ?: Offset(0f, -1f)
    val layout = textMeasurer.measure(text, TextStyle(fontSize = 12.sp, fontWeight = FontWeight.Bold))
    val offset = 16.dp.toPx()
    val position = Offset(at.x + direction.x * offset - layout.size.width / 2f, at.y + direction.y * offset - layout.size.height / 2f)
    drawRoundRect(Color.Black.copy(alpha = .75f), Offset(position.x - 4.dp.toPx(), position.y - 2.dp.toPx()),
        Size(layout.size.width + 8.dp.toPx(), layout.size.height + 4.dp.toPx()), androidx.compose.ui.geometry.CornerRadius(6.dp.toPx()))
    drawText(layout, colour, position)
}

private fun DrawScope.drawLabel(textMeasurer: androidx.compose.ui.text.TextMeasurer, label: String, a: Offset, b: Offset, colour: Color) {
    val layout = textMeasurer.measure(label, TextStyle(fontSize = 14.sp, fontWeight = FontWeight.Bold))
    val mid = Offset((a.x + b.x) / 2, (a.y + b.y) / 2)
    // Push the pill perpendicular to the line so it does not sit on top of it.
    val angle = atan2(b.y - a.y, b.x - a.x)
    val normal = Offset(-kotlin.math.sin(angle), kotlin.math.cos(angle))
    val lift = 18.dp.toPx() * if (normal.y < 0) 1f else -1f
    val position = Offset(mid.x + normal.x * lift - layout.size.width / 2f, mid.y + normal.y * lift - layout.size.height / 2f)
    drawRoundRect(Color.Black.copy(alpha = .8f), Offset(position.x - 8.dp.toPx(), position.y - 4.dp.toPx()),
        Size(layout.size.width + 16.dp.toPx(), layout.size.height + 8.dp.toPx()), androidx.compose.ui.geometry.CornerRadius(12.dp.toPx()))
    drawText(layout, colour, position)
}

private fun DrawScope.drawLoupe(photo: ImageBitmap, vp: MeasureViewport, drag: DragState, diameter: Float, lift: Float) {
    val magnification = 2.5f
    val radius = diameter / 2
    // Above the finger, flipped below when there is no room at the top edge.
    val centre = if (drag.finger.y - lift - radius >= 0f) Offset(drag.finger.x, drag.finger.y - lift) else Offset(drag.finger.x, drag.finger.y + lift)
    val source = vp.loupeSource(drag.accepted, photo.width, photo.height, diameter, magnification)
    val srcLeft = source[0].coerceIn(0, photo.width - 1); val srcTop = source[1].coerceIn(0, photo.height - 1)
    val srcWidth = source[2].coerceAtMost(photo.width - srcLeft); val srcHeight = source[3].coerceAtMost(photo.height - srcTop)
    // Keep the crop centred on the point even near photo edges by shifting the destination.
    val shiftX = (source[0] - srcLeft) * (diameter / source[2]); val shiftY = (source[1] - srcTop) * (diameter / source[3])
    val clip = Path().apply { addOval(androidx.compose.ui.geometry.Rect(centre - Offset(radius, radius), Size(diameter, diameter))) }
    drawCircle(Color.Black.copy(alpha = .6f), radius + 3.dp.toPx(), centre)
    clipPath(clip) {
        drawRect(Color(0xFF172D29), centre - Offset(radius, radius), Size(diameter, diameter))
        drawImage(photo, srcOffset = IntOffset(srcLeft, srcTop), srcSize = IntSize(srcWidth, srcHeight),
            dstOffset = IntOffset((centre.x - radius + shiftX).toInt(), (centre.y - radius + shiftY).toInt()),
            dstSize = IntSize((srcWidth * diameter / source[2]).toInt(), (srcHeight * diameter / source[3]).toInt()))
        val arm = radius * .7f
        drawLine(Color.Black.copy(alpha = .6f), Offset(centre.x - arm, centre.y), Offset(centre.x + arm, centre.y), 3.dp.toPx())
        drawLine(Color.Black.copy(alpha = .6f), Offset(centre.x, centre.y - arm), Offset(centre.x, centre.y + arm), 3.dp.toPx())
        drawLine(Color(0xFFFFD84A), Offset(centre.x - arm, centre.y), Offset(centre.x + arm, centre.y), 1.dp.toPx())
        drawLine(Color(0xFFFFD84A), Offset(centre.x, centre.y - arm), Offset(centre.x, centre.y + arm), 1.dp.toPx())
        drawCircle(Color(0xFFFFD84A), 5.dp.toPx(), centre, style = Stroke(1.5f.dp.toPx()))
    }
    drawCircle(Color.White, radius, centre, style = Stroke(2.dp.toPx()))
}
