package dev.construct.runtime

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlin.math.*

internal data class SkyTile(val z: Int,val x: Int,val y: Int)

/** Marker palette: dark ink with a light halo reads on pale cartography; amber marks age, jade marks selection. */
private object SkyInk {
    val fresh=ConstructColors.jadeInk
    val stale=ConstructColors.amber
    val halo=Color.White
    val selection=ConstructColors.jade
    val ring=Color(0xFF1E8C63)
    val loading=ConstructColors.surface2
}

@Composable internal fun SkyMap(network: SkyNetwork, center: SkyPoint, radius: Int, aircraft: List<SkyAircraft>,
    selected: String?, now: Double, onSelect: (String) -> Unit, onSearch: (SkyPoint) -> Unit, enabled: Boolean,
    modifier: Modifier=Modifier) {
    var view by remember(center) { mutableStateOf(center) }
    var zoom by remember(center,radius) { mutableIntStateOf(when(radius) { 10->10; 25->9; 50->8; else->7 }) }
    var dimensions by remember { mutableStateOf(IntSize.Zero) }
    val bitmaps=remember(network) { mutableStateMapOf<SkyTile,ImageBitmap>() }
    var tileError by remember { mutableStateOf(false) }
    val tilePixels=with(LocalDensity.current) { 256.dp.toPx().toDouble() }
    val world=tilePixels*(1 shl zoom)
    val cx=SkyProjection.x(view.lon)*world; val cy=SkyProjection.y(view.lat)*world
    val left=cx-dimensions.width/2; val top=cy-dimensions.height/2
    val placements=remember(view,zoom,dimensions,tilePixels) {
        if(dimensions.width==0) emptyList() else buildList {
            for(y in floor(top/tilePixels).toInt()..floor((top+dimensions.height)/tilePixels).toInt())
                for(x in floor(left/tilePixels).toInt()..floor((left+dimensions.width)/tilePixels).toInt()) {
                    val n=1 shl zoom
                    if(y in 0 until n) add(Triple(SkyTile(zoom,((x%n)+n)%n,y),x,y))
                }
        }.take(64)
    }
    LaunchedEffect(network,placements) {
        // Wait for a pan burst to settle; fetch only its final visible viewport.
        delay(180)
        tileError=false
        val needed=placements.map { it.first }.toSet()
        bitmaps.keys.filter { it !in needed }.toList().forEach { bitmaps.remove(it) }
        for(tile in needed) {
            ensureActive()
            if(tile !in bitmaps) try {
                val bitmap=withContext(network.tileDispatcher) { network.tile(tile.z,tile.x,tile.y).asImageBitmap() }
                ensureActive(); bitmaps[tile]=bitmap
            } catch(e: kotlinx.coroutines.CancellationException) { throw e }
            catch(_: Exception) { tileError=true }
        }
    }
    fun screen(p: SkyPoint)=Offset((dimensions.width/2+SkyProjection.deltaX(SkyProjection.x(p.lon),SkyProjection.x(view.lon))*world).toFloat(),
        (dimensions.height/2+(SkyProjection.y(p.lat)-SkyProjection.y(view.lat))*world).toFloat())
    val measurer=rememberTextMeasurer()
    val labelStyle=TextStyle(fontSize=12.sp,fontWeight=FontWeight.SemiBold,color=ConstructColors.text)
    val panned=SkyData.distance(center,view)>0.1
    Box(modifier.clipToBounds().background(SkyInk.loading)) {
        Canvas(Modifier.fillMaxSize().onSizeChanged { dimensions=it }
            .semantics { contentDescription="Aircraft map. North is up. Drag to pan; zoom buttons and aircraft list are available." }
            .pointerInput(view,zoom,aircraft) { detectTapGestures { tap ->
                aircraft.minByOrNull { (screen(it.point)-tap).getDistance() }?.let { if((screen(it.point)-tap).getDistance()<36.dp.toPx()) onSelect(it.key) }
            } }
            .pointerInput(zoom,tilePixels) { detectDragGestures { change,drag ->
                change.consume()
                view=SkyProjection.point(SkyProjection.x(view.lon)-drag.x/world,SkyProjection.y(view.lat)-drag.y/world)
            } }) {
            placements.forEach { (tile,x,y) -> bitmaps[tile]?.let { drawImage(it,dstOffset=IntOffset((x*tilePixels-left).roundToInt(),(y*tilePixels-top).roundToInt()),dstSize=IntSize(tilePixels.roundToInt(),tilePixels.roundToInt())) } }
            val origin=screen(center)
            val radiusPx=(radius*1000/(cos(Math.toRadians(center.lat))*40075016.686)*world).toFloat()
            // Search radius: a soft halo keeps it legible over both pale land and blue water.
            drawCircle(SkyInk.halo.copy(alpha=0.55f),radiusPx,origin,style=Stroke(5.dp.toPx()))
            drawCircle(SkyInk.ring,radiusPx,origin,style=Stroke(2.dp.toPx()))
            // Ordinary markers first, then the selection on top so it is never hidden by neighbours.
            val chosen=aircraft.firstOrNull { it.key==selected }
            aircraft.forEach { a -> if(a.key!=selected) marker(a,screen(a.point),now,false) }
            chosen?.let { a ->
                val p=screen(a.point)
                if(!SkyProjection.markerVisible(p.x,p.y,size.width,size.height)) return@let
                marker(a,p,now,true)
                // Ellipsize to the viewport and keep clamp bounds ordered, so a narrow map never throws.
                val margin=4.dp.toPx(); val pad=6.dp.toPx()
                val maxLabel=(size.width-2*margin-2*pad).toInt().coerceAtLeast(1)
                val text=measurer.measure(a.label,labelStyle,overflow=TextOverflow.Ellipsis,maxLines=1,constraints=Constraints(maxWidth=maxLabel))
                val w=text.size.width+pad*2; val h=text.size.height+pad
                val x=(p.x-w/2).coerceIn(margin,max(margin,size.width-w-margin))
                val y=if(p.y-24.dp.toPx()-h<0) p.y+22.dp.toPx() else p.y-24.dp.toPx()-h
                drawRoundRect(ConstructColors.surface.copy(alpha=0.94f),Offset(x,y),Size(w,h),CornerRadius(h/2))
                drawRoundRect(SkyInk.selection,Offset(x,y),Size(w,h),CornerRadius(h/2),style=Stroke(1.dp.toPx()))
                drawText(text,topLeft=Offset(x+pad,y+pad/2))
            }
            // Search centre: light ring, dark rim, jade heart.
            drawCircle(SkyInk.halo,8.dp.toPx(),origin); drawCircle(SkyInk.fresh,6.5f.dp.toPx(),origin); drawCircle(SkyInk.selection,4.dp.toPx(),origin)
        }
        MapChip(Modifier.align(Alignment.TopStart).padding(8.dp)) { Text("N ↑",style=MaterialTheme.typography.labelMedium,color=ConstructColors.text) }
        Column(Modifier.align(Alignment.TopEnd).padding(8.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
            MapButton("Zoom in",enabled=zoom<13,onClick={ if(zoom<13) zoom++ }) { Icon(Icons.Filled.Add,contentDescription=null) }
            MapButton("Zoom out",enabled=zoom>2,onClick={ if(zoom>2) zoom-- }) { Text("−",style=MaterialTheme.typography.titleLarge) }
            MapButton("Center",enabled=true,onClick={ view=center }) { Icon(Icons.Filled.LocationOn,contentDescription=null) }
        }
        if(tileError) MapChip(Modifier.align(Alignment.TopCenter).padding(top=8.dp),tone=ConstructColors.amber) {
            Text("Map tiles unavailable · aircraft still shown",style=MaterialTheme.typography.labelSmall,color=ConstructColors.amber)
        }
        Column(Modifier.align(Alignment.BottomCenter).fillMaxWidth().padding(8.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(6.dp)) {
            if(panned) Button(onClick={ onSearch(view) },enabled=enabled,
                colors=ButtonDefaults.buttonColors(containerColor=ConstructColors.jade,contentColor=ConstructColors.jadeInk,
                    disabledContainerColor=ConstructColors.surface2,disabledContentColor=ConstructColors.disabled)) {
                Icon(Icons.Filled.Search,contentDescription=null,modifier=Modifier.size(18.dp)); Spacer(Modifier.width(6.dp)); Text("Search here")
            }
            Box(Modifier.fillMaxWidth(),contentAlignment=Alignment.BottomEnd) {
                MapChip { Text("© OpenStreetMap contributors · openstreetmap.org/copyright",style=MaterialTheme.typography.labelSmall,color=ConstructColors.muted) }
            }
        }
    }
}

/** Aircraft glyph: ground-track arrow, or a neutral dot when the track is unknown. */
private fun DrawScope.marker(a: SkyAircraft, p: Offset, now: Double, chosen: Boolean) {
    if(!SkyProjection.markerVisible(p.x,p.y,size.width,size.height)) return
    val stale=a.age(now)>SkyData.STALE_AGE
    val fill=if(stale) SkyInk.stale else SkyInk.fresh
    val outline=if(stale) SkyInk.fresh else SkyInk.halo
    if(chosen) { drawCircle(SkyInk.selection.copy(alpha=0.35f),20.dp.toPx(),p); drawCircle(SkyInk.selection,15.dp.toPx(),p,style=Stroke(2.dp.toPx())) }
    val r=(if(chosen) 11.dp else 10.dp).toPx()
    skyGlyph(SkyIdentity.kind(a),a.track,p,r,fill,outline)
}

/** Shape is model/category evidence; rotation is ground track, never inferred nose direction. */
internal fun DrawScope.skyGlyph(kind: SkyKind,track: Double?,p: Offset,r: Float,fill: Color,outline: Color) {
    if(track==null) {
        drawCircle(outline,r*0.7f,p); drawCircle(fill,r*0.5f,p)
    } else rotate(track.toFloat(),p) {
        val path=Path().apply {
            when(kind) {
                SkyKind.ROTORCRAFT -> {
                    moveTo(p.x,p.y-r); lineTo(p.x+r*0.3f,p.y-r*0.3f); lineTo(p.x+r,p.y-r*0.2f)
                    lineTo(p.x+r,p.y+r*0.05f); lineTo(p.x+r*0.25f,p.y+r*0.05f); lineTo(p.x+r*0.1f,p.y+r)
                    lineTo(p.x-r*0.1f,p.y+r); lineTo(p.x-r*0.25f,p.y+r*0.05f); lineTo(p.x-r,p.y+r*0.05f)
                    lineTo(p.x-r,p.y-r*0.2f); lineTo(p.x-r*0.3f,p.y-r*0.3f)
                }
                SkyKind.JET,SkyKind.BUSINESS,SkyKind.TURBOPROP,SkyKind.PISTON,SkyKind.GLIDER -> {
                    val wing=if(kind==SkyKind.GLIDER) 1.15f else 1f
                    moveTo(p.x,p.y-r); lineTo(p.x+r*0.18f,p.y-r*0.3f); lineTo(p.x+r*wing,p.y+r*0.25f)
                    lineTo(p.x+r*wing,p.y+r*0.45f); lineTo(p.x+r*0.16f,p.y+r*0.1f); lineTo(p.x+r*0.12f,p.y+r*0.7f)
                    lineTo(p.x+r*0.4f,p.y+r); lineTo(p.x-r*0.4f,p.y+r); lineTo(p.x-r*0.12f,p.y+r*0.7f)
                    lineTo(p.x-r*0.16f,p.y+r*0.1f); lineTo(p.x-r*wing,p.y+r*0.45f); lineTo(p.x-r*wing,p.y+r*0.25f)
                    lineTo(p.x-r*0.18f,p.y-r*0.3f)
                }
                else -> { moveTo(p.x,p.y-r); lineTo(p.x+r*0.75f,p.y+r); lineTo(p.x,p.y+r*0.5f); lineTo(p.x-r*0.75f,p.y+r) }
            }
            close()
        }
        drawPath(path,outline,style=Stroke(3.dp.toPx())); drawPath(path,fill)
    }
}

@Composable private fun MapChip(modifier: Modifier=Modifier, tone: Color=ConstructColors.border, content: @Composable () -> Unit) {
    Surface(modifier,shape=RoundedCornerShape(10.dp),color=ConstructColors.surface.copy(alpha=0.92f),border=BorderStroke(1.dp,tone)) {
        Box(Modifier.padding(horizontal=8.dp,vertical=5.dp)) { content() }
    }
}

@Composable private fun MapButton(label: String, enabled: Boolean, onClick: () -> Unit, content: @Composable () -> Unit) {
    Surface(shape=CircleShape,color=ConstructColors.surface.copy(alpha=0.92f),border=BorderStroke(1.dp,if(enabled) ConstructColors.controlBorder else ConstructColors.border)) {
        IconButton(onClick=onClick,enabled=enabled,modifier=Modifier.size(44.dp).semantics { contentDescription=label },
            colors=IconButtonDefaults.iconButtonColors(contentColor=ConstructColors.text,disabledContentColor=ConstructColors.disabled)) { content() }
    }
}
