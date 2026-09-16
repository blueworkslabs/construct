package dev.construct.runtime

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SkyMetadataTest {
    private fun aircraft(icao: String="abc123")=JSONObject().put("response",JSONObject().put("aircraft",JSONObject()
        .put("mode_s",icao.uppercase()).put("registration","TEST-REG").put("icao_type","A20N")
        .put("manufacturer","Airbus").put("type","A320-271N").put("registered_owner","Example lessor")
        .put("registered_owner_country_name","Example country").put("url_photo","https://example.invalid/not-fetched.jpg")))
    private fun airline(code: String="TST")=JSONObject().put("response",JSONArray().put(JSONObject().put("icao",code).put("name","Test Air")))
    private fun observation(key: String="icao:abc123",call: String?="TST123")=SkyAircraft(key,call,null,null,SkyPoint(50.0,8.0),null,null,null,1.0,SkySource.OPENSKY)
    @Test fun requestsOnlyRealIcaoAndRecognizableCallsignPrefixes() {
        assertEquals(SkyLookupRequest("abc123","TST"),SkyLookupRequest.from(observation()))
        assertNull(SkyLookupRequest.from(observation("adsb:~abc123")))
        assertNull(SkyLookupRequest.from(observation("icao:../../")))
        for(call in listOf("N123AB","D-ABCD","TEST","TST123456","<script>",null)) assertNull(SkyLookupRequest.from(observation(call=call))!!.airline)
        try { SkyLookupRequest("abc123","../");fail() } catch(_: IllegalArgumentException) { }
    }
    @Test fun parserChecksIdentityAndDoesNotInferOperatorFromOwner() {
        val info=SkyMetadata.parseAircraft(aircraft(),"abc123",100).aircraft!!
        assertEquals("Example lessor",info.owner);assertEquals("A20N",info.typeCode)
        assertEquals("Test Air",SkyMetadata.parseAirline(airline(),"TST",100).airline)
        assertNull(SkyMetadata.parseAirline(airline("OTH"),"TST",100).airline)
        try { SkyMetadata.parseAircraft(aircraft("def456"),"abc123",100);fail() } catch(e: ConstructError) { assertEquals("SKY_DATA",e.code) }
    }
    @Test fun unknownAndMalformedValuesStayUnknownAndBidiControlsAreRemoved() {
        val json=aircraft();val a=json.getJSONObject("response").getJSONObject("aircraft")
        a.put("registered_owner","\u202eA\nB".repeat(100));a.put("type",JSONObject.NULL);a.put("icao_type","../../")
        val info=SkyMetadata.parseAircraft(json,"abc123",100).aircraft!!
        assertNull(info.model);assertNull(info.typeCode);assertEquals(120,info.owner!!.length)
        assertFalse(info.owner.contains('\u202e'));assertFalse(info.owner.contains('\n'))
    }
    @Test fun sessionCacheExpiresAndAirlineIsKeyedSeparatelyFromAircraft() {
        val paths=mutableListOf<String>();var at=1000L
        val client=SkyMetadata({}, { p -> paths+=p;if(p.startsWith("aircraft/")) aircraft() else airline(p.substringAfter('/')) },{at})
        client.lookup(SkyLookupRequest("abc123","TST"));client.lookup(SkyLookupRequest("abc123","TST"))
        assertEquals(listOf("aircraft/abc123","airline/TST"),paths)
        client.lookup(SkyLookupRequest("abc123","OTH"));assertEquals("airline/OTH",paths.last());assertEquals(3,paths.size)
        at+=3600001;client.lookup(SkyLookupRequest("abc123",null));assertEquals(4,paths.size)
    }
    @Test fun lookupFailureDoesNotEraseOtherPartAndNotFoundIsBrieflyCached() {
        var calls=0;var at=1L
        val client=SkyMetadata({}, { p -> calls++;if(p.startsWith("aircraft/")) throw ConstructError("SKY_NOT_FOUND","No matching record") else airline() },{at})
        val result=client.lookup(SkyLookupRequest("abc123","TST"))
        assertNull(result.aircraft.aircraft);assertEquals("Test Air",result.airline!!.airline)
        client.lookup(SkyLookupRequest("abc123","TST"));assertEquals(2,calls)
        at+=300001;client.lookup(SkyLookupRequest("abc123","TST"));assertEquals(3,calls)
    }
    @Test fun transientFailuresAreRetryableAndDoNotBecomeCachedFacts() {
        var calls=0
        val client=SkyMetadata({}, { calls++;if(calls==1) throw ConstructError("SKY_NETWORK","Offline") else aircraft() })
        assertNull(client.lookup(SkyLookupRequest("abc123",null)).aircraft.aircraft)
        assertNotNull(client.lookup(SkyLookupRequest("abc123",null)).aircraft.aircraft);assertEquals(2,calls)
    }
    @Test fun cacheIsBounded() {
        var calls=0
        val client=SkyMetadata({}, { p -> calls++;aircraft(p.substringAfter('/')) })
        for(i in 0..64) client.lookup(SkyLookupRequest("%06x".format(i),null))
        client.lookup(SkyLookupRequest("000000",null));assertEquals(66,calls)
    }
    @Test fun revocationIsCheckedForCachedDataAndAfterTransport() {
        var allowed=true;var calls=0
        val authorize={ if(!allowed) throw ConstructError("CAPABILITY_DENIED","Denied") }
        val client=SkyMetadata(authorize,{ calls++;aircraft() })
        client.lookup(SkyLookupRequest("abc123",null));allowed=false
        try { client.lookup(SkyLookupRequest("abc123",null));fail() } catch(e: ConstructError) { assertEquals("CAPABILITY_DENIED",e.code) }
        assertEquals(1,calls)
        allowed=true
        val mid=SkyMetadata(authorize,{ allowed=false;aircraft() })
        try { mid.lookup(SkyLookupRequest("abc123",null));fail() } catch(e: ConstructError) { assertEquals("CAPABILITY_DENIED",e.code) }
    }
    @Test fun closingPreventsCachedAndLateResponses() {
        lateinit var client: SkyMetadata
        client=SkyMetadata({}, { client.close();aircraft() })
        try { client.lookup(SkyLookupRequest("abc123",null));fail() } catch(e: ConstructError) { assertEquals("SKY_CLOSED",e.code) }
        val cached=SkyMetadata({}, { aircraft() });cached.lookup(SkyLookupRequest("abc123",null));cached.close()
        try { cached.lookup(SkyLookupRequest("abc123",null));fail() } catch(e: ConstructError) { assertEquals("SKY_CLOSED",e.code) }
    }
}
