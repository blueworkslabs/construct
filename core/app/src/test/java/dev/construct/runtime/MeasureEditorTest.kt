package dev.construct.runtime

import org.junit.Assert.*
import org.junit.Test

class MeasureEditorTest {
    private val corners = listOf(MeasurePoint(.1,.1),MeasurePoint(.3,.1),MeasurePoint(.3,.3),MeasurePoint(.1,.3))
    private val a = MeasurePoint(.4,.5)
    private val b = MeasurePoint(.8,.5)
    private fun editor() = MeasureEditor().apply { calibrate(corners,100.0) }
    private fun MeasureEditor.pair() { assertEquals(EditResult.Accepted,place(revision,a)); assertEquals(EditResult.Accepted,place(revision,b)) }
    private fun MeasureEditor.move(phase: DragPhase, point: MeasurePoint? = null, endpoint: MeasureEndpoint = MeasureEndpoint.B): EditResult =
        move(MoveRequest(revision,1,endpoint,phase,point))
    @Test fun manyPreviewsCommitAsOneUndoEntry() {
        val e=editor(); e.pair(); val before=e.measurement
        e.move(DragPhase.BEGIN)
        repeat(30) { assertEquals(EditResult.Accepted,e.move(DragPhase.PREVIEW,MeasurePoint(.7+it/1000.0,.5))) }
        assertEquals(EditResult.Accepted,e.move(DragPhase.COMMIT,MeasurePoint(.72,.5)))
        assertNotEquals(before,e.measurement)
        e.undo(); assertEquals(before,e.measurement)
        e.undo(); assertNull(e.measurement!!.b)
        e.undo(); assertNull(e.measurement); assertFalse(e.canUndo)
    }
    @Test fun cancelRestoresBeforeDragAndCreatesNoHistory() {
        val e=editor();e.pair();val before=e.measurement
        e.move(DragPhase.BEGIN);e.move(DragPhase.PREVIEW,MeasurePoint(.7,.5));e.move(DragPhase.CANCEL)
        assertEquals(before,e.measurement);assertFalse(e.isDragging)
        e.undo();assertNull(e.measurement!!.b)
    }
    @Test fun rejectedPreviewLeavesLastAcceptedValueAndRejectsInvalidCommit() {
        val e=editor();e.pair();e.move(DragPhase.BEGIN)
        e.move(DragPhase.PREVIEW,MeasurePoint(.7,.5));val accepted=e.measurement
        assertTrue(e.move(DragPhase.PREVIEW,a) is EditResult.Rejected)
        assertEquals(accepted,e.measurement)
        assertTrue(e.move(DragPhase.COMMIT,MeasurePoint(Double.NaN,.5)) is EditResult.Rejected)
        assertEquals(accepted,e.measurement)
        e.move(DragPhase.COMMIT,accepted!!.b);e.undo();assertEquals(b,e.measurement!!.b)
    }
    @Test fun replacementAndCalibrationRejectStaleEvents() {
        val e=editor();e.pair();val old=e.revision;e.move(DragPhase.BEGIN)
        e.calibrate(corners,95.5)
        assertTrue(e.place(old,a) is EditResult.Rejected)
        assertTrue(e.move(MoveRequest(old,1,MeasureEndpoint.B,DragPhase.COMMIT,b)) is EditResult.Rejected)
        assertNull(e.measurement);assertFalse(e.canUndo);assertFalse(e.isDragging)
        e.pair();assertEquals("Length: 19.1 cm",e.measurement!!.label)
        e.reset();assertTrue(e.place(e.revision,a) is EditResult.Rejected)
    }
    @Test fun noOpDragDoesNotConsumeUndoAndClearIsUndoable() {
        val e=editor();e.pair();val pair=e.measurement
        e.move(DragPhase.BEGIN);e.move(DragPhase.COMMIT,b)
        e.clear();assertNull(e.measurement);e.undo();assertEquals(pair,e.measurement)
        e.undo();assertNull(e.measurement!!.b)
    }
    @Test fun historyIsBoundedAndThirdPlacementDoesNotReplacePair() {
        val e=editor();e.pair();val pair=e.measurement
        assertTrue(e.place(e.revision,MeasurePoint(.9,.5)) is EditResult.Rejected);assertEquals(pair,e.measurement)
        repeat(12) { e.move(DragPhase.BEGIN);e.move(DragPhase.COMMIT,MeasurePoint(.7+it/1000.0,.5)) }
        repeat(10) { assertTrue(e.canUndo);e.undo() };assertFalse(e.canUndo)
        assertNotNull(e.measurement!!.b)
    }
    @Test fun wrongHandleAndUnbegunMoveCannotMutateState() {
        val e=editor();e.pair();val pair=e.measurement
        assertTrue(e.move(DragPhase.COMMIT,a) is EditResult.Rejected)
        e.move(DragPhase.BEGIN)
        assertTrue(e.move(DragPhase.PREVIEW,MeasurePoint(.6,.5),MeasureEndpoint.A) is EditResult.Rejected)
        assertEquals(pair,e.measurement);e.cancelDrag();assertFalse(e.isDragging)
    }
}
