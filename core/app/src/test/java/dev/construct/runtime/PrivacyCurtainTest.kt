package dev.construct.runtime

import org.junit.Assert.*
import org.junit.Test

/** Event-order regressions for live surfaces; these do not substitute for real Recents display tests. */
class PrivacyCurtainTest {
    @Test fun topResumedLossCoversLiveSurfaceEvenBeforeFocusOrPauseArrives() {
        val state = PrivacyCurtainState(true)
        assertTrue(state.covered(true))
        state.resume()
        assertTrue("resumed alone is not foreground on multi-resume Android", state.covered(true))
        state.topResumed(true)
        assertFalse(state.covered(true))
        state.topResumed(false)
        assertTrue("still focused and resumed during Recents transition", state.covered(true))
        state.focusGained()
        assertTrue("stale focus cannot override top-resumed loss", state.covered(true))
    }

    @Test fun leaveHintLatchesCoverageUntilAForegroundReturnSignal() {
        val state = PrivacyCurtainState(true)
        state.resume(); state.topResumed(true)
        state.userLeaving()
        assertTrue("focus can still be true when leave hint arrives", state.covered(true))
        assertTrue("drawing again does not clear leave hint", state.covered(true))
        state.pause(); state.focusGained()
        assertTrue(state.covered(true))
        state.resume()
        assertTrue("old top-resumed state was invalidated on pause", state.covered(true))
        state.topResumed(true)
        assertTrue("foreground lifecycle alone does not reveal an unfocused window", state.covered(false))
        state.focusGained()
        assertFalse(state.covered(true))
    }

    @Test fun dialogAndParentUseIndependentFocusAcrossARecentsRoundTrip() {
        val state = PrivacyCurtainState(true)
        state.resume(); state.topResumed(true)
        assertFalse("parent before opening dialog", state.covered(true))
        assertTrue("parent covered while dialog owns focus", state.covered(false))
        assertFalse("dialog remains visible with its own focus", state.covered(true))
        state.topResumed(false)
        assertTrue("parent remains covered", state.covered(false))
        assertTrue("dialog covered even if its focus loss has not arrived", state.covered(true))
        state.topResumed(true)
        assertFalse("same still-open dialog can resume", state.covered(true))
        assertTrue("parent stays covered until the dialog closes", state.covered(false))
    }

    @Test fun android28UsesResumeAndIndividualWindowFocusWithoutATopResumedCallback() {
        val state = PrivacyCurtainState(false)
        state.resume()
        assertFalse(state.covered(true))
        assertTrue(state.covered(false))
        state.userLeaving()
        assertTrue(state.covered(true))
        state.focusGained()
        assertFalse("cancelled departure can regain focus without another resume", state.covered(true))
        state.pause()
        assertTrue(state.covered(true))
        state.resume()
        assertFalse(state.covered(true))
    }
}
