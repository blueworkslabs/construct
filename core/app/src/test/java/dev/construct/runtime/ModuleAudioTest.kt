package dev.construct.runtime

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** API 0.15 audio.play: native mute until a permitted, focused open and a trusted gesture; suspension; gating. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class ModuleAudioTest {
    private class FakePlatform(override val canMute: Boolean = true, override val canBlock: Boolean = true) : AudioPlatform {
        var muted: Boolean? = null
        var blocked = 0
        var allowed = true
        var focusGranted = true
        var focusHeld = false
        var onLoss: (() -> Unit)? = null
        override fun setMuted(muted: Boolean) { this.muted = muted }
        override fun blockConstructors() { blocked++ }
        override fun soundAllowed() = allowed
        override fun requestFocus(onLoss: () -> Unit): Boolean {
            if (!focusGranted) return false
            focusHeld = true; this.onLoss = onLoss; return true
        }
        override fun abandonFocus() { focusHeld = false }
        var onPolicy: (() -> Unit)? = null
        override fun watchPolicy(onChange: () -> Unit) { onPolicy = onChange }
        override fun unwatchPolicy() { onPolicy = null }
        /** The ringer, DND or media volume changed: the system's broadcast (or the poll). */
        fun policyChange(allowedNow: Boolean) { allowed = allowedNow; onPolicy?.invoke() }
    }

    private var now = 10_000L
    private var authorized = true
    private val pushed = mutableListOf<String>()
    private val events = mutableListOf<String>()
    private fun audio(platform: FakePlatform, declared: Boolean = true) = ModuleAudio(platform, declared,
        { checkRule(authorized, "CAPABILITY_DENIED", "Not granted") }, { pushed += it.toString() }, { events += it }, { now })
        .also { it.install() }
    private fun op(name: String) = JSONObject().put("op", name)
    private fun denied(code: String, action: () -> Unit) {
        try { action(); fail("Expected $code") } catch (e: ConstructError) { assertEquals(code, e.code) }
    }

    @Test fun startsMutedAndOnlyUndeclaredModulesLoseTheConstructors() {
        val declared = FakePlatform(); audio(declared)
        assertEquals(true, declared.muted); assertEquals(0, declared.blocked)
        val undeclared = FakePlatform(); val a = audio(undeclared, declared = false)
        assertEquals(true, undeclared.muted); assertEquals(1, undeclared.blocked)
        denied("CAPABILITY_DENIED") { a.request(op("open")) }
        assertEquals(true, undeclared.muted)
    }

    private fun opened(audible: Boolean) = JSONObject().put("open", true).put("waitingForGesture", !audible).toString()

    @Test fun openChecksThePolicyAndFocusAndStaysSilentUntilATrustedGesture() {
        val p = FakePlatform(); val a = audio(p)
        p.allowed = false
        denied("AUDIO_MUTED") { a.request(op("open")) }
        p.allowed = true; p.focusGranted = false
        denied("AUDIO_UNAVAILABLE") { a.request(op("open")) }
        p.focusGranted = true; authorized = false
        denied("CAPABILITY_DENIED") { a.request(op("open")) }
        authorized = true
        // Opened at load: focus held, still muted until the person touches the page.
        assertEquals(opened(false), a.request(op("open")).toString())
        assertEquals(true, p.muted); assertTrue(p.focusHeld)
        now += 60_000
        a.userGesture()
        assertEquals(false, p.muted)
        assertEquals(opened(true), a.request(op("state")).toString())
        assertEquals(listOf("AUDIO_OPENED", "AUDIO_AUDIBLE"), events)
    }

    @Test fun theTapWhoseHandlerOpensCountsButAStaleOneDoesNot() {
        val p = FakePlatform(); val a = audio(p)
        a.userGesture(); now += 200
        assertEquals(opened(true), a.request(op("open")).toString())
        assertEquals(false, p.muted)
        val q = FakePlatform(); val b = audio(q)
        b.userGesture(); now += ModuleAudio.GESTURE_WINDOW_MS + 1
        assertEquals(opened(false), b.request(op("open")).toString())
        assertEquals(true, q.muted)
    }

    @Test fun focusLossPauseAndCloseMuteNotifyAndNeedANewOpenAndGesture() {
        for (reason in listOf("focus", "pause", "background", "module")) {
            val p = FakePlatform(); val a = audio(p); pushed.clear()
            a.userGesture(); a.request(op("open"))
            assertEquals(reason, false, p.muted)
            when (reason) {
                "focus" -> p.onLoss!!()
                "module" -> a.request(op("close"))
                else -> a.suspend(reason)
            }
            assertEquals(reason, true, p.muted); assertFalse(reason, p.focusHeld)
            assertEquals(reason, listOf(JSONObject().put("state", "suspended").put("reason", reason).toString()), pushed)
            assertEquals(JSONObject().put("open", false).put("waitingForGesture", false).toString(), a.request(op("state")).toString())
            a.userGesture()
            assertEquals(reason, true, p.muted) // a gesture alone does not reopen
            now += ModuleAudio.GESTURE_WINDOW_MS + 1
            assertEquals(opened(false), a.request(op("open")).toString())
            assertEquals(reason, true, p.muted)
            a.userGesture()
            assertEquals(reason, false, p.muted)
        }
    }

    @Test fun closingTheSessionMutesForGoodWithoutTellingThePage() {
        val p = FakePlatform(); val a = audio(p)
        a.userGesture(); a.request(op("open")); pushed.clear()
        a.close()
        assertEquals(true, p.muted); assertFalse(p.focusHeld); assertTrue(pushed.isEmpty())
        a.userGesture()
        denied("RUN_STALE") { a.request(op("open")) }
    }

    @Test fun withoutNativeMuteNoModuleOpensEvenWithTheConstructorBlock() {
        // Removing the constructors alone is not proof that every audio route is silent.
        for (canBlock in listOf(true, false)) for (declared in listOf(true, false)) {
            val p = FakePlatform(canMute = false, canBlock = canBlock)
            denied("WEBVIEW_UNSUPPORTED") { ModuleAudio(p, declared, {}, {}, {}, { now }).install() }
            assertEquals(0, p.blocked)
        }
    }

    @Test fun withoutDocumentStartScriptsUndeclaredModulesStayMutedAndDeclaredOnesStillWork() {
        val p = FakePlatform(canBlock = false); val a = audio(p, declared = false)
        assertEquals(true, p.muted); assertEquals(0, p.blocked)
        assertEquals(listOf("AUDIO_LIMITED"), events)
        a.userGesture()
        denied("CAPABILITY_DENIED") { a.request(op("open")) }
        assertEquals(true, p.muted)
        // Native mute is the gate, so a declared module opens under the usual rules.
        val q = FakePlatform(canBlock = false); val b = audio(q)
        b.userGesture()
        assertEquals(opened(true), b.request(op("open")).toString())
        assertEquals(false, q.muted)
    }

    @Test fun thePhoneGoingSilentWhilePlayingSuspendsAndComingBackDoesNotResume() {
        for (audibleFirst in listOf(true, false)) {
            val p = FakePlatform(); val a = audio(p); pushed.clear()
            if (audibleFirst) a.userGesture()
            assertEquals(opened(audibleFirst), a.request(op("open")).toString())
            assertNotNull(p.onPolicy)
            // A change that still allows sound (volume moved, not to 0) changes nothing.
            p.policyChange(true)
            assertEquals(!audibleFirst, p.muted); assertTrue(p.focusHeld); assertTrue(pushed.isEmpty())
            // Silent, vibrate, DND or media volume 0: muted, focus returned, the page told.
            p.policyChange(false)
            assertEquals(true, p.muted); assertFalse(p.focusHeld); assertNull(p.onPolicy)
            assertEquals(listOf(JSONObject().put("state", "suspended").put("reason", "policy").toString()), pushed)
            assertEquals(JSONObject().put("open", false).put("waitingForGesture", false).toString(), a.request(op("state")).toString())
            // Back to normal: still muted, no event; a gesture alone does not reopen.
            p.allowed = true
            a.userGesture()
            assertEquals(true, p.muted); assertEquals(1, pushed.size)
            // A fresh open after a fresh tap plays again, and watches again.
            assertEquals(opened(true), a.request(op("open")).toString())
            assertEquals(false, p.muted); assertNotNull(p.onPolicy)
        }
    }

    @Test fun theWatchEndsWithEverySuspensionAndTheSession() {
        for (end in listOf("focus", "pause", "module", "closed")) {
            val p = FakePlatform(); val a = audio(p)
            a.userGesture(); a.request(op("open"))
            assertNotNull(end, p.onPolicy)
            val watcher = p.onPolicy!!
            when (end) { "focus" -> p.onLoss!!(); "module" -> a.request(op("close")); "closed" -> a.close(); else -> a.suspend(end) }
            assertNull(end, p.onPolicy)
            // A late broadcast already queued for the old watch does nothing.
            pushed.clear(); p.allowed = false; watcher()
            assertTrue(end, pushed.isEmpty()); assertEquals(end, true, p.muted)
        }
    }

    @Test fun aLateGestureRechecksTheRulesBeforeUnmuting() {
        // Opened at load, then the phone goes silent (or the grant is revoked) before the tap.
        for (change in listOf("muted", "revoked")) {
            val p = FakePlatform(); val a = audio(p); pushed.clear(); authorized = true
            assertEquals(opened(false), a.request(op("open")).toString())
            if (change == "muted") p.allowed = false else authorized = false
            now += 60_000
            a.userGesture()
            assertEquals(change, true, p.muted); assertFalse(change, p.focusHeld)
            assertEquals(change, listOf(JSONObject().put("state", "suspended").put("reason", "policy").toString()), pushed)
            assertEquals(JSONObject().put("open", false).put("waitingForGesture", false).toString(), a.request(op("state")).toString())
        }
        authorized = true
    }

    @Test fun onlyKnownOperations() {
        val a = audio(FakePlatform())
        denied("INVALID_PARAMS") { a.request(JSONObject().put("op", "play")) }
        denied("INVALID_PARAMS") { a.request(op("open").put("volume", 1)) }
    }

    @Test fun constructorBlockIsNonConfigurableAndCoversEveryConstructor() {
        val script = ModuleAudio.BLOCK_CONSTRUCTORS
        for (name in listOf("'AudioContext'", "'webkitAudioContext'", "'OfflineAudioContext'")) assertTrue(name, name in script)
        assertTrue("configurable: false" in script); assertTrue("writable: false" in script)
        assertTrue("NotAllowedError" in script)
    }

    @Test fun manifestGatingAndConsent() {
        fun manifest(api: String) = JSONObject().put("schemaVersion", 1).put("id", "dev.test.sound").put("name", "Sound")
            .put("version", "1.0.0").put("constructApi", JSONObject().put("min", api).put("target", api))
            .put("runtime", JSONObject().put("kind", "webview-js")).put("entry", "index.html")
            .put("capabilities", org.json.JSONArray().put(JSONObject().put("id", "audio.play").put("reason", "Game sounds")))
            .toString().toByteArray()
        val m = Packages.manifest(manifest("0.15.0"))
        val cap = m.capabilities.single()
        assertTrue(cap.explicitOptIn)
        assertEquals("Play sounds while this module is open", cap.label)
        denied("API_INCOMPATIBLE") { Packages.manifest(manifest("0.14.0")) }
    }
}
