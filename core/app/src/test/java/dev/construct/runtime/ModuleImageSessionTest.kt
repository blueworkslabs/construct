package dev.construct.runtime

import android.net.Uri
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class ModuleImageSessionTest {
    private fun denied(code: String, action: () -> Unit) {
        try { action(); fail("Expected $code") } catch (e: ConstructError) { assertEquals(code, e.code) }
    }
    @Test fun defaultDeniedNeverOpensPicker() {
        var opened = false
        val session = ModuleImageSession(RuntimeEnvironment.getApplication(), "https://test.construct.invalid",
            { throw ConstructError("CAPABILITY_DENIED", "Denied") }, { opened = true })
        denied("CAPABILITY_DENIED") { session.request("image.read", JSONObject("{op:pick}")) { _, _ -> fail() } }
        assertFalse(opened)
    }
    @Test fun callerCannotChooseUriPathSizeOrDictionary() {
        val session = ModuleImageSession(RuntimeEnvironment.getApplication(), "https://test.construct.invalid", {}, { fail("Invalid request opened picker") })
        for (raw in listOf("{}", "{op:pick,uri:'content://x'}", "{op:pick,path:'/x'}", "{op:pick,width:5000}", "{op:capture}")) {
            denied("IMAGE_PARAMS") { session.request("image.read", JSONObject(raw)) { _, _ -> fail() } }
        }
        denied("IMAGE_PARAMS") { session.request("image.markers", JSONObject("{op:detect,handle:x,dictionary:other}")) { _, _ -> fail() } }
        denied("IMAGE_STALE") { session.request("image.markers", JSONObject("{op:detect,handle:x,dictionary:DICT_4X4_50}")) { _, _ -> fail() } }
    }
    @Test fun onePendingPickerAndCancellationInvalidatesItsLateResult() {
        var result: ((Uri?) -> Unit)? = null
        val errors = mutableListOf<String?>()
        val session = ModuleImageSession(RuntimeEnvironment.getApplication(), "https://test.construct.invalid", {}, { result = it })
        session.request("image.read", JSONObject("{op:pick}")) { _, e -> errors.add(e?.code) }
        denied("IMAGE_BUSY") { session.request("image.read", JSONObject("{op:pick}")) { _, _ -> fail() } }
        session.cancel()
        result!!(Uri.parse("content://never-read/late"))
        assertEquals(listOf("IMAGE_CANCELLED"), errors)
        session.request("image.read", JSONObject("{op:pick}")) { _, e -> errors.add(e?.code) }
        result!!(null)
        assertEquals(listOf("IMAGE_CANCELLED", "IMAGE_CANCELLED"), errors)
    }
    @Test fun closedSessionCannotReturnLatePickerDataOrResource() {
        var result: ((Uri?) -> Unit)? = null
        var replies = 0
        val session = ModuleImageSession(RuntimeEnvironment.getApplication(), "https://test.construct.invalid", {}, { result = it })
        session.request("image.read", JSONObject("{op:pick}")) { _, _ -> replies++ }
        session.close(); result!!(Uri.parse("content://never-read/closed"))
        assertEquals(1, replies)
        denied("RUN_STALE") { session.resource("construct-images/fake.png") }
        denied("RUN_STALE") { session.request("image.read", JSONObject("{op:pick}")) { _, _ -> fail() } }
    }
    @Test fun markerComputationRequiresBothGrants() {
        val methods = mutableListOf<String>()
        val session = ModuleImageSession(RuntimeEnvironment.getApplication(), "https://test.construct.invalid", {
            methods.add(it); if (it == "image.markers") throw ConstructError("CAPABILITY_DENIED", "Denied")
        }, {})
        denied("CAPABILITY_DENIED") { session.request("image.markers", JSONObject("{op:detect,handle:x,dictionary:DICT_4X4_50}")) { _, _ -> fail() } }
        assertEquals(listOf("image.read", "image.markers"), methods)
    }
}
