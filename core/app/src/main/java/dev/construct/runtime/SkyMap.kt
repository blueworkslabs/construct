package dev.construct.runtime

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlin.math.*

internal data class SkyTile(val z: Int,val x: Int,val y: Int)
@Composable internal fun SkyMap(network: SkyNetwork, center: SkyPoint, radius: Int, aircraft: List<SkyAircraft>,
    selected: String?, now: Double, onSelect: (String) -> Unit, onSearch: (SkyPoint) -> Unit, enabled: Boolean,
    modifier: Modifier=Modifier) {
    var view by remember(center) { mutableStateOf(center) }
    var zoom by remember(center,radius) { mutableIntStateOf(when(radius) { 10->10; 25->9; 50->8; else->7 }) }
    var dimensions by remember { mutableStateOf(IntSize.Zero) }
    val bitmaps=remember(network) { mutableStateMapOf<SkyTile,ImageBitmap>() }
    var tileError by remember { mutableStateOf(false) }
    val world=256.0*(1 shl zoom)
    val cx=SkyProjection.x(view.lon)*world; val cy=SkyProjection.y(view.lat)*world
    val left=cx-dimensions.width/2; val top=cy-dimensions.height/2
    val placements=remember(view,zoom,dimensions) {
        if(dimensions.width==0) emptyList() else buildList {
            for(y in floor(top/256).toInt()..floor((top+dimensions.height)/256).toInt())
                for(x in floor(left/256).toInt()..floor((left+dimensions.width)/256).toInt()) {
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
    Box(modifier.background(Color(0xFF15251F))) {
        Canvas(Modifier.fillMaxSize().onSizeChanged { dimensions=it }
            .semantics { contentDescription="Aircraft map. North is up. Drag to pan; zoom buttons and aircraft list are available." }
            .pointerInput(view,zoom,aircraft) { detectTapGestures { tap ->
                aircraft.minByOrNull { (screen(it.point)-tap).getDistance() }?.let { if((screen(it.point)-tap).getDistance()<36.dp.toPx()) onSelect(it.key) }
            } }
            .pointerInput(zoom) { detectDragGestures { change,drag ->
                change.consume()
                view=SkyProjection.point(SkyProjection.x(view.lon)-drag.x/world,SkyProjection.y(view.lat)-drag.y/world)
            } }) {
            placements.forEach { (tile,x,y) -> bitmaps[tile]?.let { drawImage(it,dstOffset=IntOffset((x*256-left).roundToInt(),(y*256-top).roundToInt()),dstSize=IntSize(256,256)) } }
            val origin=screen(center)
            val radiusPx=radius*1000/(cos(Math.toRadians(center.lat))*40075016.686)*world
            drawCircle(Color(0xFF086F4F),radiusPx.toFloat(),origin,style=Stroke(2.dp.toPx()))
            drawCircle(Color.White,7.dp.toPx(),origin); drawCircle(Color(0xFF1268A1),5.dp.toPx(),origin)
            aircraft.forEach { a ->
                val p=screen(a.point)
                if(p.x in -30f..(size.width+30) && p.y in -30f..(size.height+30)) {
                    val chosen=a.key==selected
                    val color=if(a.age(now)>SkyData.STALE_AGE) Color(0xFF795C16) else Color(0xFF073B2B)
                    if(chosen) drawCircle(Color(0xFFFFCD54),16.dp.toPx(),p)
                    val r=10.dp.toPx()
                    rotate((a.track ?: 0.0).toFloat(),p) {
                        val path=Path().apply { moveTo(p.x,p.y-r); lineTo(p.x+r*0.75f,p.y+r); lineTo(p.x,p.y+r*0.5f); lineTo(p.x-r*0.75f,p.y+r); close() }
                        drawPath(path,Color.White,style=Stroke(3.dp.toPx())); drawPath(path,color)
                    }
                }
            }
        }
        Text("N ↑",Modifier.align(Alignment.TopStart).padding(8.dp).background(MaterialTheme.colorScheme.surface).padding(5.dp))
        Column(Modifier.align(Alignment.TopEnd).padding(6.dp),horizontalAlignment=Alignment.End) {
            FilledTonalButton(onClick={ if(zoom<13) zoom++ },enabled=zoom<13,modifier=Modifier.semantics { contentDescription="Zoom in" }) { Text("+") }
            FilledTonalButton(onClick={ if(zoom>2) zoom-- },enabled=zoom>2,modifier=Modifier.semantics { contentDescription="Zoom out" }) { Text("−") }
            FilledTonalButton(onClick={ view=center }) { Text("Center") }
        }
        if(SkyData.distance(center,view)>0.1) Button(onClick={ onSearch(view) },enabled=enabled,modifier=Modifier.align(Alignment.BottomCenter).padding(bottom=30.dp)) { Text("Search here") }
        if(tileError) Text("Map tiles unavailable · aircraft still shown",Modifier.align(Alignment.TopCenter).background(MaterialTheme.colorScheme.surface).padding(6.dp),style=MaterialTheme.typography.labelSmall)
        Text("© OpenStreetMap contributors · openstreetmap.org/copyright",Modifier.align(Alignment.BottomStart).fillMaxWidth().background(MaterialTheme.colorScheme.surface.copy(alpha=0.94f)).padding(4.dp),style=MaterialTheme.typography.labelSmall)
    }
}
