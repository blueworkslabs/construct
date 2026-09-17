package dev.construct.runtime

import android.Manifest
import android.location.Location
import android.location.LocationManager
import android.os.Looper
import android.os.SystemClock
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RuntimeEnvironment
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[28])
@LooperMode(LooperMode.Mode.PAUSED)
class ModuleLocationTest {
    private val app get()=RuntimeEnvironment.getApplication()
    private val manager get()=app.getSystemService(LocationManager::class.java)
    private var authorized=true
    private lateinit var source: ModuleLocation
    private fun params()=JSONObject().put("op","get")
    private fun fix()=Location(LocationManager.GPS_PROVIDER).apply {
        latitude=50.0;longitude=8.0;accuracy=20f;time=System.currentTimeMillis();elapsedRealtimeNanos=SystemClock.elapsedRealtimeNanos()
    }
    private fun rejected(code: String, action: ()->Unit) {
        try { action();fail("Expected $code") } catch(e: ConstructError) { assertEquals(code,e.code) }
    }
    @Before fun setup() {
        shadowOf(app).denyPermissions(Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION)
        shadowOf(manager).setProviderEnabled(LocationManager.GPS_PROVIDER,true)
        shadowOf(manager).setProviderEnabled(LocationManager.NETWORK_PROVIDER,false)
        source=ModuleLocation(app) { if(!authorized)throw ConstructError("CAPABILITY_DENIED","Denied") }
    }
    @Test fun bothNativePermissionAndModuleGrantAreRequiredWithoutPrompting() {
        rejected("LOCATION_PERMISSION") { source.get(params()) { _,_->fail() } }
        shadowOf(app).grantPermissions(Manifest.permission.ACCESS_COARSE_LOCATION);authorized=false
        rejected("CAPABILITY_DENIED") { source.get(params()) { _,_->fail() } }
        source.close();rejected("RUN_STALE") { source.get(params()) { _,_->fail() } }
    }
    @Test fun recentFixCarriesAccuracyAndApproximateFlagAndRateLimit() {
        shadowOf(app).grantPermissions(Manifest.permission.ACCESS_COARSE_LOCATION)
        shadowOf(manager).setProviderEnabled(LocationManager.NETWORK_PROVIDER,true)
        shadowOf(manager).setLastKnownLocation(LocationManager.NETWORK_PROVIDER,fix().apply { provider=LocationManager.NETWORK_PROVIDER })
        var value:JSONObject?=null
        source.get(params()){v,e->assertNull(e);value=v}
        assertEquals(50.0,value!!.getDouble("latitude"),0.0);assertEquals(20.0,value!!.getDouble("accuracyM"),0.0)
        assertTrue(value!!.getBoolean("approximate"))
        rejected("LOCATION_RATE") { source.get(params()){_,_->fail()} }
    }
    @Test fun coarseOnlyRequestRegistersNetworkWithoutTouchingFineOnlyGps() {
        shadowOf(app).grantPermissions(Manifest.permission.ACCESS_COARSE_LOCATION)
        shadowOf(manager).setProviderEnabled(LocationManager.NETWORK_PROVIDER,true)
        var value:JSONObject?=null
        source.get(params()){v,e->assertNull(e);value=v}
        assertEquals(0,shadowOf(manager).getLocationUpdateListeners(LocationManager.GPS_PROVIDER).size)
        assertEquals(1,shadowOf(manager).getLocationUpdateListeners(LocationManager.NETWORK_PROVIDER).size)
        shadowOf(manager).simulateLocation(fix().apply { provider=LocationManager.NETWORK_PROVIDER;accuracy=5000f })
        shadowOf(Looper.getMainLooper()).idle()
        assertTrue(value!!.getBoolean("approximate"))
        assertEquals(5000.0,value!!.getDouble("accuracyM"),0.0)
        assertTrue(shadowOf(manager).getRequestLocationUpdateListeners().isEmpty())
    }
    @Test fun coarseOnlyPermissionWithOnlyGpsEnabledFailsWithoutRegisteringGps() {
        shadowOf(app).grantPermissions(Manifest.permission.ACCESS_COARSE_LOCATION)
        var code:String?=null
        source.get(params()){v,e->assertNull(v);code=e?.code}
        assertEquals("LOCATION_UNAVAILABLE",code)
        assertTrue(shadowOf(manager).getRequestLocationUpdateListeners().isEmpty())
    }
    @Test fun precisePermissionRetainsNetworkAndGpsProviders() {
        shadowOf(app).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION)
        shadowOf(manager).setProviderEnabled(LocationManager.NETWORK_PROVIDER,true)
        source.get(params()){_,_->}
        assertEquals(1,shadowOf(manager).getLocationUpdateListeners(LocationManager.GPS_PROVIDER).size)
        assertEquals(1,shadowOf(manager).getLocationUpdateListeners(LocationManager.NETWORK_PROVIDER).size)
        source.close()
        assertTrue(shadowOf(manager).getRequestLocationUpdateListeners().isEmpty())
    }
    @Test fun cancelDropsPendingFixAndRemovesTimeout() {
        shadowOf(app).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION)
        var calls=0;var code:String?=null
        source.get(params()){v,e->calls++;assertNull(v);code=e?.code}
        rejected("LOCATION_BUSY") { source.get(params()){_,_->fail()} }
        source.cancel();assertEquals("LOCATION_CANCELLED",code)
        shadowOf(manager).simulateLocation(fix());shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(20))
        assertEquals(1,calls)
    }
    @Test fun revokedGrantCannotReceiveDelayedFix() {
        shadowOf(app).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION)
        var code:String?=null
        source.get(params()){v,e->assertNull(v);code=e?.code};authorized=false
        shadowOf(manager).simulateLocation(fix());shadowOf(Looper.getMainLooper()).idle()
        assertEquals("CAPABILITY_DENIED",code)
    }
    @Test fun staleCachedFixTimesOutInsteadOfBeingReturned() {
        shadowOf(app).grantPermissions(Manifest.permission.ACCESS_FINE_LOCATION)
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(180))
        shadowOf(manager).setLastKnownLocation(LocationManager.GPS_PROVIDER,fix().apply { elapsedRealtimeNanos=1 })
        var code:String?=null
        source.get(params()){v,e->assertNull(v);code=e?.code}
        assertNull(code);shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(13))
        assertEquals("LOCATION_TIMEOUT",code)
    }
}
