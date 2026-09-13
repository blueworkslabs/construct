package dev.construct.runtime

import android.app.NotificationManager
import android.content.Context
import android.media.AudioManager
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28])
class TonePlayerTest {
    private fun rejected(code: String, action: () -> Unit) {
        try { action(); fail("Expected rejection") } catch (e: ConstructError) { assertEquals(code, e.code) }
    }
    @Test fun arbitraryAudioParametersAndClosedPlayersAreRejectedWithoutEvents() {
        val events = mutableListOf<String>()
        val player = TonePlayer(RuntimeEnvironment.getApplication()) { events.add(it) }
        rejected("INVALID_PARAMS") { player.play(JSONObject().put("pattern", "beep").put("volume", 100)) }
        rejected("INVALID_PARAMS") { player.play(JSONObject().put("pattern", "loop")) }
        player.close()
        rejected("RUN_STALE") { player.play(JSONObject().put("pattern", "beep")) }
        assertTrue(events.isEmpty())
    }
    @Test fun silentModeRejectsWithoutChangingSystemVolumeOrStartingTone() {
        val app = RuntimeEnvironment.getApplication()
        val audio = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        audio.ringerMode = AudioManager.RINGER_MODE_SILENT
        val volume = audio.getStreamVolume(AudioManager.STREAM_MUSIC)
        val events = mutableListOf<String>()
        val player = TonePlayer(app) { events.add(it) }
        rejected("AUDIO_MUTED") { player.play(JSONObject().put("pattern", "beep")) }
        assertEquals(volume, audio.getStreamVolume(AudioManager.STREAM_MUSIC))
        assertTrue(events.isEmpty())
        player.close()
    }
}
