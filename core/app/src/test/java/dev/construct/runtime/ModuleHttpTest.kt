package dev.construct.runtime

import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test
import okhttp3.Call
import okhttp3.OkHttpClient
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit

class ModuleHttpTest {
    @Test fun socketCancellationAndPoolCleanupRunOffTheCallerThread() {
        val caller = Thread.currentThread()
        val client = OkHttpClient()
        val cancelled = CountDownLatch(1)
        var sameThread = true
        val call = object : Call by client.newCall(Request.Builder().url("https://example.org/").build()) {
            override fun cancel() { sameThread = Thread.currentThread() === caller; cancelled.countDown() }
        }
        ModuleHttp.releaseResources(listOf(call), client)
        assertTrue(cancelled.await(5, TimeUnit.SECONDS))
        assertFalse("TLS socket cancellation must not run on the UI caller", sameThread)
        val drained = CountDownLatch(1)
        val barrier = object : Call by call { override fun cancel() { drained.countDown() } }
        ModuleHttp.releaseResources(listOf(barrier))
        assertTrue(drained.await(5, TimeUnit.SECONDS))
        assertTrue(client.dispatcher.executorService.isShutdown)
    }
    @Test fun pausedCleanupDoesNotCancelResumedCallsOrCloseTheirDispatcher() {
        val client = OkHttpClient()
        var oldCancelled = false
        var newCancelled = false
        val delegate = client.newCall(Request.Builder().url("https://example.org/").build())
        val old = object : Call by delegate { override fun cancel() { oldCancelled = true } }
        val resumed = object : Call by delegate { override fun cancel() { newCancelled = true } }
        val calls = mutableListOf<Call>(old)
        val queued = mutableListOf<Runnable>()
        ModuleHttp.releaseResources(calls.toList(), executor = Executor { queued.add(it) })
        calls.add(resumed)
        assertFalse(oldCancelled)
        queued.single().run()
        assertTrue(oldCancelled)
        assertFalse(newCancelled)
        assertFalse(client.dispatcher.executorService.isShutdown)
        client.dispatcher.executorService.shutdown()
    }
    private fun response(body: String, mime: String="application/json", status: Int=200)=Response.Builder()
        .request(Request.Builder().url("https://example.org/data").build()).protocol(Protocol.HTTP_1_1)
        .code(status).message("Test").header("Set-Cookie","private=value").header("Retry-After","60")
        .header("Location","https://unapproved.example.org/").body(body.toResponseBody(mime.toMediaType())).build()
    private fun denied(code: String, action: ()->Unit) {
        try { action();fail("Expected $code") } catch(e: ConstructError) { assertEquals(code,e.code) }
    }
    @Test fun transportReturnsRawJsonWithoutDomainInterpretationOrCookieHeaders() {
        var authorizations=0
        val r=ModuleHttp.readResponse(response("{\"arbitrary\":[1,2,3]}"),"json") {authorizations++}
        assertEquals(200,r.getInt("status"));assertEquals("{\"arbitrary\":[1,2,3]}",r.getString("text"))
        assertEquals(setOf("retry-after"),r.getJSONObject("headers").keys().asSequence().toSet())
        assertEquals(2,authorizations)
    }
    @Test fun nonSuccessReturnsStatusNotErrorPagesOrRedirectDestination() {
        for(status in listOf(301,302,401,404,429,500)) {
            val r=ModuleHttp.readResponse(response("<html>sensitive</html>","text/html",status),"json"){}
            assertEquals(status,r.getInt("status"));assertFalse(r.has("text"));assertFalse(r.has("dataUrl"))
            assertFalse(r.getJSONObject("headers").has("location"))
        }
    }
    @Test fun wrongFormatOversizeAndDisguisedRasterRejected() {
        denied("HTTP_DATA") { ModuleHttp.readResponse(response("<html>","text/html"),"json"){} }
        denied("HTTP_SIZE") { ModuleHttp.readResponse(response("x".repeat(2*1024*1024+1)),"json"){} }
        denied("HTTP_SIZE") { ModuleHttp.readResponse(response("x".repeat(256*1024+1),"image/png"),"image"){} }
        denied("HTTP_DATA") { ModuleHttp.readResponse(response("<svg>","image/png"),"image"){} }
    }
    @Test fun authorizationIsRecheckedAfterResponseConsumption() {
        var checks=0
        denied("CAPABILITY_DENIED") { ModuleHttp.readResponse(response("{\"data\":1}"),"json") {
            if(++checks==2)throw ConstructError("CAPABILITY_DENIED","Revoked during request")
        } }
        assertEquals(2,checks)
    }
}
