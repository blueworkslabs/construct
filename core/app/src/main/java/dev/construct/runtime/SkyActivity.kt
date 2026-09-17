package dev.construct.runtime

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/** A foreground human-operated map, never a location/network bridge to JavaScript. */
class SkyActivity : ComponentActivity() {
    companion object {
        private val launched=AtomicBoolean(false)
        private val worker=Executors.newSingleThreadExecutor()
        private val workerBusy=AtomicBoolean(false)
        private const val AUTO_SECONDS=30
        fun validate(params: JSONObject) {
            checkRule(params.keys().asSequence().toSet()==setOf("op") && params.optString("op")=="open", "INVALID_PARAMS","Sky Watch supports opening its native workspace only.")
        }
        fun open(context: Context,store: ModuleStore,installed: Installed,params: JSONObject) {
            validate(params); store.withCapability(installed,"sky.watch") { }
            checkRule(launched.compareAndSet(false,true),"SKY_BUSY","Sky Watch is already open.")
            try { context.startActivity(Intent(context,SkyActivity::class.java).putExtra("module",installed.manifest.id).putExtra("digest",installed.digest)) }
            catch(_: Exception) { launched.set(false); throw ConstructError("SKY_UNAVAILABLE","Could not open Sky Watch.") }
        }
    }
    private lateinit var store: ModuleStore
    private lateinit var installed: Installed
    private lateinit var network: SkyNetwork
    @Volatile private var live=false
    private val handler=Handler(Looper.getMainLooper())
    private var listener: LocationListener?=null
    private var center by mutableStateOf<SkyPoint?>(null)
    private var mode by mutableStateOf(SkyMode.ADSB)
    private var radius by mutableIntStateOf(25)
    private var feeds by mutableStateOf(emptyList<SkyFeed>())
    private var busy by mutableStateOf(false)
    private var locating by mutableStateOf(false)
    private var status by mutableStateOf("Choose an area to begin.")
    private var statusTone by mutableStateOf(WorkshopTone.NEUTRAL)
    private var updatedAt by mutableStateOf<Double?>(null)
    private var nextAutoAt by mutableStateOf<Double?>(null)
    private var locationLabel by mutableStateOf("Chosen area")
    private var auto by mutableStateOf(true)
    private var selected by mutableStateOf<String?>(null)
    private var showArea by mutableStateOf(false)
    private var latText by mutableStateOf("")
    private var lonText by mutableStateOf("")
    private var now by mutableDoubleStateOf(System.currentTimeMillis()/1000.0)
    private var generation=0
    private val infoWorker=Executors.newSingleThreadExecutor()
    private var infoTarget by mutableStateOf<SkyAircraft?>(null)
    private var infoResult by mutableStateOf<SkyMetadataResult?>(null)
    private var infoBusy by mutableStateOf(false)
    private var infoError by mutableStateOf<String?>(null)
    private var infoGeneration=0
    private val permission=registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        if(live && !isFinishing) {
            if(hasLocation()) locate() else note("Location permission not granted. Enter coordinates instead, or enable permission in Android Settings.",WorkshopTone.ERROR)
        }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Maps may be captured by the user; avoid retaining their location in Recents.
        if(android.os.Build.VERSION.SDK_INT>=33) setRecentsScreenshotEnabled(false)
        if(savedInstanceState!=null) { finish(); return }
        store=ModuleStore.shared(this)
        try {
            installed=store.inventory().modules.single { it.manifest.id==intent.getStringExtra("module") && it.digest==intent.getStringExtra("digest") }
            access()
        } catch(_: Exception) { finish(); return }
        network=SkyNetwork(this) { checkRule(live && !isFinishing,"SKY_CLOSED","Sky Watch is closed."); access() }
        setContent { ConstructTheme { Screen() } }
    }
    override fun onStart() { super.onStart(); live=true }
    override fun onStop() {
        live=false; generation++; infoGeneration++; infoTarget=null; infoResult=null; infoError=null; infoWorker.shutdownNow(); stopLocation(); feeds=emptyList(); center=null; selected=null; latText=""; lonText=""; updatedAt=null
        if(::network.isInitialized) network.close()
        super.onStop(); finish()
    }
    override fun onDestroy() { live=false; infoWorker.shutdownNow(); stopLocation(); if(::network.isInitialized) network.close(); launched.set(false); super.onDestroy() }
    private fun access() { store.withCapability(installed,"sky.watch") { } }
    private fun note(text: String,tone: WorkshopTone=WorkshopTone.NEUTRAL) { status=text; statusTone=tone }
    private fun hasLocation()=checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED
    private fun useLocation() {
        try {
            access()
            if(hasLocation()) locate() else {
                permission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION))
            }
        } catch(_: Exception) { note("Location unavailable. Enter coordinates instead.",WorkshopTone.ERROR) }
    }
    private fun stopLocation() {
        listener?.let { runCatching { (getSystemService(LOCATION_SERVICE) as LocationManager).removeUpdates(it) } }
        listener=null; locating=false; handler.removeCallbacksAndMessages(null)
    }
    @SuppressLint("MissingPermission") private fun locate() {
        stopLocation()
        try {
            access(); checkRule(hasLocation(),"SKY_LOCATION","Location permission is off.")
            val manager=getSystemService(LOCATION_SERVICE) as LocationManager
            val providers=listOf(LocationManager.NETWORK_PROVIDER,LocationManager.GPS_PROVIDER).filter { manager.isProviderEnabled(it) && (it!=LocationManager.GPS_PROVIDER || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED) }
            checkRule(providers.isNotEmpty(),"SKY_LOCATION","Turn on phone location, or enter coordinates.")
            locating=true; note("Finding your location…")
            val callback=object: LocationListener {
                override fun onLocationChanged(location: Location) {
                    if(!live || isFinishing || listener!==this) return
                    try {
                        access()
                        checkRule(hasLocation(),"SKY_LOCATION","Location permission is off.")
                        val age=(android.os.SystemClock.elapsedRealtimeNanos()-location.elapsedRealtimeNanos)/1e9
                        if(age !in 0.0..120.0 || !location.hasAccuracy() || location.accuracy<0 || location.accuracy>10000) return
                        val p=SkyPoint(location.latitude,location.longitude)
                        stopLocation(); locationLabel=String.format(Locale.ROOT,"Phone location ±%.0f m",location.accuracy)
                        choose(p,fromPhone=true)
                    } catch(_: Exception) { stopLocation(); note("Location could not be used. Enter coordinates instead.",WorkshopTone.ERROR) }
                }
                @Deprecated("Required on older Android") override fun onStatusChanged(provider: String?,status: Int,extras: Bundle?) { }
                override fun onProviderEnabled(provider: String) { }
                override fun onProviderDisabled(provider: String) { }
            }
            listener=callback
            var registered=false
            for(provider in providers) try { manager.requestLocationUpdates(provider,0L,0f,callback,Looper.getMainLooper()); registered=true } catch(_: SecurityException) { }
            checkRule(registered,"SKY_LOCATION","Location is unavailable.")
            handler.postDelayed({ if(listener===callback) { stopLocation(); note("No recent location fix. Try outdoors, or enter coordinates.",WorkshopTone.ATTENTION) } },25000)
        } catch(e: Exception) { stopLocation(); note((e as? ConstructError)?.message ?: "Location unavailable. Enter coordinates instead.",WorkshopTone.ERROR) }
    }
    private fun choose(p: SkyPoint,fromPhone: Boolean=false) {
        try { access() } catch(_: Exception) { finish(); return }
        stopLocation(); generation++; infoGeneration++; infoTarget=null; infoResult=null; center=p; feeds=emptyList(); selected=null; showArea=false; updatedAt=null
        if(!fromPhone) locationLabel="Chosen area"
        latText=String.format(Locale.ROOT,"%.5f",p.lat); lonText=String.format(Locale.ROOT,"%.5f",p.lon)
        refresh()
    }
    private fun enterArea() {
        // Keyboard Done must respect the same in-flight gate as Show aircraft.
        if(busy) return
        val a=latText.trim().replace(',','.').toDoubleOrNull(); val b=lonText.trim().replace(',','.').toDoubleOrNull()
        if(a==null || b==null || !a.isFinite() || !b.isFinite() || a !in -85.0..85.0 || b !in -180.0..180.0) {
            note("Enter latitude −85 to 85 and longitude −180 to 180.",WorkshopTone.ERROR); return
        }
        choose(SkyPoint(a,b))
    }
    private fun refresh() {
        val p=center ?: return
        if(!live || busy || isFinishing) return
        try { access() } catch(_: Exception) { finish(); return }
        if(!workerBusy.compareAndSet(false,true)) { note("Previous request is finishing. Tap Refresh shortly.",WorkshopTone.ATTENTION); return }
        val token=++generation; val requestedMode=mode; val requestedRadius=radius; val old=feeds
        busy=true; note("Updating aircraft…")
        worker.execute {
            try {
                val results=requestedMode.sources.map { source -> network.fetch(source,p,requestedRadius) }
                runOnUiThread {
                    if(live && token==generation && !isFinishing) try {
                        access(); feeds=SkyData.updateFeeds(old,results); now=System.currentTimeMillis()/1000.0
                        when { results.all { it.ok } -> { updatedAt=now; note("") }
                            results.any { it.ok } -> { updatedAt=now; note("Partial coverage · one source is unavailable",WorkshopTone.ATTENTION) }
                            else -> note("Could not refresh · recent cached positions may remain",WorkshopTone.ERROR) }
                    } catch(_: Exception) { finish() }
                    if(token==generation) busy=false
                }
            } finally { workerBusy.set(false) }
        }
    }
    /** Transient notes win; otherwise a live "Updated … ago" line with the next automatic refresh. */
    private fun statusLine(): String {
        if(status.isNotEmpty()) return status
        val at=updatedAt ?: return ""
        val ago=(now-at).toInt()
        val base=when { ago<5 -> "Updated just now"; ago<60 -> "Updated $ago s ago"; else -> "Updated ${ago/60} min ago" }
        val next=nextAutoAt?.let { (it-now).toInt() }?.takeIf { auto && it>0 }
        return if(next!=null) "$base · next in $next s" else base
    }
    @Composable private fun Screen() {
        LaunchedEffect(Unit) { while(true) { delay(1000); now=System.currentTimeMillis()/1000.0 } }
        LaunchedEffect(auto,center,mode,radius) {
            if(auto && center!=null) while(true) { nextAutoAt=System.currentTimeMillis()/1000.0+AUTO_SECONDS; delay(AUTO_SECONDS*1000L); refresh() }
            else nextAutoAt=null
        }
        BackHandler { if(showArea) showArea=false else if(selected!=null) selected=null else finish() }
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().systemBarsPadding().displayCutoutPadding().imePadding().semantics { contentDescription="Sky Watch workspace" }) {
                val p=center
                Row(Modifier.fillMaxWidth().padding(start=16.dp,end=8.dp,top=4.dp),verticalAlignment=Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Sky Watch",style=MaterialTheme.typography.titleLarge)
                        if(p!=null) Text(String.format(Locale.ROOT,"%s · %.3f, %.3f",locationLabel,p.lat,p.lon),style=MaterialTheme.typography.labelSmall,
                            color=ConstructColors.muted,maxLines=1,overflow=TextOverflow.Ellipsis)
                    }
                    if(p!=null) TextButton(onClick={ showArea=true },enabled=!busy) { Text("Area") }
                    TextButton(onClick={ finish() }) { Text("Close") }
                }
                if(p==null) Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal=20.dp,vertical=12.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                    Text("What’s flying nearby?",style=MaterialTheme.typography.headlineSmall)
                    Text("Pick where to look. Aircraft within your radius appear on a live map with distance, direction and altitude.",style=MaterialTheme.typography.bodyMedium,color=ConstructColors.muted)
                    AreaFields()
                    Spacer(Modifier.height(4.dp))
                    Text("Your chosen area goes to the selected aircraft sources and visible map areas to OpenStreetMap. Location is used only while this screen is open. Coverage is incomplete and delayed · not for navigation. No camera or AR in this version.",
                        style=MaterialTheme.typography.bodySmall,color=ConstructColors.muted)
                } else {
                    Row(Modifier.fillMaxWidth().padding(horizontal=12.dp,vertical=4.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                        var sourceMenu by remember { mutableStateOf(false) }
                        var radiusMenu by remember { mutableStateOf(false) }
                        Box(Modifier.weight(1f)) {
                            Picker(mode.label,enabled=!busy,modifier=Modifier.fillMaxWidth()) { sourceMenu=true }
                            DropdownMenu(expanded=sourceMenu,onDismissRequest={ sourceMenu=false }) { SkyMode.entries.forEach { m ->
                                PickerItem(m.label,m==mode) { sourceMenu=false; if(m!=mode) { mode=m; selected=null; refresh() } }
                            } }
                        }
                        Box {
                            Picker("$radius km",enabled=!busy) { radiusMenu=true }
                            DropdownMenu(expanded=radiusMenu,onDismissRequest={ radiusMenu=false }) { listOf(10,25,50,100).forEach { r ->
                                PickerItem("$r km",r==radius) { radiusMenu=false; if(r!=radius) { radius=r; selected=null; refresh() } }
                            } }
                        }
                        Box(Modifier.size(44.dp),contentAlignment=Alignment.Center) {
                            if(busy) CircularProgressIndicator(Modifier.size(22.dp),color=ConstructColors.jade,trackColor=ConstructColors.surface2,strokeWidth=2.dp)
                            else IconButton(onClick={ refresh() },colors=IconButtonDefaults.iconButtonColors(contentColor=ConstructColors.jade)) {
                                Icon(Icons.Filled.Refresh,contentDescription="Refresh")
                            }
                        }
                    }
                    if(busy) LinearProgressIndicator(Modifier.fillMaxWidth().height(2.dp),color=ConstructColors.jade,trackColor=ConstructColors.surface2)
                    else HorizontalDivider(thickness=2.dp,color=ConstructColors.border)
                    val aircraft=SkyData.merge(feeds,mode,p,radius,now)
                    BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                        val wide=maxWidth>maxHeight*1.3f
                        val panelWidth=(maxWidth*0.43f).coerceAtMost(330.dp)
                        if(wide) Row(Modifier.fillMaxSize()) {
                            SkyMap(network,p,radius,aircraft,selected,now,{ selected=it },{ choose(it) },!busy,Modifier.weight(1f).fillMaxHeight())
                            AircraftPanel(aircraft,p,Modifier.width(panelWidth).fillMaxHeight())
                        } else Column(Modifier.fillMaxSize()) {
                            SkyMap(network,p,radius,aircraft,selected,now,{ selected=it },{ choose(it) },!busy,Modifier.weight(0.58f).fillMaxWidth())
                            AircraftPanel(aircraft,p,Modifier.weight(0.42f).fillMaxWidth())
                        }
                    }
                }
            }
        }
        infoTarget?.let { InfoDialog(it) }
        if(showArea) AlertDialog(onDismissRequest={ showArea=false },title={ Text("Choose area") },text={
            Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(8.dp)) { AreaFields() }
        },confirmButton={ TextButton(onClick={ showArea=false }) { Text("Cancel") } })
    }
    /** Outlined picker with a visible drop-down affordance; the value is the label the runner taps. */
    @Composable private fun Picker(value: String,enabled: Boolean,modifier: Modifier=Modifier,onClick: () -> Unit) {
        // The visible value is the whole accessible name; a role prefix would hide it from label matching.
        OutlinedButton(onClick=onClick,enabled=enabled,modifier=modifier,
            border=BorderStroke(1.dp,if(enabled) ConstructColors.controlBorder else ConstructColors.border),
            colors=ButtonDefaults.outlinedButtonColors(contentColor=ConstructColors.text,disabledContentColor=ConstructColors.disabled),
            contentPadding=PaddingValues(start=14.dp,end=8.dp,top=8.dp,bottom=8.dp)) {
            Text(value,maxLines=1,overflow=TextOverflow.Ellipsis)
            Icon(Icons.Filled.ArrowDropDown,contentDescription=null,tint=if(enabled) ConstructColors.muted else ConstructColors.disabled)
        }
    }
    @Composable private fun PickerItem(label: String,current: Boolean,onClick: () -> Unit) {
        DropdownMenuItem(text={ Text(label,color=if(current) ConstructColors.jade else ConstructColors.text) },onClick=onClick,
            trailingIcon={ if(current) Icon(Icons.Filled.Check,contentDescription="Selected",tint=ConstructColors.jade) })
    }
    @Composable private fun StatusText(modifier: Modifier=Modifier) {
        val line=statusLine()
        if(line.isNotEmpty()) Text(line,style=MaterialTheme.typography.bodySmall,modifier=modifier,
            color=if(status.isEmpty()) ConstructColors.muted else ConstructColors.tone(statusTone))
    }
    @Composable private fun AreaFields() {
        val focus=LocalFocusManager.current
        Button(onClick={ useLocation() },enabled=!locating && !busy,modifier=Modifier.fillMaxWidth(),
            colors=ButtonDefaults.buttonColors(containerColor=ConstructColors.jade,contentColor=ConstructColors.jadeInk,
                disabledContainerColor=ConstructColors.surface2,disabledContentColor=ConstructColors.disabled)) {
            if(locating) CircularProgressIndicator(Modifier.size(18.dp),color=ConstructColors.disabled,strokeWidth=2.dp)
            else Icon(Icons.Filled.LocationOn,contentDescription=null,modifier=Modifier.size(18.dp))
            Spacer(Modifier.width(8.dp)); Text(if(locating) "Finding location…" else "Use my location")
        }
        Text("Or enter coordinates",style=MaterialTheme.typography.titleSmall,color=ConstructColors.muted)
        OutlinedTextField(value=latText,onValueChange={ latText=it.take(24) },label={ Text("Latitude") },singleLine=true,modifier=Modifier.fillMaxWidth(),
            placeholder={ Text("e.g. 50.03790") },keyboardOptions=KeyboardOptions(imeAction=ImeAction.Next))
        OutlinedTextField(value=lonText,onValueChange={ lonText=it.take(24) },label={ Text("Longitude") },singleLine=true,modifier=Modifier.fillMaxWidth(),
            placeholder={ Text("e.g. 8.56220") },keyboardOptions=KeyboardOptions(imeAction=ImeAction.Done),
            keyboardActions=KeyboardActions(onDone={ focus.clearFocus(); enterArea() }))
        FilledTonalButton(onClick={ focus.clearFocus(); enterArea() },enabled=!busy,modifier=Modifier.fillMaxWidth(),
            colors=ButtonDefaults.filledTonalButtonColors(containerColor=ConstructColors.surface2,contentColor=ConstructColors.text,
                disabledContainerColor=ConstructColors.surface2,disabledContentColor=ConstructColors.disabled),
            border=BorderStroke(1.dp,if(!busy) ConstructColors.controlBorder else ConstructColors.disabled)) { Text("Show aircraft") }
        StatusText()
    }
    @OptIn(ExperimentalLayoutApi::class)
    @Composable private fun AircraftPanel(aircraft: List<SkyAircraft>,p: SkyPoint,modifier: Modifier) {
        var sourceDetails by remember { mutableStateOf(false) }
        val listState=rememberLazyListState()
        LaunchedEffect(selected) { if(selected!=null) listState.animateScrollToItem(1) }
        val active=feeds.filter { it.source in mode.sources }
        val issue=active.any { !it.ok }
        LazyColumn(modifier.padding(horizontal=12.dp),state=listState) {
            item {
                Row(Modifier.padding(top=8.dp),verticalAlignment=Alignment.CenterVertically) {
                    Text("${aircraft.size} aircraft",style=MaterialTheme.typography.titleMedium,modifier=Modifier.weight(1f))
                    Text("Auto",style=MaterialTheme.typography.labelMedium,color=ConstructColors.muted)
                    Spacer(Modifier.width(8.dp))
                    Switch(checked=auto,onCheckedChange={ auto=it },modifier=Modifier.semantics { contentDescription="Automatic refresh every 30 seconds" },
                        colors=SwitchDefaults.colors(checkedThumbColor=ConstructColors.jadeInk,checkedTrackColor=ConstructColors.jade,
                            uncheckedThumbColor=ConstructColors.muted,uncheckedTrackColor=ConstructColors.surface2,uncheckedBorderColor=ConstructColors.controlBorder))
                }
                StatusText(Modifier.padding(top=2.dp))
                FlowRow(Modifier.fillMaxWidth().padding(top=6.dp),horizontalArrangement=Arrangement.spacedBy(6.dp),verticalArrangement=Arrangement.spacedBy(4.dp),itemVerticalAlignment=Alignment.CenterVertically) {
                    mode.sources.forEach { s ->
                        val f=active.firstOrNull { it.source==s }
                        val tone=when { f==null -> WorkshopTone.NEUTRAL; f.ok -> WorkshopTone.NEUTRAL; else -> WorkshopTone.ERROR }
                        val word=when { f==null -> "waiting"; f.ok -> "live"; else -> "problem" }
                        WorkshopBadgeChip(WorkshopBadge("${s.label} · $word",tone))
                    }
                    TextButton(onClick={ sourceDetails=!sourceDetails },contentPadding=PaddingValues(horizontal=8.dp),
                        colors=ButtonDefaults.textButtonColors(contentColor=ConstructColors.jade)) {
                        Text(if(sourceDetails) "Hide source details" else "Sources & status${if(issue) " · issue" else ""}",style=MaterialTheme.typography.labelMedium)
                    }
                }
                if(sourceDetails) Column(Modifier.fillMaxWidth().padding(vertical=6.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                    active.forEach { f -> Text("${f.source.label}: ${f.message}${f.remaining?.let { " · $it credits left" }.orEmpty()}",
                        style=MaterialTheme.typography.labelSmall,color=if(f.ok) ConstructColors.muted else ConstructColors.error) }
                    if(SkySource.OPENSKY in mode.sources) Text("OpenSky public access: 400 credits/day shared by IP. Quotas may interrupt updates.",style=MaterialTheme.typography.labelSmall,color=ConstructColors.muted)
                    Text("Amber = position over 30 s old · positions expire after 2 minutes · coverage is incomplete",style=MaterialTheme.typography.labelSmall,color=ConstructColors.muted)
                    Text("Direction is from your area. Altitude is barometric; speed is over ground; the arrow shows ground track.",style=MaterialTheme.typography.labelSmall,color=ConstructColors.muted)
                    Text("Data: ${mode.sources.joinToString(" + ") { it.label }}${if(SkySource.ADSB in mode.sources) " (ADSB.lol: ODbL)" else ""}",style=MaterialTheme.typography.labelSmall,color=ConstructColors.muted)
                }
                if(aircraft.isEmpty()) Text(if(busy) "Looking for aircraft…" else "No recent aircraft positions in this radius. This does not mean the sky is empty.",
                    style=MaterialTheme.typography.bodyMedium,color=ConstructColors.muted,modifier=Modifier.padding(vertical=12.dp))
                else Spacer(Modifier.height(4.dp))
            }
            val chosen=aircraft.firstOrNull { it.key==selected }
            if(chosen!=null) item(key="selection") { DetailCard(chosen,p) }
            items(aircraft.take(200),key={ it.key }) { a ->
                val current=a.key==selected
                Row(Modifier.fillMaxWidth().then(if(current) Modifier.background(ConstructColors.surface2,RoundedCornerShape(8.dp)) else Modifier)
                    .clickable { selected=a.key }.padding(horizontal=4.dp,vertical=10.dp),verticalAlignment=Alignment.CenterVertically) {
                    HeadingGlyph(a.track,a.age(now)>SkyData.STALE_AGE,kind=SkyIdentity.kind(a))
                    Spacer(Modifier.width(12.dp))
                    Column(Modifier.weight(1f)) {
                        Text(a.label,style=MaterialTheme.typography.titleSmall)
                        Text(details(a,p),style=MaterialTheme.typography.bodySmall,color=ConstructColors.text)
                        Text(SkyIdentity.name(a.type),style=MaterialTheme.typography.bodySmall,color=ConstructColors.muted)
                        Text(a.sources.joinToString(" + ") { it.label },style=MaterialTheme.typography.labelSmall,color=ConstructColors.muted)
                    }
                }
                HorizontalDivider(color=ConstructColors.border)
            }
            if(aircraft.size>200) item { Text("Showing the nearest 200 in the list. All recent positions are on the map.",style=MaterialTheme.typography.bodySmall,color=ConstructColors.muted,modifier=Modifier.padding(vertical=8.dp)) }
            item { Spacer(Modifier.height(12.dp)) }
        }
    }
    @Composable private fun DetailCard(a: SkyAircraft,p: SkyPoint) {
        val stale=a.age(now)>SkyData.STALE_AGE
        Card(Modifier.fillMaxWidth().padding(bottom=8.dp),shape=RoundedCornerShape(12.dp),
            colors=CardDefaults.cardColors(containerColor=ConstructColors.surface2,contentColor=ConstructColors.text),
            border=BorderStroke(1.dp,ConstructColors.jade)) {
            Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(6.dp)) {
                Row(verticalAlignment=Alignment.CenterVertically) {
                    HeadingGlyph(a.track,stale,size=26.dp,kind=SkyIdentity.kind(a))
                    Spacer(Modifier.width(10.dp))
                    Text(a.label,style=MaterialTheme.typography.titleLarge,modifier=Modifier.weight(1f))
                    if(stale) WorkshopBadgeChip(WorkshopBadge("stale",WorkshopTone.ATTENTION))
                }
                Text("${a.registration ?: "Registration unknown"} · ${SkyIdentity.name(a.type)}",style=MaterialTheme.typography.bodySmall,color=ConstructColors.muted)
                Text(a.category?.let { "Reported: $it" } ?: SkyIdentity.kind(a).label,style=MaterialTheme.typography.labelSmall,color=ConstructColors.muted)
                if(a.identityConflict) Text("Identity reports differ · newest known values shown",style=MaterialTheme.typography.labelSmall,color=ConstructColors.amber)
                val bearing=SkyData.bearing(p,a.point)
                DetailLine("Where",String.format(Locale.ROOT,"%.1f km %s of your area · bearing %03.0f°",SkyData.distance(p,a.point),SkyData.compass(bearing),bearing))
                DetailLine("Altitude",a.altitudeM?.let { String.format(Locale.ROOT,"%,d ft barometric",(it/0.3048).toInt()) } ?: "Unknown")
                DetailLine("Speed",a.speedMps?.let { "${(it*3.6).toInt()} km/h over ground" } ?: "Unknown")
                DetailLine("Heading",a.track?.let { String.format(Locale.ROOT,"%03.0f° %s ground track",it,SkyData.compass(it)) } ?: "Unknown")
                DetailLine("Seen","${ageText(a)} · ${a.source.label} position · reported by ${a.sources.joinToString(" + ") { it.label }}")
                TextButton(onClick={ infoGeneration++; infoTarget=a; infoResult=null; infoError=null },contentPadding=PaddingValues(horizontal=4.dp),
                    colors=ButtonDefaults.textButtonColors(contentColor=ConstructColors.jade)) { Text("More aircraft info") }
                TextButton(onClick={ selected=null },contentPadding=PaddingValues(horizontal=4.dp),
                    colors=ButtonDefaults.textButtonColors(contentColor=ConstructColors.jade)) { Text("Dismiss details") }
            }
        }
    }
    private fun lookupInfo(a: SkyAircraft) {
        val request=SkyLookupRequest.from(a) ?: return
        if(!live || isFinishing || infoBusy) return
        try { access() } catch(_: Exception) { finish(); return }
        val token=infoGeneration
        infoBusy=true; infoError=null
        infoWorker.execute {
            val result=runCatching { network.lookup(request) }
            runOnUiThread {
                if(live && !isFinishing) {
                    infoBusy=false
                    if(token==infoGeneration) try {
                        access()
                        result.onSuccess { infoResult=it }.onFailure { infoError="Aircraft lookup unavailable. Tracking still works." }
                    } catch(_: Exception) { finish() }
                }
            }
        }
    }
    @Composable private fun InfoDialog(a: SkyAircraft) {
        val request=SkyLookupRequest.from(a)
        fun closeInfo() { infoGeneration++; infoTarget=null; infoResult=null; infoError=null }
        AlertDialog(onDismissRequest={ closeInfo() },title={ Text("Aircraft info · ${a.label}") },text={
            Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)) {
                Text(SkyIdentity.name(a.type),style=MaterialTheme.typography.titleMedium)
                Text("${a.registration ?: "Registration unknown"} · ${a.type ?: "Type code unknown"}",style=MaterialTheme.typography.bodySmall)
                Text("Model type: ${SkyIdentity.kind(a).label}",style=MaterialTheme.typography.bodySmall)
                if(a.typeSource!=null) Text("Type: ${a.typeSource.label} · registration: ${a.registrationSource?.label ?: "unknown"}",style=MaterialTheme.typography.labelSmall)
                if(a.category!=null) Text("Reported category: ${a.category} · ${a.categorySource?.label ?: "unknown source"}",style=MaterialTheme.typography.bodySmall)
                if(a.identityConflict) Text("Live sources disagree on identity/category. Newest known fields are shown.",color=ConstructColors.amber)
                HorizontalDivider()
                val result=infoResult?.takeIf { it.request==request }
                if(result==null) {
                    Text("Optional lookup: ADSBdb can add manufacturer, model and registry details. Its records may be incomplete or out of date.",style=MaterialTheme.typography.bodySmall)
                    Text("Only after you tap Look up: sends this aircraft’s ICAO address${if(request?.airline!=null) " and callsign prefix ${request.airline}" else ""} to ADSBdb, which also sees your IP address. Your coordinates are not sent. Results stay in memory until you leave Sky Watch.",style=MaterialTheme.typography.bodySmall)
                    if(request==null) Text("No standard ICAO address is available for this aircraft.",style=MaterialTheme.typography.bodySmall)
                } else {
                    Text("ADSBdb record",style=MaterialTheme.typography.titleSmall)
                    result.aircraft.aircraft?.let { info ->
                        MetadataLine("Model",listOfNotNull(info.manufacturer,info.model).joinToString(" ").ifBlank { "Unknown" })
                        MetadataLine("Type code",info.typeCode ?: "Unknown")
                        MetadataLine("Registration",info.registration ?: "Unknown")
                        MetadataLine("Registry owner",info.owner ?: "Unknown")
                        MetadataLine("Registry country",info.country ?: "Unknown")
                        if((a.type!=null && info.typeCode!=null && a.type!=info.typeCode) ||
                            (a.registration!=null && info.registration!=null && a.registration!=info.registration))
                            Text("This record differs from the live feed. It has not replaced the map identity.",color=ConstructColors.amber,style=MaterialTheme.typography.bodySmall)
                    }
                    result.aircraft.message?.let { Text(it,style=MaterialTheme.typography.bodySmall) }
                    result.airline?.let { part ->
                        MetadataLine("Callsign airline",part.airline?.let { "$it (${request?.airline})" } ?: part.message ?: "Unknown")
                    }
                    Text("Registry owner and callsign airline can differ through leasing or old records. These are not a verified current operator or private/cargo flight classification.",style=MaterialTheme.typography.bodySmall)
                    val at=java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT,java.text.DateFormat.SHORT)
                    Text("Aircraft retrieved ${at.format(java.util.Date(result.aircraft.checkedAt))}",style=MaterialTheme.typography.labelSmall)
                    result.airline?.let { Text("Airline retrieved ${at.format(java.util.Date(it.checkedAt))}",style=MaterialTheme.typography.labelSmall) }
                    Text("ADSBdb / PlaneBase aircraft data. Retrieval times are not database update dates.",style=MaterialTheme.typography.labelSmall)
                }
                if(infoBusy) { CircularProgressIndicator(Modifier.size(22.dp)); Text("Looking up aircraft…",style=MaterialTheme.typography.bodySmall) }
                infoError?.let { Text(it,color=ConstructColors.amber,style=MaterialTheme.typography.bodySmall) }
            }
        },confirmButton={
            if(request!=null) TextButton(onClick={ lookupInfo(a) },enabled=!infoBusy) { Text(if(infoResult==null) "Look up with ADSBdb" else "Look up again") }
        },dismissButton={ TextButton(onClick={ closeInfo() },modifier=Modifier.semantics { contentDescription="Close aircraft info" }) { Text("Close") } })
    }
    @Composable private fun MetadataLine(label: String,value: String) {
        Column(verticalArrangement=Arrangement.spacedBy(2.dp)) {
            Text(label,style=MaterialTheme.typography.labelMedium,color=ConstructColors.muted)
            Text(value,style=MaterialTheme.typography.bodyMedium,color=ConstructColors.text)
        }
    }
    @Composable private fun DetailLine(label: String,value: String) {
        Row(verticalAlignment=Alignment.Top) {
            Text(label,style=MaterialTheme.typography.labelMedium,color=ConstructColors.muted,modifier=Modifier.width(72.dp))
            Text(value,style=MaterialTheme.typography.bodySmall,modifier=Modifier.weight(1f))
        }
    }
    /** Small ground-track arrow matching the map marker; a dot when the track is unknown. */
    @Composable private fun HeadingGlyph(track: Double?,stale: Boolean,size: androidx.compose.ui.unit.Dp=22.dp,kind: SkyKind=SkyKind.UNKNOWN) {
        val fill=if(stale) ConstructColors.amber else ConstructColors.jade
        // Decorative: the row text carries the meaning, so the glyph adds no accessible label.
        Canvas(Modifier.size(size)) {
            val c=center; val r=this.size.minDimension/2*0.85f
            skyGlyph(kind,track,c,r,fill,fill)
        }
    }
    private fun ageText(a: SkyAircraft): String { val s=a.age(now).toInt(); return if(s<60) "$s s ago" else "${s/60} min ${s%60} s ago" }
    private fun details(a: SkyAircraft,p: SkyPoint): String=String.format(Locale.ROOT,"%.1f km · %s · %s · %s · %s%s",SkyData.distance(p,a.point),
        SkyData.compass(SkyData.bearing(p,a.point)),
        a.altitudeM?.let { String.format(Locale.ROOT,"%,d ft",(it/0.3048).toInt()) } ?: "Altitude unknown",
        a.speedMps?.let { "${(it*3.6).toInt()} km/h" } ?: "Speed unknown",ageText(a),if(a.age(now)>SkyData.STALE_AGE) " · stale" else "")
}
