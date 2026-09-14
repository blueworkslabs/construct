package dev.construct.runtime

import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class ModuleSessionViewTest {
    @Test fun nativeGateClosesBeforeNotificationAndViewPauseFollowsDelivery() {
        val events = mutableListOf<String>()
        var delivered: (() -> Unit)? = null
        val view = object : ModuleSessionView(RuntimeEnvironment.getApplication()) {
            override fun dispatchVisibility(visible: Boolean, complete: () -> Unit) {
                assertEquals(true, gate.paused.get())
                events.add("notify")
                delivered = complete
            }
            override fun onPause() { events.add("pause") }
        }
        view.stopEffects = { events.add("stop") }
        view.setMenuPaused(true)
        assertEquals(listOf("stop", "notify"), events)
        delivered!!()
        assertEquals(listOf("stop", "notify", "pause"), events)
        view.destroy()
    }

    @Test fun latePauseAcknowledgementCannotPauseAResumedOrClosedSession() {
        var delivered: (() -> Unit)? = null
        var pauses = 0
        val view = object : ModuleSessionView(RuntimeEnvironment.getApplication()) {
            override fun dispatchVisibility(visible: Boolean, complete: () -> Unit) {
                if (!visible) delivered = complete
            }
            override fun onPause() { pauses++ }
        }
        view.setMenuPaused(true)
        view.setMenuPaused(false)
        delivered!!()
        assertEquals(0, pauses)
        view.setMenuPaused(true)
        view.destroy()
        delivered!!()
        assertEquals(0, pauses)
    }
    @Test fun closeAndCompositionDisposalReleaseSessionOnlyOnce() {
        var releases = 0
        val view = object : ModuleSessionView(RuntimeEnvironment.getApplication()) {
            override fun releaseSession() { releases++ }
        }
        view.destroy()
        view.destroy()
        view.setMenuPaused(true)
        assertEquals(1, releases)
        assertEquals(false, view.gate.paused.get())
    }

    @Test fun closeReleasesAuthorityThenDetachesBeforeNativeDestruction() {
        var releases = 0
        var removals = 0
        val context = RuntimeEnvironment.getApplication()
        val view = object : ModuleSessionView(context) {
            override fun releaseSession() { releases++ }
        }
        val parent = object : android.widget.FrameLayout(context) {
            override fun onViewRemoved(child: android.view.View) {
                assertEquals(1, releases)
                assertEquals(false, org.robolectric.Shadows.shadowOf(view).wasDestroyCalled())
                removals++
                super.onViewRemoved(child)
            }
        }
        parent.addView(view)
        view.destroy()
        view.destroy()
        assertEquals(null, view.parent)
        assertEquals(1, removals)
        assertEquals(1, releases)
        assertEquals(true, org.robolectric.Shadows.shadowOf(view).wasDestroyCalled())
    }
}
