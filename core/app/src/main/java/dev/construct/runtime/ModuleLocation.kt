package dev.construct.runtime

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import org.json.JSONObject

/** One foreground result; Android permission is granted only in native Module access. */
internal class ModuleLocation(private val context: Context, private val authorize: () -> Unit) {
    private val handler = Handler(Looper.getMainLooper())
    private val manager = context.getSystemService(LocationManager::class.java)
    private var listener: LocationListener? = null
    private var completion: ((JSONObject?, ConstructError?) -> Unit)? = null
    private var timeout: Runnable? = null
    private var closed = false
    private var lastRequest = -15000L
    private fun check() {
        checkRule(!closed, "RUN_STALE", "Location session closed"); authorize()
        checkRule(hasPermission(context), "LOCATION_PERMISSION", "Allow Android location access in Module access, then reopen")
    }
    fun cancel() {
        listener?.let { runCatching { manager.removeUpdates(it) } }; listener = null
        timeout?.let { handler.removeCallbacks(it) }; timeout = null
        val done = completion; completion = null
        done?.invoke(null, ConstructError("LOCATION_CANCELLED", "Location request cancelled"))
    }
    fun close() { closed = true; cancel() }
    private fun deliver(location: Location) {
        val done = completion ?: return
        val result = try {
            check()
            checkRule(location.latitude.isFinite() && location.latitude in -90.0..90.0 &&
                location.longitude.isFinite() && location.longitude in -180.0..180.0 && location.hasAccuracy() &&
                location.accuracy.isFinite() && location.accuracy >= 0 && location.time > 0 &&
                SystemClock.elapsedRealtimeNanos() - location.elapsedRealtimeNanos in 0..120000000000L, "LOCATION_DATA", "Invalid location result")
            JSONObject().put("latitude", location.latitude).put("longitude", location.longitude)
                .put("accuracyM", location.accuracy.toDouble()).put("timestamp", location.time)
                .put("approximate", context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED)
        } catch (e: Exception) {
            completion = null; cancel(); done(null, (e as? ConstructError) ?: ConstructError("LOCATION_UNAVAILABLE", "Location unavailable")); return
        }
        completion = null; cancel(); done(result, null)
    }
    @android.annotation.SuppressLint("MissingPermission")
    fun get(params: JSONObject, done: (JSONObject?, ConstructError?) -> Unit) {
        check(); checkRule(params.keys().asSequence().toSet() == setOf("op") && params.opt("op") == "get", "LOCATION_PARAMS", "Expected op:get")
        checkRule(completion == null, "LOCATION_BUSY", "A location request is already running")
        val now = SystemClock.elapsedRealtime()
        checkRule(now - lastRequest >= 15000, "LOCATION_RATE", "Wait 15 seconds between location requests")
        lastRequest = now; completion = done
        try {
            val providers = listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER).filter { manager.isProviderEnabled(it) }
            checkRule(providers.isNotEmpty(), "LOCATION_UNAVAILABLE", "Turn on phone location or choose an area manually")
            val recent = providers.mapNotNull { runCatching { manager.getLastKnownLocation(it) }.getOrNull() }
                .filter { SystemClock.elapsedRealtimeNanos() - it.elapsedRealtimeNanos in 0..120000000000L }
                .maxByOrNull { it.elapsedRealtimeNanos }
            if (recent != null) { deliver(recent); return }
            listener = LocationListener { location -> deliver(location) }
            providers.forEach { manager.requestLocationUpdates(it, 0, 0f, listener!!, Looper.getMainLooper()) }
            timeout = Runnable {
                val pending = completion; completion = null; cancel()
                pending?.invoke(null, ConstructError("LOCATION_TIMEOUT", "No recent location fix; retry or choose an area manually"))
            }.also { handler.postDelayed(it, 12000) }
        } catch (e: Exception) {
            completion = null; cancel(); done(null, (e as? ConstructError) ?: ConstructError("LOCATION_UNAVAILABLE", "Location unavailable; check Android permission"))
        }
    }
    companion object {
        fun hasPermission(context: Context) = context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
    }
}
