package dev.construct.runtime

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Delayed-unlock controls: the result of an unlock still running when the person leaves is dropped. */
class PreparationGateTest {
    @Test fun anUnlockFinishingAfterBackgroundingIsDiscarded() {
        val gate = PreparationGate()
        val delayed = gate.begin()
        gate.leave()                                   // ON_STOP while the unlock runs
        assertFalse(gate.deliverable(delayed, onPreparationScreen = true))
        assertTrue(gate.deliverable(gate.begin(), onPreparationScreen = true))
    }

    @Test fun leavingBrowseAndComingBackStillDropsTheOldUnlock() {
        val gate = PreparationGate()
        val delayed = gate.begin()
        gate.leave()                                   // Back, Settings or About while busy
        // Back on Browse when the result arrives: still the old preparation, so dropped.
        assertFalse(gate.deliverable(delayed, onPreparationScreen = true))
    }

    @Test fun aResultArrivingOffTheBrowseScreenIsDropped() {
        val gate = PreparationGate()
        val token = gate.begin()
        assertFalse(gate.deliverable(token, onPreparationScreen = false))
        assertTrue(gate.deliverable(token, onPreparationScreen = true))
    }
}
