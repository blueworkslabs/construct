package dev.construct.runtime

import org.junit.Assert.*
import org.junit.Test

class ModuleSessionGateTest {
    private fun denied(action: () -> Unit) {
        try { action(); fail("Expected native pause denial") }
        catch (e: ConstructError) { assertEquals("RUN_PAUSED", e.code) }
    }
    @Test fun menuBlocksDeviceEffectsButAllowsOutstandingSave() {
        val gate = ModuleSessionGate()
        gate.authorize("camera.capture")
        gate.setPaused(true)
        for (method in listOf("camera.capture", "contacts.read", "device.tone", "device.toast", "log.write")) denied { gate.authorize(method) }
        gate.authorize("storage.kv")
        gate.setPaused(false)
        gate.authorize("camera.capture")
    }
    @Test fun inFlightContactReplyCannotCrossMenuEvenAfterReturn() {
        val gate = ModuleSessionGate(); val before = gate.generation.get()
        gate.authorizeReply(before)
        gate.setPaused(true); denied { gate.authorizeReply(before) }
        gate.setPaused(false); denied { gate.authorizeReply(before) }
        gate.authorizeReply(gate.generation.get())
    }
    @Test fun repeatedStateDoesNotInvalidateFreshRequests() {
        val gate = ModuleSessionGate()
        assertFalse(gate.setPaused(false)); assertEquals(0L, gate.generation.get())
        assertTrue(gate.setPaused(true)); assertFalse(gate.setPaused(true))
        assertEquals(1L, gate.generation.get())
    }
}
