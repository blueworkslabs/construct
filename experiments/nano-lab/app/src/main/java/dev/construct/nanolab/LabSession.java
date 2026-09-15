package dev.construct.nanolab;

/** Per-foreground-session ownership of asynchronous results. No prompt or response storage. */
final class LabSession {
    private long revision;
    private boolean active;
    private boolean busy;
    void start() { active = true; }
    long begin() {
        if (!active || busy) throw new IllegalStateException("Operation unavailable");
        busy = true;
        return ++revision;
    }
    boolean accepts(long token) { return active && busy && token == revision; }
    boolean finish(long token) { if (!accepts(token)) return false; busy = false; return true; }
    void cancel() { revision++; busy = false; }
    void stop() { cancel(); active = false; }
    boolean isBusy() { return busy; }
    boolean isActive() { return active; }
}
