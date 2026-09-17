package dev.construct.runtime

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.ceil
import java.util.concurrent.Executors
import kotlinx.coroutines.asCoroutineDispatcher

/** Fixed origins/paths only; no URL, headers or credentials can be supplied by a web module. */
internal class SkyNetwork(context: Context, private val authorize: () -> Unit) : AutoCloseable {
    internal val tileDispatcher=Executors.newSingleThreadExecutor().asCoroutineDispatcher()
    private val closed=AtomicBoolean(false)
    private val metadata=SkyMetadata({ check() },{ path -> metadataJson(path) })
    private val connections=ConcurrentHashMap.newKeySet<HttpURLConnection>()
    private val prefs=context.getSharedPreferences("sky-provider-backoff",Context.MODE_PRIVATE)
    private val cache=File(context.cacheDir,"sky-map-tiles").apply { mkdirs() }
    private fun check() { checkRule(!closed.get(),"SKY_CLOSED","Sky Watch is closed."); authorize() }
    override fun close() { closed.set(true); connections.forEach { it.disconnect() }; connections.clear(); metadata.close(); tileDispatcher.close() }
    private data class Reply(val bytes: ByteArray, val remaining: Int?, val maxAge: Long, val cacheable: Boolean)
    private fun get(url: URL, limit: Int, source: SkySource?=null, extra: Boolean=false): Reply {
        val label=if(extra) "ADSBdb" else source?.label ?: "Map"
        val json=extra || source!=null
        check()
        checkRule(url.protocol=="https" && url.port==-1 && url.userInfo==null && url.ref==null &&
            url.host in setOf("api.adsb.lol","opensky-network.org","tile.openstreetmap.org","api.adsbdb.com"),"SKY_NETWORK","Unrecognized data source.")
        val c=url.openConnection() as HttpURLConnection
        connections.add(c)
        try {
            check(); c.instanceFollowRedirects=false; c.connectTimeout=8000; c.readTimeout=8000
            c.setRequestProperty("User-Agent","Construct-SkyWatch/0.1 (+https://github.com/blueworkslabs/construct)")
            c.setRequestProperty("Accept",if(json) "application/json" else "image/png")
            val status=c.responseCode
            if (status==429 && (source!=null || extra)) {
                val seconds=(c.getHeaderField("X-Rate-Limit-Retry-After-Seconds")?.toLongOrNull()
                    ?: c.getHeaderField("Retry-After")?.toLongOrNull() ?: 3600L).coerceIn(30,86400)
                prefs.edit().putLong(if(extra) "ADSBDB" else source!!.name,System.currentTimeMillis()+seconds*1000).apply()
                throw ConstructError("SKY_QUOTA","$label quota reached; retry in ${ceil(seconds/60.0).toInt()} min.")
            }
            if(extra && status==404) throw ConstructError("SKY_NOT_FOUND","No matching database record.")
            checkRule(status==200,"SKY_NETWORK",when(status) {
                401,403 -> "$label access unavailable. Try another source."
                in 300..399 -> "$label redirected; connection not followed."
                else -> "$label unavailable (HTTP $status)."
            })
            checkRule(c.contentLengthLong<=limit,"SKY_DATA","Response is too large.")
            val contentType=c.contentType?.substringBefore(';')?.trim()
            checkRule(if(json) contentType=="application/json" else contentType=="image/png","SKY_DATA","Unexpected response format.")
            val data=c.inputStream.use { it.readBytesBounded(limit) }; check()
            val cc=c.getHeaderField("Cache-Control").orEmpty()
            val age=Regex("(?:^|,)\\s*max-age=(\\d+)",RegexOption.IGNORE_CASE).find(cc)?.groupValues?.get(1)?.toLongOrNull()
                ?: c.getHeaderFieldDate("Expires",0).takeIf { it>System.currentTimeMillis() }?.let { (it-System.currentTimeMillis())/1000 }
                ?: 604800L
            val responseAge=c.getHeaderField("Age")?.toLongOrNull()?.coerceAtLeast(0) ?: 0L
            return Reply(data,c.getHeaderField("X-Rate-Limit-Remaining")?.toIntOrNull(),(age-responseAge).coerceIn(0,2592000),
                !cc.contains("no-store",true) && !cc.contains("no-cache",true))
        } finally { connections.remove(c); c.disconnect() }
    }
    fun fetch(source: SkySource, center: SkyPoint, radiusKm: Int): SkyFeed {
        require(radiusKm in 1..100)
        val now=System.currentTimeMillis()/1000.0
        return try {
            check()
            val remainingMs=prefs.getLong(source.name,0)-System.currentTimeMillis()
            checkRule(remainingMs<=0,"SKY_QUOTA","${source.label} cooling down; retry in ${ceil(remainingMs/60000.0).toInt()} min.")
            // Process-wide request spacing survives reopening and source toggles. Reserve before egress.
            synchronized(requestLock) {
                val last=prefs.getLong("last-${source.name}",0)
                val time=System.currentTimeMillis()
                checkRule(time-last>=15000,"SKY_RATE","${source.label}: wait 15 seconds between refreshes.")
                prefs.edit().putLong("last-${source.name}",time).commit()
            }
            val replies=when(source) {
                SkySource.ADSB -> listOf(get(URL(String.format(Locale.ROOT,"https://api.adsb.lol/v2/point/%.6f/%.6f/%d",center.lat,center.lon,ceil(radiusKm/1.852).toInt())),2*1024*1024,source))
                SkySource.OPENSKY -> SkyData.boxes(center,radiusKm).map { b -> get(URL(String.format(Locale.ROOT,
                    "https://opensky-network.org/api/states/all?lamin=%.6f&lomin=%.6f&lamax=%.6f&lomax=%.6f&extended=1",b[0],b[1],b[2],b[3])),2*1024*1024,source) }
            }
            val received=System.currentTimeMillis()/1000.0
            val aircraft=replies.flatMap { val json=JSONObject(it.bytes.toString(Charsets.UTF_8)); if(source==SkySource.ADSB) SkyData.adsb(json,received) else SkyData.opensky(json,received) }
            check(); SkyFeed(source,aircraft,"Updated",true,received,replies.last().remaining)
        } catch(e: Exception) {
            SkyFeed(source,emptyList(),(e as? ConstructError)?.message ?: "${source.label} connection failed. Check internet and retry.",false,now)
        }
    }
    fun lookup(request: SkyLookupRequest): SkyMetadataResult { check(); return metadata.lookup(request) }
    private fun metadataJson(path: String): JSONObject {
        checkRule(Regex("(?:aircraft/[0-9a-f]{6}|airline/[A-Z]{3})").matches(path),"SKY_DATA","Invalid aircraft lookup.")
        check()
        synchronized(requestLock) {
            val time=System.currentTimeMillis()
            checkRule(prefs.getLong("ADSBDB",0)<=time,"SKY_QUOTA","ADSBdb is cooling down. Try again later; tracking still works.")
            val start=prefs.getLong("metadata-window",0)
            val count=if(time-start in 0 until 60000) prefs.getInt("metadata-count",0) else 0
            checkRule(count<30,"SKY_RATE","Please wait a minute before more aircraft lookups.")
            prefs.edit().putLong("metadata-window",if(count==0) time else start).putInt("metadata-count",count+1).commit()
        }
        return JSONObject(get(URL("https://api.adsbdb.com/v0/$path"),32*1024,extra=true).bytes.toString(Charsets.UTF_8))
    }
    fun tile(z: Int,x: Int,y: Int): Bitmap {
        require(z in 2..13 && x in 0 until (1 shl z) && y in 0 until (1 shl z))
        check()
        val file=File(cache,"$z-$x-$y.png"); val expiry=File(cache,"$z-$x-$y.expiry")
        val cached=runCatching { if(file.isFile && file.length()<=256*1024 && expiry.readText().toLong()>System.currentTimeMillis()) file.readBytes() else null }.getOrNull()
        val bytes=cached ?: get(URL("https://tile.openstreetmap.org/$z/$x/$y.png"),256*1024).let { reply ->
            check()
            if(reply.cacheable) synchronized(tileLock) {
                file.writeBytes(reply.bytes); expiry.writeText((System.currentTimeMillis()+reply.maxAge*1000).toString())
                val files=cache.listFiles { f -> f.extension=="png" }.orEmpty().sortedBy { it.lastModified() }
                var total=files.sumOf { it.length() }
                for(f in files) { if(total<=12*1024*1024) break; total-=f.length(); f.delete(); File(cache,f.nameWithoutExtension+".expiry").delete() }
            }
            reply.bytes
        }
        val bounds=BitmapFactory.Options().apply { inJustDecodeBounds=true }; BitmapFactory.decodeByteArray(bytes,0,bytes.size,bounds)
        checkRule(bounds.outWidth==256 && bounds.outHeight==256,"SKY_TILE","Invalid map tile.")
        check(); return BitmapFactory.decodeByteArray(bytes,0,bytes.size) ?: throw ConstructError("SKY_TILE","Map tile unavailable.")
    }
    companion object { private val requestLock=Any(); private val tileLock=Any() }
}
