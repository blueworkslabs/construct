package dev.construct.runtime

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** The lifecycle control for a delayed unlock: backgrounding before it finishes discards it. */
class ForegroundGenerationTest {
    @Test fun anUnlockFinishingAfterBackgroundingIsDiscarded() {
        val foreground = ForegroundGeneration()
        val delayed = foreground.token()
        foreground.invalidate()            // ON_STOP while the unlock runs
        assertFalse(foreground.current(delayed))
        val fresh = foreground.token()     // unlocked again after coming back
        assertTrue(foreground.current(fresh))
    }

    @Test fun anUnlockFinishingInTheForegroundIsShown() {
        val foreground = ForegroundGeneration()
        assertTrue(foreground.current(foreground.token()))
    }
}
