package dev.construct.runtime

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SkyDataTest {
    private val now=1700000000.0
    private val center=SkyPoint(50.0,8.0)
    private fun adsb(vararg changes: Pair<String,Any>): JSONObject {
        val row=JSONObject().put("hex","abc123").put("flight"," TEST123 ").put("lat",50.01).put("lon",8.01)
            .put("alt_baro",10000).put("gs",200).put("track",90).put("seen_pos",2)
        changes.forEach { row.put(it.first,it.second) }
        return JSONObject().put("now",now*1000).put("ac",JSONArray().put(row))
    }
    private fun opensky(vararg changes: Pair<Int,Any>): JSONObject {
        val row=JSONArray(listOf("abc123"," TEST123 ","Unknown",now-1,now,8.01,50.01,3000,false,100,90,0,JSONObject.NULL,3050,"1234",false,0))
        changes.forEach { row.put(it.first,it.second) }
        return JSONObject().put("time",now).put("states",JSONArray().put(row))
    }
    private fun feed(source: SkySource, rows: List<SkyAircraft>,ok: Boolean=true)=SkyFeed(source,rows,"",ok,now)
    @Test fun normalizesUnitsAndUsesPositionAge() {
        val a=SkyData.adsb(adsb(),now).single()
        assertEquals("TEST123",a.callsign); assertEquals(3048.0,a.altitudeM!!,0.001)
        assertEquals(102.8888,a.speedMps!!,0.001); assertEquals(now-2,a.positionTime,0.0)
        val o=SkyData.opensky(opensky(),now).single(); assertEquals(3000.0,o.altitudeM!!,0.0)
    }
    @Test fun invalidPositionsNeverBecomeZeroCoordinates() {
        for(v in listOf(JSONObject.NULL,"50",100,Double.POSITIVE_INFINITY.toString())) {
            assertTrue(SkyData.adsb(adsb("lat" to v),now).isEmpty())
            assertTrue(SkyData.opensky(opensky(6 to v),now).isEmpty())
        }
    }
    @Test fun surfaceTrafficAndMissingPositionTimeAreExcluded() {
        assertTrue(SkyData.adsb(adsb("alt_baro" to "ground"),now).isEmpty())
        assertTrue(SkyData.opensky(opensky(8 to true),now).isEmpty())
        assertTrue(SkyData.opensky(opensky(3 to JSONObject.NULL),now).isEmpty())
        assertTrue(SkyData.opensky(opensky(3 to now-121,4 to now),now).isEmpty())
        assertTrue(SkyData.adsb(adsb("seen_pos" to -1),now).isEmpty())
    }
    @Test fun staleOrFutureSnapshotsAreRejected() {
        for(stamp in listOf(now-121,now+11)) {
            try { SkyData.adsb(adsb().put("now",stamp*1000),now); fail() } catch(_: ConstructError) { }
            try { SkyData.opensky(opensky().put("time",stamp),now); fail() } catch(_: ConstructError) { }
        }
        assertTrue(SkyData.opensky(opensky(3 to now+11),now).isEmpty())
    }
    @Test fun emptyAndMalformedResponsesAreDifferent() {
        assertTrue(SkyData.opensky(opensky().put("states",JSONObject.NULL),now).isEmpty())
        try { SkyData.opensky(JSONObject().put("time",now),now); fail() } catch(_: ConstructError) { }
        try { SkyData.adsb(JSONObject().put("now",now*1000),now); fail() } catch(_: ConstructError) { }
    }
    @Test fun combinesByIcaoKeepingNewestCoherentObservation() {
        val a=SkyData.adsb(adsb("lat" to 50.02),now).single()
        val o=SkyData.opensky(opensky(1 to "NEW",7 to 1500),now).single()
        val merged=SkyData.merge(listOf(feed(a.source,listOf(a)),feed(o.source,listOf(o))),SkyMode.BOTH,center,25,now).single()
        assertEquals(o.point,merged.point);assertEquals(o.positionTime,merged.positionTime,0.0)
        assertEquals(o.altitudeM,merged.altitudeM); assertEquals("NEW",merged.label)
        assertEquals(setOf(SkySource.ADSB,SkySource.OPENSKY),merged.sources)
    }
    @Test fun combinedFillsIdentityWithoutMixingLiveObservationOrLeakingDisabledSources() {
        val a=SkyData.adsb(adsb("r" to "TEST-REG","t" to "A20N","category" to "A3"),now).single()
        val o=SkyData.opensky(opensky(1 to "NEW",7 to 1500),now).single()
        val feeds=listOf(feed(a.source,listOf(a)),feed(o.source,listOf(o)))
        val m=SkyData.merge(feeds,SkyMode.BOTH,center,25,now).single()
        assertEquals(o.point,m.point);assertEquals(o.altitudeM,m.altitudeM);assertEquals(o.positionTime,m.positionTime,0.0)
        assertEquals("A20N",m.type);assertEquals("TEST-REG",m.registration);assertEquals(SkySource.ADSB,m.typeSource)
        assertEquals("Large aircraft",m.category);assertFalse(m.identityConflict)
        val single=SkyData.merge(feeds,SkyMode.OPENSKY,center,25,now).single()
        assertNull(single.type);assertNull(single.registration);assertNull(single.category)
        val expired=SkyData.merge(feeds,SkyMode.BOTH,center,25,now+119).single()
        assertNull(expired.type) // Older identity does not outlive its source observation.
    }
    @Test fun conflictingIdentityIsFlaggedAndNewestKnownValueWins() {
        val old=SkyData.adsb(adsb("t" to "EC35","category" to "A7"),now).single()
        val newer=old.copy(type="A20N",positionTime=now,source=SkySource.OPENSKY,typeSource=SkySource.OPENSKY)
        val m=SkyData.merge(listOf(feed(old.source,listOf(old)),feed(newer.source,listOf(newer))),SkyMode.BOTH,center,25,now).single()
        assertEquals("A20N",m.type);assertTrue(m.identityConflict);assertEquals(SkyKind.UNKNOWN,SkyIdentity.kind(m))
    }
    @Test fun reportedCategoriesDoNotDependOnSpeedAndMissingCategoriesStayUnknown() {
        val rotor=SkyData.adsb(adsb("category" to "A7","gs" to 500),now).single()
        assertEquals(SkyKind.ROTORCRAFT,SkyIdentity.kind(rotor))
        assertEquals("Rotorcraft",SkyData.opensky(opensky(17 to 8),now).single().category)
        for(value in listOf(0,1,8.5,"8",JSONObject.NULL)) assertNull(SkyData.opensky(opensky(17 to value),now).single().category)
        assertEquals(SkyKind.UNKNOWN,SkyIdentity.kind(SkyData.adsb(adsb("gs" to 10,"alt_baro" to 100),now).single()))
        assertEquals("Airbus A320neo",SkyIdentity.name("A20N"));assertEquals("Aircraft type XXXX",SkyIdentity.name("XXXX"))
        assertEquals("Type unknown",SkyIdentity.name(null))
        assertEquals(SkyKind.UNKNOWN,SkyIdentity.kind(rotor.copy(type="A20N")))
        assertEquals(SkyKind.JET,SkyIdentity.model("B77L")!!.kind) // Not an assumed cargo flight.
        assertEquals(SkyKind.BUSINESS,SkyIdentity.model("C25C")!!.kind) // Model, not a private-flight claim.
    }
    @Test fun sourceSwitchCannotLeakOtherProviderAndFailureKeepsRecentCache() {
        val a=SkyData.adsb(adsb(),now).single(); val o=SkyData.opensky(opensky(0 to "def456"),now).single()
        val feeds=listOf(feed(a.source,listOf(a),false),feed(o.source,listOf(o)))
        assertEquals(listOf(a.key),SkyData.merge(feeds,SkyMode.ADSB,center,25,now).map { it.key })
        assertEquals(listOf(o.key),SkyData.merge(feeds,SkyMode.OPENSKY,center,25,now).map { it.key })
        assertEquals(2,SkyData.merge(feeds,SkyMode.BOTH,center,25,now).size)
        assertTrue(SkyData.merge(feeds,SkyMode.BOTH,center,25,now+122).isEmpty())
    }
    @Test fun switchingAwayAndBackDuringRequestFloorRetainsCacheUntilExpiry() {
        val a=SkyData.adsb(adsb(),now).single()
        val o=SkyData.opensky(opensky(0 to "def456"),now).single()
        var cached=SkyData.updateFeeds(emptyList(),listOf(feed(a.source,listOf(a))))
        cached=SkyData.updateFeeds(cached,listOf(feed(o.source,listOf(o))))
        assertEquals(listOf(o.key),SkyData.merge(cached,SkyMode.OPENSKY,center,25,now).map { it.key })
        val limited=SkyFeed(a.source,emptyList(),"Wait before refreshing",false,now+5)
        cached=SkyData.updateFeeds(cached,listOf(limited))
        assertEquals(listOf(a.key),SkyData.merge(cached,SkyMode.ADSB,center,25,now+5).map { it.key })
        assertEquals("Wait before refreshing",cached.single { it.source==a.source }.message)
        assertFalse(cached.single { it.source==a.source }.ok)
        assertEquals(2,SkyData.merge(cached,SkyMode.BOTH,center,25,now+5).size)
        assertTrue(SkyData.merge(cached,SkyMode.BOTH,center,25,now+122).isEmpty())
        // A successful empty snapshot replaces that source, but never the other source.
        cached=SkyData.updateFeeds(cached,listOf(feed(a.source,emptyList())))
        assertTrue(SkyData.merge(cached,SkyMode.ADSB,center,25,now+6).isEmpty())
        assertEquals(listOf(o.key),SkyData.merge(cached,SkyMode.BOTH,center,25,now+6).map { it.key })
    }
    @Test fun nonIcaoAddressesCannotCollideWithRealAircraft() {
        val a=SkyData.adsb(adsb("hex" to "~abc123"),now).single(); val o=SkyData.opensky(opensky(),now).single()
        assertEquals(2,SkyData.merge(listOf(feed(a.source,listOf(a)),feed(o.source,listOf(o))),SkyMode.BOTH,center,25,now).size)
    }
    @Test fun radiusFiltersBoundingBoxCornersAndLatestPositionOutsideRadius() {
        val a=SkyData.adsb(adsb("lat" to 50.2,"lon" to 8.3),now).single()
        assertTrue(SkyData.merge(listOf(feed(a.source,listOf(a))),SkyMode.ADSB,center,25,now).isEmpty())
        val old=a.copy(point=center,positionTime=now-20)
        assertTrue(SkyData.merge(listOf(feed(a.source,listOf(a,old))),SkyMode.ADSB,center,25,now).isEmpty())
    }
    @Test fun boundsAndDistanceHandleAntimeridian() {
        val p=SkyPoint(0.0,179.99)
        assertEquals(2,SkyData.boxes(p,25).size)
        for(b in SkyData.boxes(p,25)) { assertTrue(b[1]<b[3]); assertTrue(b[1]>= -180); assertTrue(b[3]<=180) }
        assertTrue(SkyData.distance(p,SkyPoint(0.0,-179.99))<3)
        assertEquals(1,SkyData.boxes(center,100).size)
    }
    @Test fun bearingAndCompassPointTheSpotter() {
        assertEquals(0.0,SkyData.bearing(center,SkyPoint(51.0,8.0)),0.01)
        assertEquals(90.0,SkyData.bearing(center,SkyPoint(50.0,8.5)),1.0)
        assertEquals(180.0,SkyData.bearing(center,SkyPoint(49.0,8.0)),0.01)
        assertEquals(270.0,SkyData.bearing(center,SkyPoint(50.0,7.5)),1.0)
        assertEquals("N",SkyData.compass(0.0)); assertEquals("N",SkyData.compass(359.0)); assertEquals("N",SkyData.compass(22.4))
        assertEquals("NE",SkyData.compass(22.5)); assertEquals("E",SkyData.compass(90.0)); assertEquals("SW",SkyData.compass(225.0))
        assertEquals("NW",SkyData.compass(-45.0)); assertEquals("S",SkyData.compass(540.0))
        assertEquals("E",SkyData.compass(SkyData.bearing(SkyPoint(0.0,179.9),SkyPoint(0.0,-179.9))))
    }
    @Test fun projectionRoundTripAndWrap() {
        for(p in listOf(center,SkyPoint(84.0,-179.0),SkyPoint(-84.0,179.0))) {
            val actual=SkyProjection.point(SkyProjection.x(p.lon),SkyProjection.y(p.lat))
            assertEquals(p.lat,actual.lat,1e-6);assertEquals(p.lon,actual.lon,1e-6)
        }
        assertEquals(0.002,SkyProjection.deltaX(0.001,0.999),1e-9)
    }
    @Test fun selectedMarkerAndLabelLeaveTheViewportTogether() {
        assertTrue(SkyProjection.markerVisible(180f,120f,360f,240f))
        assertTrue(SkyProjection.markerVisible(-30f,120f,360f,240f))
        assertTrue(SkyProjection.markerVisible(390f,120f,360f,240f))
        assertFalse(SkyProjection.markerVisible(-31f,120f,360f,240f))
        assertFalse(SkyProjection.markerVisible(391f,120f,360f,240f))
        assertFalse(SkyProjection.markerVisible(180f,-31f,360f,240f))
        assertFalse(SkyProjection.markerVisible(180f,271f,360f,240f))
    }
    @Test fun unknownFieldsRemainUnknownAndUntrustedLabelsAreBounded() {
        val a=SkyData.adsb(adsb("flight" to "\n<script>".repeat(20),"alt_baro" to JSONObject.NULL,"gs" to "fast","track" to -1),now).single()
        assertNull(a.altitudeM);assertNull(a.speedMps);assertNull(a.track)
        assertTrue(a.label.length<=32);assertFalse(a.label.contains('\n'))
    }
}
