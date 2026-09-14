package dev.construct.nanolab;
import org.junit.Test;
import static org.junit.Assert.*;
public class LabSessionTest {
    @Test public void rejectsBeforeForeground() {
        LabSession s = new LabSession();
        assertThrows(IllegalStateException.class, s::begin);
    }
    @Test public void onlyOneOperationMayRun() {
        LabSession s = new LabSession(); s.start(); long token=s.begin();
        assertThrows(IllegalStateException.class, s::begin);
        assertTrue(s.finish(token)); assertFalse(s.finish(token));
    }
    @Test public void cancelledResultsCannotFinishReplacement() {
        LabSession s = new LabSession(); s.start(); long old=s.begin(); s.cancel(); long next=s.begin();
        assertFalse(s.accepts(old)); assertFalse(s.finish(old)); assertTrue(s.isBusy()); assertTrue(s.finish(next));
    }
    @Test public void backgroundInvalidatesCallbacksEvenAfterReturn() {
        LabSession s = new LabSession(); s.start(); long old=s.begin(); s.stop(); s.start(); long next=s.begin();
        assertFalse(s.accepts(old)); assertTrue(s.accepts(next));
    }
    @Test public void completedOperationCannotStreamLateText() {
        LabSession s = new LabSession(); s.start(); long token=s.begin(); s.finish(token);
        assertFalse(s.accepts(token));
    }
}
