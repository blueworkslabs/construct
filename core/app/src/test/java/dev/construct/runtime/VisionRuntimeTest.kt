package dev.construct.runtime

import com.google.mediapipe.tasks.core.logging.TasksStatsDummyLogger
import com.google.mediapipe.tasks.core.logging.TasksStatsLoggerFactory
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class VisionRuntimeTest {
    @Test fun everyTaskUsesTheNoOpLoggerWithoutInitializingRemoteTransport() {
        val logger = TasksStatsLoggerFactory.create(RuntimeEnvironment.getApplication(), "FaceDetector", "IMAGE")
        assertTrue(logger is TasksStatsDummyLogger)
        logger.logSessionStart(); logger.recordCpuInputArrival(1); logger.recordInvocationEnd(1); logger.logSessionEnd()
    }
}
