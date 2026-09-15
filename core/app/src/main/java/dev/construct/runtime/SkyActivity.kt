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
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
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
    private var locationLabel by mutableStateOf("Chosen area")
    private var auto by mutableStateOf(true)
    private var selected by mutableStateOf<String?>(null)
    private var showArea by mutableStateOf(false)
    private var latText by mutableStateOf("")
    private var lonText by mutableStateOf("")
    private var now by mutableDoubleStateOf(System.currentTimeMillis()/1000.0)
    private var generation=0
    private val permission=registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
        if(live && !isFinishing) {
            if(hasLocation()) locate() else status="Location permission not granted. Enter coordinates instead, or enable permission in Android Settings."
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
        live=false; generation++; stopLocation(); feeds=emptyList(); center=null; selected=null; latText=""; lonText=""
        if(::network.isInitialized) network.close()
        super.onStop(); finish()
    }
    override fun onDestroy() { live=false; stopLocation(); if(::network.isInitialized) network.close(); launched.set(false); super.onDestroy() }
    private fun access() { store.withCapability(installed,"sky.watch") { } }
    private fun hasLocation()=checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)==PackageManager.PERMISSION_GRANTED || checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED
    private fun useLocation() {
        try {
            access()
            if(hasLocation()) locate() else {
                permission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION))
            }
        } catch(_: Exception) { status="Location unavailable. Enter coordinates instead." }
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
            locating=true; status="Finding your location…"
            val callback=object: LocationListener {
                override fun onLocationChanged(location: Location) {
                    if(!live || isFinishing || listener!==this) return
                    try {
                        access()
                        checkRule(hasLocation(),"SKY_LOCATION","Location permission is off.")
                        val age=(android.os.SystemClock.elapsedRealtimeNanos()-location.elapsedRealtimeNanos)/1e9
                        if(age !in 0.0..120.0 || !location.hasAccuracy() || location.accuracy<0 || location.accuracy>10000) return
                        val p=SkyPoint(location.latitude,location.longitude)
                        stopLocation(); locationLabel=String.format(Locale.ROOT,"Phone location · accuracy ±%.0f m",location.accuracy)
                        choose(p,fromPhone=true)
                    } catch(_: Exception) { stopLocation(); status="Location could not be used. Enter coordinates instead." }
                }
                @Deprecated("Required on older Android") override fun onStatusChanged(provider: String?,status: Int,extras: Bundle?) { }
                override fun onProviderEnabled(provider: String) { }
                override fun onProviderDisabled(provider: String) { }
            }
            listener=callback
            var registered=false
            for(provider in providers) try { manager.requestLocationUpdates(provider,0L,0f,callback,Looper.getMainLooper()); registered=true } catch(_: SecurityException) { }
            checkRule(registered,"SKY_LOCATION","Location is unavailable.")
            handler.postDelayed({ if(listener===callback) { stopLocation(); status="No recent location fix. Try outdoors, or enter coordinates." } },25000)
        } catch(e: Exception) { stopLocation(); status=(e as? ConstructError)?.message ?: "Location unavailable. Enter coordinates instead." }
    }
    private fun choose(p: SkyPoint,fromPhone: Boolean=false) {
        try { access() } catch(_: Exception) { finish(); return }
        stopLocation(); generation++; center=p; feeds=emptyList(); selected=null; showArea=false
        if(!fromPhone) locationLabel="Chosen area"
        latText=String.format(Locale.ROOT,"%.5f",p.lat); lonText=String.format(Locale.ROOT,"%.5f",p.lon)
        refresh()
    }
    private fun enterArea() {
        val a=latText.trim().replace(',','.').toDoubleOrNull(); val b=lonText.trim().replace(',','.').toDoubleOrNull()
        if(a==null || b==null || !a.isFinite() || !b.isFinite() || a !in -85.0..85.0 || b !in -180.0..180.0) {
            status="Enter latitude −85 to 85 and longitude −180 to 180."; return
        }
        choose(SkyPoint(a,b))
    }
    private fun refresh() {
        val p=center ?: return
        if(!live || busy || isFinishing) return
        try { access() } catch(_: Exception) { finish(); return }
        if(!workerBusy.compareAndSet(false,true)) { status="Previous request is finishing. Tap Refresh shortly."; return }
        val token=++generation; val requestedMode=mode; val requestedRadius=radius; val old=feeds
        busy=true; status="Updating aircraft…"
        worker.execute {
            try {
                val results=requestedMode.sources.map { source ->
                    val result=network.fetch(source,p,requestedRadius)
                    if(!result.ok) result.copy(aircraft=old.firstOrNull { it.source==source }?.aircraft.orEmpty()) else result
                }
                runOnUiThread {
                    if(live && token==generation && !isFinishing) try {
                        access(); feeds=results; now=System.currentTimeMillis()/1000.0
                        status=when { results.all { it.ok } -> "Updated · positions expire after 2 minutes"
                            results.any { it.ok } -> "Partial coverage · one source is unavailable"
                            else -> "Could not refresh · recent cached positions may remain" }
                    } catch(_: Exception) { finish() }
                    if(token==generation) busy=false
                }
            } finally { workerBusy.set(false) }
        }
    }
    @Composable private fun Screen() {
        LaunchedEffect(Unit) { while(true) { delay(1000); now=System.currentTimeMillis()/1000.0 } }
        LaunchedEffect(auto,center,mode,radius) { if(auto && center!=null) while(true) { delay(30000); refresh() } }
        BackHandler { if(showArea) showArea=false else if(selected!=null) selected=null else finish() }
        Surface(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().systemBarsPadding().displayCutoutPadding().imePadding().semantics { contentDescription="Sky Watch workspace" }) {
                Row(Modifier.fillMaxWidth().padding(horizontal=12.dp),verticalAlignment=Alignment.CenterVertically) {
                    Text("Sky Watch",style=MaterialTheme.typography.titleLarge,modifier=Modifier.weight(1f))
                    if(center!=null) TextButton(onClick={ showArea=true },enabled=!busy) { Text("Area") }
                    TextButton(onClick={ finish() }) { Text("Close") }
                }
                val p=center
                if(p==null) Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
                    Text("What’s flying nearby?",style=MaterialTheme.typography.headlineSmall)
                    Text("Choose your location or enter an area. Your chosen area is sent to the selected aircraft sources; visible map areas go to OpenStreetMap. Location is used only while this workspace is open.")
                    Text("ADSB.lol is selected initially. You can switch to OpenSky or combine both on the map. OpenSky uses a limited public quota; no account is needed.")
                    AreaFields()
                    Text("Incomplete, delayed coverage · not for navigation. Camera/AR is not part of this version.",style=MaterialTheme.typography.bodySmall)
                } else {
                    Row(Modifier.fillMaxWidth().padding(horizontal=8.dp),verticalAlignment=Alignment.CenterVertically) {
                        var sourceMenu by remember { mutableStateOf(false) }
                        var radiusMenu by remember { mutableStateOf(false) }
                        Box(Modifier.weight(1f)) {
                            OutlinedButton(onClick={ sourceMenu=true },enabled=!busy,modifier=Modifier.fillMaxWidth()) { Text(mode.label) }
                            DropdownMenu(expanded=sourceMenu,onDismissRequest={ sourceMenu=false }) { SkyMode.entries.forEach { m ->
                                DropdownMenuItem(text={ Text(m.label) },onClick={ sourceMenu=false; mode=m; selected=null; refresh() })
                            } }
                        }
                        Spacer(Modifier.width(6.dp))
                        Box { OutlinedButton(onClick={ radiusMenu=true },enabled=!busy) { Text("$radius km") }
                            DropdownMenu(expanded=radiusMenu,onDismissRequest={ radiusMenu=false }) { listOf(10,25,50,100).forEach { r ->
                                DropdownMenuItem(text={ Text("$r km") },onClick={ radiusMenu=false; radius=r; selected=null; refresh() })
                            } }
                        }
                        TextButton(onClick={ refresh() },enabled=!busy) { Text(if(busy) "Loading" else "Refresh") }
                    }
                    val aircraft=SkyData.merge(feeds,mode,p,radius,now)
                    BoxWithConstraints(Modifier.weight(1f).fillMaxWidth()) {
                        val wide=maxWidth>maxHeight*1.3f
                        if(wide) Row(Modifier.fillMaxSize()) {
                            SkyMap(network,p,radius,aircraft,selected,now,{ selected=it },{ choose(it) },!busy,Modifier.weight(1f).fillMaxHeight())
                            AircraftPanel(aircraft,p,Modifier.widthIn(max=330.dp).fillMaxWidth(0.43f).fillMaxHeight())
                        } else Column(Modifier.fillMaxSize()) {
                            SkyMap(network,p,radius,aircraft,selected,now,{ selected=it },{ choose(it) },!busy,Modifier.weight(0.58f).fillMaxWidth())
                            AircraftPanel(aircraft,p,Modifier.weight(0.42f).fillMaxWidth())
                        }
                    }
                }
            }
        }
        if(showArea) AlertDialog(onDismissRequest={ showArea=false },title={ Text("Choose area") },text={
            Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(8.dp)) { AreaFields() }
        },confirmButton={ TextButton(onClick={ showArea=false }) { Text("Cancel") } })
    }
    @Composable private fun AreaFields() {
        Button(onClick={ useLocation() },enabled=!locating && !busy) { Text(if(locating) "Finding location…" else "Use my location") }
        Text("Or enter coordinates",style=MaterialTheme.typography.titleSmall)
        OutlinedTextField(value=latText,onValueChange={ latText=it.take(24) },label={ Text("Latitude") },singleLine=true,modifier=Modifier.fillMaxWidth())
        OutlinedTextField(value=lonText,onValueChange={ lonText=it.take(24) },label={ Text("Longitude") },singleLine=true,modifier=Modifier.fillMaxWidth())
        Button(onClick={ enterArea() },enabled=!busy) { Text("Show aircraft") }
        Text(status,style=MaterialTheme.typography.bodySmall)
    }
    @Composable private fun AircraftPanel(aircraft: List<SkyAircraft>,p: SkyPoint,modifier: Modifier) {
        var sourceDetails by remember { mutableStateOf(false) }
        val listState=rememberLazyListState()
        LaunchedEffect(selected) { if(selected!=null) listState.animateScrollToItem(1) }
        LazyColumn(modifier.padding(horizontal=12.dp),state=listState,verticalArrangement=Arrangement.spacedBy(6.dp)) {
            item {
                Row(verticalAlignment=Alignment.CenterVertically) {
                    Text("${aircraft.size} aircraft",style=MaterialTheme.typography.titleMedium,modifier=Modifier.weight(1f))
                    Text("Auto · 30 s",style=MaterialTheme.typography.labelSmall)
                    Switch(checked=auto,onCheckedChange={ auto=it },modifier=Modifier.semantics { contentDescription="Automatic refresh every 30 seconds" })
                }
                Text(locationLabel,style=MaterialTheme.typography.labelSmall)
                Text(status,style=MaterialTheme.typography.bodySmall)
                TextButton(onClick={ sourceDetails=!sourceDetails }) { Text(if(sourceDetails) "Hide source details" else "Sources & status${if(feeds.any { it.source in mode.sources && !it.ok }) " · issue" else ""}") }
                if(sourceDetails) {
                feeds.filter { it.source in mode.sources }.forEach { f -> Text("${f.source.label}: ${f.message}${f.remaining?.let { " · $it credits left" }.orEmpty()}",
                    style=MaterialTheme.typography.labelSmall,color=if(f.ok) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error) }
                if(SkySource.OPENSKY in mode.sources) Text("OpenSky public access: 400 credits/day shared by IP. Quotas may interrupt updates.",style=MaterialTheme.typography.labelSmall)
                Text("Amber = position over 30 s old · incomplete coverage",style=MaterialTheme.typography.labelSmall)
                Text("Data: ${mode.sources.joinToString(" + ") { it.label }}${if(SkySource.ADSB in mode.sources) " (ADSB.lol: ODbL)" else ""}",style=MaterialTheme.typography.labelSmall)
                }
                if(aircraft.isEmpty()) Text(if(busy) "Looking for aircraft…" else "No recent aircraft positions in this radius. This does not mean the sky is empty.")
            }
            val chosen=aircraft.firstOrNull { it.key==selected }
            if(chosen!=null) item(key="selection") {
                Card(Modifier.fillMaxWidth()) { Column(Modifier.padding(12.dp)) {
                    Text(chosen.label,style=MaterialTheme.typography.titleMedium)
                    Text("${chosen.registration ?: "Registration unknown"} · ${chosen.type ?: "Type unknown"}")
                    Text(details(chosen,p))
                    Text("Position: ${chosen.source.label} · seen by ${chosen.sources.joinToString(" + ") { it.label }}",style=MaterialTheme.typography.bodySmall)
                    TextButton(onClick={ selected=null }) { Text("Dismiss details") }
                } }
            }
            items(aircraft.take(200),key={ it.key }) { a ->
                Column(Modifier.fillMaxWidth().clickable { selected=a.key }.padding(vertical=8.dp)) {
                    Text(a.label,style=MaterialTheme.typography.titleSmall)
                    Text(details(a,p),style=MaterialTheme.typography.bodySmall)
                    Text(a.sources.joinToString(" + ") { it.label },style=MaterialTheme.typography.labelSmall)
                }
                HorizontalDivider()
            }
            if(aircraft.size>200) item { Text("Showing the nearest 200 in the list. All recent positions are on the map.") }
        }
    }
    private fun details(a: SkyAircraft,p: SkyPoint): String=String.format(Locale.ROOT,"%.1f km · %s · %s · %.0f s ago%s",SkyData.distance(p,a.point),
        a.altitudeM?.let { "${(it/0.3048).toInt()} ft baro" } ?: "Altitude unknown",
        a.speedMps?.let { "${(it*3.6).toInt()} km/h" } ?: "Speed unknown",a.age(now),if(a.age(now)>SkyData.STALE_AGE) " · stale" else "")
}
