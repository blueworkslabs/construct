package dev.construct.runtime

import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import org.json.JSONObject

/** Fixed patterns only. The host never changes system volume or starts background audio. */
internal class TonePlayer(context: Context, private val event: (String) -> Unit) {
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val notifications = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    private val handler = Handler(Looper.getMainLooper())
    private var generator: ToneGenerator? = null
    private var focus: AudioFocusRequest? = null
    private var lastStart = -2000L
    private var closed = false
    private val stop = Runnable { stopPlayback() }

    fun play(params: JSONObject): Any {
        checkRule(!closed, "RUN_STALE", "Module is closed")
        val pattern = params.opt("pattern")
        checkRule(params.length() == 1 && pattern in setOf("beep", "double"), "INVALID_PARAMS", "Choose beep or double; no other parameters are supported")
        val now = SystemClock.elapsedRealtime()
        checkRule(now - lastStart >= 2000, "RATE_LIMIT", "Wait two seconds between tones")
        checkRule(audio.ringerMode == AudioManager.RINGER_MODE_NORMAL &&
            !audio.isStreamMute(AudioManager.STREAM_MUSIC) && audio.getStreamVolume(AudioManager.STREAM_MUSIC) > 0 &&
            notifications.currentInterruptionFilter == NotificationManager.INTERRUPTION_FILTER_ALL,
            "AUDIO_MUTED", "Media volume is muted, the ringer is on silent or vibrate, or Do Not Disturb is on")
        stopPlayback()
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            .setOnAudioFocusChangeListener({ change -> if (change < 0) stopPlayback() }, handler)
            .build()
        checkRule(audio.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED,
            "AUDIO_UNAVAILABLE", "Audio focus is unavailable")
        focus = request
        try {
            val duration = if (pattern == "beep") 180 else 400
            val tone = ToneGenerator(AudioManager.STREAM_MUSIC, 15)
            generator = tone
            checkRule(tone.startTone(if (pattern == "beep") ToneGenerator.TONE_PROP_BEEP else ToneGenerator.TONE_PROP_BEEP2, duration),
                "AUDIO_UNAVAILABLE", "Tone could not start")
            lastStart = now
            event("TONE_STARTED")
            handler.postDelayed(stop, duration.toLong())
            return JSONObject().put("accepted", true).put("pattern", pattern)
        } catch (error: Exception) {
            stopPlayback()
            throw if (error is ConstructError) error else ConstructError("AUDIO_UNAVAILABLE", "Tone could not start")
        }
    }

    private fun stopPlayback() {
        handler.removeCallbacks(stop)
        val old = generator
        generator = null
        old?.let { runCatching { it.stopTone() }; runCatching { it.release() }; event("TONE_STOPPED") }
        focus?.let { audio.abandonAudioFocusRequest(it) }
        focus = null
    }

    fun pause() { stopPlayback() }

    fun close() { closed = true; stopPlayback() }
}
