package dev.construct.runtime

import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.view.View
import android.view.ViewTreeObserver
import android.view.Window
import java.io.Closeable

/** Foreground eligibility, independent of screenshot permission and of any one window's focus. */
internal class PrivacyCurtainState(private val needsTopResumed: Boolean) {
    private var resumed = false
    private var topResumed = !needsTopResumed
    private var leaving = false

    fun resume() { resumed = true; leaving = false }
    fun pause() { resumed = false; if (needsTopResumed) topResumed = false }
    fun userLeaving() { leaving = true }
    fun topResumed(value: Boolean) {
        topResumed = value
        if (value && resumed) leaving = false
    }
    fun focusGained() { if (resumed && topResumed) leaving = false }
    fun covered(focused: Boolean) = !resumed || !topResumed || leaving || !focused
}

/**
 * Covers the actual pixels of live Recents surfaces, not just their screenshots. All calls and
 * listeners run on the UI thread. An overlay Drawable owns neither input nor window focus, so
 * covering a dialog cannot dismiss it, resolve its pending operation, or cause focus oscillation.
 * Each dialog uses its OWN focus: opening one covers the parent without hiding the focused dialog.
 *
 * Lifecycle callbacks do not guarantee delivery before every gesture-animation frame; exact-device
 * display acceptance is still required. FLAG_SECURE and Recents snapshot suppression remain separate.
 */
internal class PrivacyCurtains(needsTopResumed: Boolean) : Closeable {
    private val state = PrivacyCurtainState(needsTopResumed)
    private val windows = linkedMapOf<Window, Curtain>()

    fun register(window: Window, sensitive: Boolean = true): Closeable {
        check(window !in windows)
        val curtain = Curtain(window.decorView, sensitive)
        windows[window] = curtain
        curtain.install()
        return Closeable { if (windows.remove(window) === curtain) curtain.close() }
    }

    fun protect(window: Window, sensitive: Boolean) { windows[window]?.let { it.sensitive = sensitive; it.update() } }
    fun resume() { state.resume(); update() }
    fun pause() { state.pause(); update() }
    fun userLeaving() { state.userLeaving(); update() }
    fun topResumed(value: Boolean) { state.topResumed(value); update() }
    private fun update() { windows.values.forEach { it.update() } }
    override fun close() { windows.values.forEach { it.close() }; windows.clear() }

    private inner class Curtain(private val decor: View, var sensitive: Boolean) : Closeable {
        private val drawable = ColorDrawable(Color.BLACK)
        private var shown = false
        private var focused = decor.hasWindowFocus()
        private var observer: ViewTreeObserver? = null
        private val focusListener = ViewTreeObserver.OnWindowFocusChangeListener { hasFocus ->
            focused = hasFocus
            if (hasFocus) state.focusGained()
            updateAllWindows()
        }
        private val layoutListener = View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> size() }
        private val attachListener = object : View.OnAttachStateChangeListener {
            override fun onViewAttachedToWindow(view: View) { observe(); focused = view.hasWindowFocus(); update() }
            override fun onViewDetachedFromWindow(view: View) { unobserve(); focused = false; update() }
        }

        fun install() {
            decor.addOnAttachStateChangeListener(attachListener)
            decor.addOnLayoutChangeListener(layoutListener)
            observe()
            update()
        }
        private fun observe() {
            unobserve()
            observer = decor.viewTreeObserver.also { it.addOnWindowFocusChangeListener(focusListener) }
        }
        private fun unobserve() {
            observer?.takeIf { it.isAlive }?.removeOnWindowFocusChangeListener(focusListener)
            observer = null
        }
        private fun size() { drawable.setBounds(0, 0, decor.width, decor.height) }
        private fun updateAllWindows() { this@PrivacyCurtains.update() }
        fun update() {
            size()
            val cover = sensitive && state.covered(focused)
            if (cover == shown) return
            shown = cover
            if (cover) decor.overlay.add(drawable) else decor.overlay.remove(drawable)
            decor.invalidate()
        }
        override fun close() {
            unobserve()
            decor.removeOnAttachStateChangeListener(attachListener)
            decor.removeOnLayoutChangeListener(layoutListener)
            // Disposal can precede the window's final compositor frame. Leave a curtain on its
            // dying decor; detaching/discarding the window releases it without revealing old pixels.
            if (sensitive) {
                size()
                if (!shown) decor.overlay.add(drawable)
                shown = true
                decor.invalidate()
            }
        }
    }
}
