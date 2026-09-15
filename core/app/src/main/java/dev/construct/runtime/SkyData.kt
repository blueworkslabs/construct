package dev.construct.runtime

import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import kotlin.math.*

internal enum class SkySource(val label: String) { ADSB("ADSB.lol"), OPENSKY("OpenSky") }
internal enum class SkyMode(val label: String, val sources: Set<SkySource>) {
    ADSB("ADSB.lol", setOf(SkySource.ADSB)), OPENSKY("OpenSky", setOf(SkySource.OPENSKY)),
    BOTH("Combined", SkySource.entries.toSet())
}
internal data class SkyPoint(val lat: Double, val lon: Double) {
    init { require(lat.isFinite() && lon.isFinite() && lat in -85.0..85.0 && lon in -180.0..180.0) }
}
internal data class SkyAircraft(val key: String, val callsign: String?, val registration: String?, val type: String?,
    val point: SkyPoint, val altitudeM: Double?, val speedMps: Double?, val track: Double?,
    val positionTime: Double, val source: SkySource, val sources: Set<SkySource> = setOf(source)) {
    val label get() = callsign ?: registration ?: key.removePrefix("icao:").uppercase(Locale.ROOT)
    fun age(now: Double) = max(0.0, now-positionTime)
}
internal data class SkyFeed(val source: SkySource, val aircraft: List<SkyAircraft>, val message: String,
    val ok: Boolean, val received: Double, val remaining: Int? = null)

/** Pure normalization and geodesy. A position and its timestamp always travel together. */
internal object SkyData {
    const val MAX_AGE = 120.0
    const val STALE_AGE = 30.0
    const val MAX_ROWS = 5000
    fun distance(a: SkyPoint,b: SkyPoint): Double {
        val p1=Math.toRadians(a.lat); val p2=Math.toRadians(b.lat)
        val dlat=p2-p1; val dlon=Math.toRadians(b.lon-a.lon)
        val h=sin(dlat/2).pow(2)+cos(p1)*cos(p2)*sin(dlon/2).pow(2)
        return 6371.0088*2*asin(sqrt(h.coerceIn(0.0,1.0)))
    }
    fun number(value: Any?): Double? = (value as? Number)?.toDouble()?.takeIf { it.isFinite() }
    private fun text(value: Any?): String? = (value as? String)?.filter { it.code in 32..126 }?.trim()?.take(32)?.takeIf { it.isNotBlank() }
    private fun point(lat: Any?,lon: Any?): SkyPoint? {
        val a=number(lat) ?: return null; val b=number(lon) ?: return null
        return if (a in -85.0..85.0 && b in -180.0..180.0) SkyPoint(a,b) else null
    }
    private fun key(raw: Any?, source: SkySource): String? {
        val s=(raw as? String)?.lowercase(Locale.ROOT) ?: return null
        return when {
            Regex("[0-9a-f]{6}").matches(s) -> "icao:$s"
            source==SkySource.ADSB && Regex("~[0-9a-f]{6}").matches(s) -> "adsb:$s"
            else -> null
        }
    }
    private fun time(value: Double?, now: Double) = value?.takeIf { it>0 && it<=now+10 && now-it<=MAX_AGE }
    private fun altitude(value: Any?) = number(value)?.takeIf { it in -1000.0..30000.0 }
    private fun speed(value: Any?) = number(value)?.takeIf { it in 0.0..1500.0 }
    private fun track(value: Any?) = number(value)?.takeIf { it in 0.0..360.0 }?.rem(360.0)
    fun adsb(root: JSONObject, now: Double): List<SkyAircraft> {
        val rows=root.optJSONArray("ac") ?: throw ConstructError("SKY_DATA", "ADSB.lol returned an unexpected response.")
        // v2 now is epoch milliseconds, while seen_pos is seconds. Reject stale server snapshots.
        val stamp=number(root.opt("now"))?.div(1000) ?: throw ConstructError("SKY_DATA", "ADSB.lol response has no timestamp.")
        checkRule(stamp>0 && stamp<=now+10 && now-stamp<=MAX_AGE,"SKY_DATA","ADSB.lol snapshot is out of date.")
        checkRule(rows.length()<=MAX_ROWS,"SKY_DATA","Too many aircraft in this area; reduce the radius.")
        return (0 until rows.length()).mapNotNull { i ->
            val a=rows.optJSONObject(i) ?: return@mapNotNull null
            if (a.opt("alt_baro")=="ground") return@mapNotNull null
            val id=key(a.opt("hex"),SkySource.ADSB) ?: return@mapNotNull null
            val p=point(a.opt("lat"),a.opt("lon")) ?: return@mapNotNull null
            val seen=number(a.opt("seen_pos"))?.takeIf { it>=0 } ?: return@mapNotNull null
            val t=time(stamp-seen,now) ?: return@mapNotNull null
            SkyAircraft(id,text(a.opt("flight")),text(a.opt("r")),text(a.opt("t")),p,
                altitude(number(a.opt("alt_baro"))?.times(0.3048)),speed(number(a.opt("gs"))?.times(0.514444)),
                track(a.opt("track")),t,SkySource.ADSB)
        }
    }
    fun opensky(root: JSONObject, now: Double): List<SkyAircraft> {
        val stamp=number(root.opt("time")) ?: throw ConstructError("SKY_DATA","OpenSky response has no timestamp.")
        checkRule(stamp>0 && stamp<=now+10 && now-stamp<=MAX_AGE,"SKY_DATA","OpenSky snapshot is out of date.")
        if (root.has("states") && root.isNull("states")) return emptyList()
        val rows=root.optJSONArray("states") ?: throw ConstructError("SKY_DATA","OpenSky returned an unexpected response.")
        checkRule(rows.length()<=MAX_ROWS,"SKY_DATA","Too many aircraft in this area; reduce the radius.")
        return (0 until rows.length()).mapNotNull { i ->
            val a=rows.optJSONArray(i) ?: return@mapNotNull null
            if (a.length()<17 || a.opt(8)!=false) return@mapNotNull null
            val id=key(a.opt(0),SkySource.OPENSKY) ?: return@mapNotNull null
            val p=point(a.opt(6),a.opt(5)) ?: return@mapNotNull null
            // last_contact may be fresh without a new position. Never substitute it for time_position.
            val t=time(number(a.opt(3)),now) ?: return@mapNotNull null
            SkyAircraft(id,text(a.opt(1)),null,null,p,altitude(a.opt(7)),speed(a.opt(9)),track(a.opt(10)),t,SkySource.OPENSKY)
        }
    }
    fun merge(feeds: List<SkyFeed>, mode: SkyMode, center: SkyPoint, radiusKm: Int, now: Double): List<SkyAircraft> =
        feeds.filter { it.source in mode.sources }.flatMap { it.aircraft }.filter { it.age(now)<=MAX_AGE && it.positionTime<=now+10 }
            .groupBy { it.key }.values.map { reports ->
                // Select the newest coherent observation, not an average of two positions/altitudes.
                val newest=reports.sortedWith(compareByDescending<SkyAircraft> { it.positionTime }.thenBy { it.source.ordinal }).first()
                newest.copy(sources=reports.map { it.source }.toSet())
            }.filter { distance(center,it.point)<=radiusKm }
            .sortedWith(compareBy<SkyAircraft> { distance(center,it.point) }.thenBy { it.key })
    /** Split antimeridian-crossing bounds rather than issuing an invalid or global request. */
    fun boxes(center: SkyPoint, radiusKm: Int): List<DoubleArray> {
        require(radiusKm in 1..100)
        val dlat=Math.toDegrees(radiusKm/6371.0088)
        val dlon=Math.toDegrees(asin((sin(radiusKm/6371.0088)/cos(Math.toRadians(center.lat))).coerceIn(-1.0,1.0)))
        val lo=(center.lat-dlat).coerceAtLeast(-90.0); val hi=(center.lat+dlat).coerceAtMost(90.0)
        val left=center.lon-dlon; val right=center.lon+dlon
        return when { left< -180 -> listOf(doubleArrayOf(lo,left+360,hi,180.0), doubleArrayOf(lo,-180.0,hi,right))
            right>180 -> listOf(doubleArrayOf(lo,left,hi,180.0),doubleArrayOf(lo,-180.0,hi,right-360))
            else -> listOf(doubleArrayOf(lo,left,hi,right)) }
    }
}

/** Web Mercator in unit-world coordinates, with wrapped longitude. */
internal object SkyProjection {
    fun x(lon: Double)=(lon+180)/360
    fun y(lat: Double): Double { val s=sin(Math.toRadians(lat.coerceIn(-85.0,85.0))); return 0.5-ln((1+s)/(1-s))/(4*PI) }
    fun point(x: Double,y: Double)=SkyPoint(Math.toDegrees(atan(sinh(PI*(1-2*y.coerceIn(0.001638,0.998362))))).coerceIn(-85.0,85.0),((x%1+1)%1)*360-180)
    fun deltaX(x: Double,center: Double): Double { val d=x-center; return d-round(d) }
}
