// Construct replacement for the logger factory in the pinned MediaPipe AAR.
// Original AAR is Apache-2.0; this small replacement is part of Construct (MIT).
// It selects MediaPipe's provided no-op implementation. No remote logger is retained.
package com.google.mediapipe.tasks.core.logging;

import android.content.Context;

public final class TasksStatsLoggerFactory {
    public static TasksStatsLogger create(Context context, String name, String mode) {
        return TasksStatsDummyLogger.create(context, name, mode);
    }
}
