package dev.construct.runtime

import android.content.Context
import android.view.accessibility.AccessibilityEvent
import android.webkit.WebView
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/** Native effect gate. A menu transition invalidates in-flight personal-data replies. */
internal class ModuleSessionGate {
    val paused = AtomicBoolean(false)
    val generation = AtomicLong(0)
    fun setPaused(value: Boolean): Boolean {
        if (paused.getAndSet(value) == value) return false
        generation.incrementAndGet()
        return true
    }
    fun authorize(method: String) {
        // Finish already-submitted game saves; no device/data reads while obscured.
        checkRule(!paused.get() || method == "storage.kv", "RUN_PAUSED", "Return to the module before using this capability")
    }
    fun authorizeReply(start: Long) {
        checkRule(!paused.get() && generation.get() == start, "RUN_PAUSED", "Menu interrupted this request; try again")
    }
}

internal open class ModuleSessionView(context: Context) : WebView(context) {
    init {
        // WRAP_CONTENT makes Android WebView treat CSS viewport-height units as zero,
        // even when Compose subsequently measures it to fill the available space.
        layoutParams = android.view.ViewGroup.LayoutParams(
            android.view.ViewGroup.LayoutParams.MATCH_PARENT,
            android.view.ViewGroup.LayoutParams.MATCH_PARENT)
    }
    private var released = false
    protected open fun releaseSession() {}
    final override fun destroy() {
        if (released) return
        released = true
        releaseSession()
        // WebView requires removal from the view system before destroy(). In
        // particular, let its accessibility provider detach while still alive.
        (parent as? android.view.ViewGroup)?.removeView(this)
        super.destroy()
    }
    val gate = ModuleSessionGate()
    var stopEffects: () -> Unit = {}
    var stopImageEffects: () -> Unit = {}
    fun pauseForPicker() {
        if (released) return
        gate.setPaused(true); stopEffects(); onPause()
    }
    protected open fun dispatchVisibility(visible: Boolean, delivered: () -> Unit) {
        evaluateJavascript("window.dispatchEvent(new CustomEvent('constructvisibilitychange',{detail:{visible:$visible,reason:'menu'}}));") { delivered() }
    }
    fun setMenuPaused(paused: Boolean) {
        if (released || !gate.setPaused(paused)) return
        if (paused) {
            stopImageEffects()
            stopEffects() // Native authority is already denied; no JS acknowledgement needed.
            val generation = gate.generation.get()
            var applied = false
            val pauseView = {
                if (!released && !applied && gate.paused.get() && gate.generation.get() == generation) {
                    applied = true
                    onPause()
                }
            }
            dispatchVisibility(false, pauseView)
            // Unresponsive module code cannot indefinitely defer native WebView pausing.
            postDelayed({ pauseView() }, 100)
        } else {
            onResume()
            dispatchVisibility(true) { }
        }
        if (!paused) post {
            if (released) return@post
            requestFocus()
            sendAccessibilityEvent(AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED)
        }
    }
}
