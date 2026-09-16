package dev.construct.runtime

import org.json.JSONObject
import java.util.Locale

internal data class SkyLookupRequest(val icao: String,val airline: String?) {
    init { require(Regex("[0-9a-f]{6}").matches(icao)); require(airline==null || Regex("[A-Z]{3}").matches(airline)) }
    companion object {
        fun from(a: SkyAircraft): SkyLookupRequest? {
            if(!Regex("icao:[0-9a-f]{6}").matches(a.key)) return null
            val call=a.callsign?.uppercase(Locale.ROOT)
            val prefix=call?.takeIf { Regex("[A-Z]{3}[0-9][A-Z0-9]{0,4}").matches(it) }?.take(3)
            return SkyLookupRequest(a.key.removePrefix("icao:"),prefix)
        }
    }
}
internal data class SkyAircraftInfo(val registration: String?,val typeCode: String?,val model: String?,
    val manufacturer: String?,val owner: String?,val country: String?)
internal data class SkyMetadataPart(val aircraft: SkyAircraftInfo?=null,val airline: String?=null,
    val message: String?=null,val checkedAt: Long)
internal data class SkyMetadataResult(val request: SkyLookupRequest,val aircraft: SkyMetadataPart,val airline: SkyMetadataPart?)

/** Only public aircraft/airline endpoints. No flight-route data or photos are read or stored.
 * Cache lifetime is the open workspace, bounded to 64 records; successful facts expire in one hour.
 * Access is rechecked even for cache hits and after transport failures. */
internal class SkyMetadata(private val authorize: () -> Unit,private val fetch: (String) -> JSONObject,
    private val clock: () -> Long = { System.currentTimeMillis() }) {
    private data class Cached(val part: SkyMetadataPart,val expiry: Long)
    private val cache=LinkedHashMap<String,Cached>()
    @Volatile private var closed=false
    private fun check() { checkRule(!closed,"SKY_CLOSED","Aircraft lookup is closed."); authorize() }
    fun close() { synchronized(cache) { closed=true; cache.clear() } }
    fun lookup(request: SkyLookupRequest): SkyMetadataResult {
        check()
        val aircraft=part("aircraft/${request.icao}") { json,at -> parseAircraft(json,request.icao,at) }
        val airline=request.airline?.let { code -> part("airline/$code") { json,at -> parseAirline(json,code,at) } }
        check(); return SkyMetadataResult(request,aircraft,airline)
    }
    private fun part(path: String,parse: (JSONObject,Long)->SkyMetadataPart): SkyMetadataPart {
        check()
        synchronized(cache) { cache[path]?.takeIf { it.expiry>clock() }?.let { return it.part } }
        var ttl=3600000L
        val part=try { val json=fetch(path); check(); parse(json,clock()) }
        catch(e: Exception) {
            check() // Never turn revocation or closing into a reusable result.
            if(e is ConstructError && e.code=="SKY_NOT_FOUND") ttl=300000L else ttl=0
            SkyMetadataPart(message=(e as? ConstructError)?.message ?: "Lookup unavailable. Tracking still works.",checkedAt=clock())
        }
        synchronized(cache) {
            check()
            if(ttl>0) { cache[path]=Cached(part,clock()+ttl); while(cache.size>64) cache.remove(cache.keys.first()) }
        }
        return part
    }
    companion object {
        private fun text(value: Any?): String?=(value as? String)?.filter {
            !it.isISOControl() && Character.getType(it)!=Character.FORMAT.toInt() && !it.isSurrogate()
        }?.trim()?.take(120)?.takeIf { it.isNotEmpty() }
        fun parseAircraft(json: JSONObject,icao: String,at: Long): SkyMetadataPart {
            val a=json.optJSONObject("response")?.optJSONObject("aircraft")
                ?: throw ConstructError("SKY_DATA","Aircraft database returned an unexpected response.")
            checkRule((a.opt("mode_s") as? String)?.lowercase(Locale.ROOT)==icao,"SKY_DATA","Aircraft database identity did not match.")
            val code=text(a.opt("icao_type"))?.uppercase(Locale.ROOT)?.takeIf { Regex("[A-Z0-9]{2,4}").matches(it) }
            return SkyMetadataPart(aircraft=SkyAircraftInfo(text(a.opt("registration")),code,text(a.opt("type")),
                text(a.opt("manufacturer")),text(a.opt("registered_owner")),text(a.opt("registered_owner_country_name"))),checkedAt=at)
        }
        fun parseAirline(json: JSONObject,code: String,at: Long): SkyMetadataPart {
            val rows=json.optJSONArray("response") ?: throw ConstructError("SKY_DATA","Airline database returned an unexpected response.")
            checkRule(rows.length()<=20,"SKY_DATA","Too many airline matches.")
            val names=(0 until rows.length()).mapNotNull { rows.optJSONObject(it) }.filter { it.opt("icao")==code }
                .mapNotNull { text(it.opt("name")) }.distinct()
            return SkyMetadataPart(airline=names.singleOrNull(),message=if(names.size==1) null else "No unambiguous airline match.",checkedAt=at)
        }
    }
}
