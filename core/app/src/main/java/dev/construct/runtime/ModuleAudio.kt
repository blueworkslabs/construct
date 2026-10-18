package dev.construct.runtime

import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.webkit.WebView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject

/**
 * Web Audio under host policy (audio.play, API 0.15, docs/audio-brief.md). Every module page
 * starts with its WebView's audio muted natively. A module that declared audio.play, whose grant
 * holds, asks {op:"open"}: the host checks the media stream, ringer and interruption filter (the
 * tone player's rule) and requests audio focus. Output stays muted until a trusted gesture, a
 * native touch or key the host delivered to the page, during the open; a gesture that came just
 * before the open (the tap whose handler asked) counts. Focus loss, menu pause, background,
 * close, {op:"close"} or the phone going silent, vibrate, Do Not Disturb or media volume 0 while
 * open mute it again and tell the page; the next open re-checks every rule and waits for a new
 * gesture. Modules that did not declare audio.play also lose the AudioContext constructors
 * before their first script runs. Without native mute no module opens.
 */
internal class ModuleAudio(
    private val platform: AudioPlatform,
    private val declared: Boolean,
    private val authorize: () -> Unit,
    private val notify: (JSONObject) -> Unit,
    /** A diagnostics event: its code, and for AUDIO_SUSPENDED the reason, for AUDIO_REFUSED the refused open's code. */
    private val event: (String, String) -> Unit,
    private val clock: () -> Long = SystemClock::elapsedRealtime,
) {
    private var open = false
    private var audible = false
    private var closed = false
    /** Elapsed time of the last user input in the page since the session started or last suspended. */
    private var gesture: Long? = null

    /** Called before the page loads: muted, and constructors removed unless declared. Native
     * mute is the boundary: without it no module opens (fail closed), declared or not, since
     * removing the constructors alone does not silence every audio route. Without document-start
     * scripts an undeclared module keeps the constructors but stays muted for the whole session
     * (it can never open), recorded as AUDIO_LIMITED. */
    fun install() {
        checkRule(platform.canMute, "WEBVIEW_UNSUPPORTED", "Update Android System WebView or Chrome before opening modules")
        platform.setMuted(true)
        if (!declared && platform.canBlock) platform.blockConstructors()
        if (!platform.canBlock) event("AUDIO_LIMITED", "")
    }

    /** Native input reached the page (touch up, key up). Synthetic DOM events never get here. */
    fun userGesture() {
        if (closed) return
        gesture = clock()
        if (open && !audible) unmuteChecked()
    }

    /** A gesture can come long after the open: the grant and the mute rule are checked again at
     * the moment output would become audible. If they no longer hold, the open is suspended. */
    private fun unmuteChecked() {
        if (stillAllowed()) unmute() else suspend("policy")
    }

    private fun stillAllowed(): Boolean = try { authorize(); platform.soundAllowed() } catch (_: ConstructError) { false }

    /** The ringer, Do Not Disturb or the media stream changed while open (audible or waiting for
     * the tap): if sound is no longer allowed, suspend. Allowed again later is not a resume; the
     * page needs a new open and gesture. (Grant changes go through the menu, which suspends
     * first; this check stays off the grant store, since the watcher also polls.) */
    private fun policyChanged() {
        if (open && !platform.soundAllowed()) suspend("policy")
    }

    private fun unmute() {
        audible = true
        platform.setMuted(false)
        event("AUDIO_AUDIBLE", "")
    }

    fun request(params: JSONObject): Any {
        checkRule(!closed, "RUN_STALE", "Module is closed")
        checkRule(declared, "CAPABILITY_DENIED", "Declare audio.play before playing sound")
        val op = params.opt("op")
        checkRule(params.length() == 1 && op in setOf("open", "close", "state"), "INVALID_PARAMS", "Use op open, close or state")
        return when (op) {
            "open" -> openAudio()
            "close" -> { suspend("module"); JSONObject().put("open", false) }
            else -> state()
        }
    }

    private fun state() = JSONObject().put("open", open).put("waitingForGesture", open && !audible)

    /**
     * The bridge's whole audio.play path: [run] holds the session gate, the stored-grant check and
     * [request], in the bridge's order. A refused well-formed open is logged once, here, as
     * AUDIO_REFUSED with the code the page gets, whichever of those checks refused it.
     */
    fun dispatch(params: JSONObject, run: () -> Any): Any = try { run() } catch (refused: ConstructError) {
        if (params.length() == 1 && params.opt("op") == "open") event("AUDIO_REFUSED", refused.code)
        throw refused
    }

    private fun openAudio(): JSONObject {
        authorize()
        if (open) return state()
        checkRule(platform.canMute, "AUDIO_UNAVAILABLE", "This WebView cannot keep audio under host control")
        checkRule(platform.soundAllowed(), "AUDIO_MUTED", "Media volume is muted, the ringer is on silent or vibrate, or Do Not Disturb is on")
        checkRule(platform.requestFocus { suspend("focus") }, "AUDIO_UNAVAILABLE", "Audio focus is unavailable")
        open = true
        platform.watchPolicy { policyChanged() }
        event("AUDIO_OPENED", "")
        val at = gesture
        if (at != null && clock() - at <= GESTURE_WINDOW_MS) unmute()
        return state()
    }

    /** Mute, give focus back and tell the page; a suspended page needs a new gesture and open. */
    fun suspend(reason: String) {
        gesture = null
        if (!open) return
        open = false
        audible = false
        platform.setMuted(true)
        platform.abandonFocus()
        platform.unwatchPolicy()
        event("AUDIO_SUSPENDED", reason)
        if (!closed) notify(JSONObject().put("state", "suspended").put("reason", reason))
    }

    /** The session ends: muted and focus returned; the page is going away, so no event. */
    fun close() {
        if (closed) return
        closed = true
        suspend("closed")
        platform.setMuted(true)
    }

    companion object {
        /** A gesture this recent before an open counts for it, as for a click handler's request. */
        const val GESTURE_WINDOW_MS = 5000L

        /**
         * Replaces the constructors with ones that throw NotAllowedError, before module scripts
         * run, for undeclared modules. Non-configurable, so module code cannot restore them.
         */
        val BLOCK_CONSTRUCTORS = """
            (() => {
              const deny = function () { throw new DOMException('Declare audio.play to use Web Audio', 'NotAllowedError'); };
              for (const name of ['AudioContext', 'webkitAudioContext', 'OfflineAudioContext']) {
                Object.defineProperty(window, name, { value: deny, writable: false, configurable: false, enumerable: false });
              }
            })();
        """.trimIndent()
    }
}

/** The platform side of [ModuleAudio], replaced by a fake in JVM tests. */
internal interface AudioPlatform {
    /** Native mute: required, [ModuleAudio.install] refuses to open any module without it. */
    val canMute: Boolean
    /** Document-start scripts: undeclared modules lose the constructors; without them they stay
     * muted all session (AUDIO_LIMITED). */
    val canBlock: Boolean
    fun setMuted(muted: Boolean)
    fun blockConstructors()
    fun soundAllowed(): Boolean
    fun requestFocus(onLoss: () -> Unit): Boolean
    fun abandonFocus()
    /** Calls [onChange] (on the main thread) whenever the ringer mode, interruption filter or the
     * media stream's volume or mute may have changed, until [unwatchPolicy]. */
    fun watchPolicy(onChange: () -> Unit)
    fun unwatchPolicy()
}

internal class WebViewAudioPlatform(private val context: Context, private val view: WebView, private val origin: String) : AudioPlatform {
    private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val notifications = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    private val handler = Handler(Looper.getMainLooper())
    private var focus: AudioFocusRequest? = null
    override val canMute = WebViewFeature.isFeatureSupported(WebViewFeature.MUTE_AUDIO)
    override val canBlock = WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)

    override fun setMuted(muted: Boolean) {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.MUTE_AUDIO)) WebViewCompat.setAudioMuted(view, muted)
    }
    override fun blockConstructors() {
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT))
            WebViewCompat.addDocumentStartJavaScript(view, ModuleAudio.BLOCK_CONSTRUCTORS, setOf(origin))
    }
    override fun soundAllowed(): Boolean = audio.ringerMode == AudioManager.RINGER_MODE_NORMAL &&
        !audio.isStreamMute(AudioManager.STREAM_MUSIC) && audio.getStreamVolume(AudioManager.STREAM_MUSIC) > 0 &&
        notifications.currentInterruptionFilter == NotificationManager.INTERRUPTION_FILTER_ALL
    override fun requestFocus(onLoss: () -> Unit): Boolean {
        abandonFocus()
        val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            .setOnAudioFocusChangeListener({ change -> if (change < 0) onLoss() }, handler)
            .build()
        if (audio.requestAudioFocus(request) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) return false
        focus = request
        return true
    }
    override fun abandonFocus() {
        focus?.let { audio.abandonAudioFocusRequest(it) }
        focus = null
    }

    private var receiver: BroadcastReceiver? = null
    private var poll: Runnable? = null

    /** The system broadcasts for the ringer, Do Not Disturb and stream volume/mute, and a check
     * every [POLICY_POLL_MS] while open in case a change arrives without one. */
    override fun watchPolicy(onChange: () -> Unit) {
        unwatchPolicy()
        val r = object : BroadcastReceiver() { override fun onReceive(c: Context, i: Intent) = onChange() }
        val filter = IntentFilter().apply {
            addAction(AudioManager.RINGER_MODE_CHANGED_ACTION)
            addAction(NotificationManager.ACTION_INTERRUPTION_FILTER_CHANGED)
            addAction(VOLUME_CHANGED_ACTION)
            addAction(STREAM_MUTE_CHANGED_ACTION)
        }
        if (Build.VERSION.SDK_INT >= 33) context.registerReceiver(r, filter, null, handler, Context.RECEIVER_NOT_EXPORTED)
        else context.registerReceiver(r, filter, null, handler)
        receiver = r
        val p = object : Runnable { override fun run() { onChange(); if (poll === this) handler.postDelayed(this, POLICY_POLL_MS) } }
        poll = p
        handler.postDelayed(p, POLICY_POLL_MS)
    }

    override fun unwatchPolicy() {
        receiver?.let { runCatching { context.unregisterReceiver(it) } }
        receiver = null
        poll?.let { handler.removeCallbacks(it) }
        poll = null
    }

    private companion object {
        const val POLICY_POLL_MS = 500L
        // Sent by the system on every stream volume or mute change; not in the public SDK.
        const val VOLUME_CHANGED_ACTION = "android.media.VOLUME_CHANGED_ACTION"
        const val STREAM_MUTE_CHANGED_ACTION = "android.media.STREAM_MUTE_CHANGED_ACTION"
    }
}
